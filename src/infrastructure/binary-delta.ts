import { open, stat } from "./update-fs";
import { createHash } from "node:crypto";
import { fileHash } from "./update-protocol";
import { DomainError } from "../domain/model";

// MBDELTA1: bounded COPY(offset,length) / DATA(length,bytes) records.
// The surrounding update container compresses records; both old and rebuilt files are SHA-256 checked.
export async function createDelta(
  base: string,
  target: string,
  destination: string,
): Promise<void> {
  const block = 65536,
    index = new Map<string, number>();
  const a = await open(base, "r"),
    b = await open(target, "r"),
    out = await open(destination, "wx");
  try {
    const header = Buffer.from(
      JSON.stringify({
        baseBytes: (await a.stat()).size,
        baseSha256: await fileHash(base),
        bytes: (await b.stat()).size,
        sha256: await fileHash(target),
      }),
    );
    const prefix = Buffer.alloc(12);
    prefix.write("MBDELTA1");
    prefix.writeUInt32LE(header.length, 8);
    await out.writeFile(prefix);
    await out.writeFile(header);
    const bytes = Buffer.alloc(block);
    for (let offset = 0; ; offset += block) {
      const { bytesRead } = await a.read(bytes, 0, block, offset);
      if (!bytesRead) break;
      const hash = createHash("sha256")
        .update(bytes.subarray(0, bytesRead))
        .digest("hex");
      if (!index.has(hash)) index.set(hash, offset);
    }
    for (let offset = 0; ; offset += block) {
      const { bytesRead } = await b.read(bytes, 0, block, offset);
      if (!bytesRead) break;
      const value = bytes.subarray(0, bytesRead);
      const match = index.get(createHash("sha256").update(value).digest("hex"));
      if (match !== undefined) {
        const record = Buffer.alloc(13);
        record[0] = 0;
        record.writeBigUInt64LE(BigInt(match), 1);
        record.writeUInt32LE(bytesRead, 9);
        await out.writeFile(record);
      } else {
        const record = Buffer.alloc(5);
        record[0] = 1;
        record.writeUInt32LE(bytesRead, 1);
        await out.writeFile(record);
        await out.writeFile(value);
      }
    }
    await out.writeFile(Buffer.from([255]));
    await out.sync();
  } finally {
    await a.close();
    await b.close();
    await out.close();
  }
}
export async function applyDelta(
  base: string,
  delta: string,
  destination: string,
  expected: { bytes: number; sha256: string },
  signal?: AbortSignal,
): Promise<void> {
  const a = await open(base, "r"),
    patch = await open(delta, "r"),
    out = await open(destination, "wx");
  let position = 0,
    written = 0;
  async function exact(n: number) {
    signal?.throwIfAborted();
    if (n < 0 || n > 1024 * 1024) throw new DomainError("补丁记录超限。");
    const b = Buffer.alloc(n);
    let received = 0;
    while (received < n) {
      const { bytesRead } = await patch.read(
        b,
        received,
        n - received,
        position,
      );
      if (!bytesRead) throw new DomainError("二进制补丁被截断。");
      received += bytesRead;
      position += bytesRead;
    }
    return b;
  }
  try {
    const prefix = await exact(12);
    if (
      prefix.toString("ascii", 0, 8) !== "MBDELTA1" ||
      prefix.readUInt32LE(8) > 4096
    )
      throw new DomainError("二进制补丁格式无效。");
    const header = JSON.parse(
      (await exact(prefix.readUInt32LE(8))).toString(),
    ) as {
      baseBytes: number;
      baseSha256: string;
      bytes: number;
      sha256: string;
    };
    if (
      header.bytes !== expected.bytes ||
      header.sha256 !== expected.sha256 ||
      header.baseBytes !== (await a.stat()).size ||
      header.baseSha256 !== (await fileHash(base, signal))
    )
      throw new DomainError("补丁与当前程序不匹配，请改用完整更新。");
    for (;;) {
      const kind = (await exact(1))[0];
      if (kind === 255) break;
      let bytes: Buffer;
      if (kind === 0) {
        const rec = await exact(12),
          offset = Number(rec.readBigUInt64LE(0)),
          length = rec.readUInt32LE(8);
        if (
          !Number.isSafeInteger(offset) ||
          !length ||
          length > 65536 ||
          offset + length > header.baseBytes
        )
          throw new DomainError("补丁引用范围无效。");
        bytes = Buffer.alloc(length);
        const { bytesRead } = await a.read(bytes, 0, length, offset);
        if (bytesRead !== length) throw new DomainError("原程序读取不完整。");
      } else if (kind === 1) {
        const length = (await exact(4)).readUInt32LE(0);
        if (!length || length > 65536)
          throw new DomainError("补丁数据范围无效。");
        bytes = await exact(length);
      } else throw new DomainError("补丁指令无效。");
      written += bytes.length;
      if (written > expected.bytes) throw new DomainError("补丁输出超限。");
      await out.writeFile(bytes);
    }
    if (written !== expected.bytes || position !== (await stat(delta)).size)
      throw new DomainError("补丁长度不符或存在多余内容。");
    await out.sync();
    await out.close();
    if ((await fileHash(destination, signal)) !== expected.sha256)
      throw new DomainError("补丁重建文件校验失败。");
  } finally {
    await a.close();
    await patch.close();
    await out.close();
  }
}
