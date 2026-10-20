import { createReadStream } from "node:fs";
import {
  open,
  stat,
  rename,
  unlink,
  statfs,
  mkdir,
  readFile,
} from "node:fs/promises";
import { Zip, ZipPassThrough, Unzip, UnzipInflate } from "fflate";
import { dirname, join } from "node:path";
import { DomainError } from "../domain/model";
import { createHash } from "node:crypto";

export const archiveLimit = 3 * 1024 * 1024 * 1024; // ZIP32: keep offsets safely below 4 GiB.
export async function requireSpace(
  directory: string,
  bytes: number,
): Promise<void> {
  const disk = await statfs(directory);
  if (disk.bavail * disk.bsize < bytes + 32 * 1024 * 1024)
    throw new DomainError("磁盘剩余空间不足，请选择其他位置或清理资料后重试。");
}
export async function writeArchive(
  path: string,
  entries: { name: string; path?: string; bytes?: Uint8Array }[],
): Promise<void> {
  const allowed = (name: string) =>
    name === "album.json" ||
    name === "missing.json" ||
    /^(assets|fonts)\/[a-f0-9]{64}$/.test(name);
  if (
    entries.length > 11999 ||
    new Set(entries.map((e) => e.name)).size !== entries.length ||
    entries.some((e) => !allowed(e.name))
  )
    throw new DomainError("工程包文件清单无效。");
  let total = 0;
  for (const entry of entries)
    total += entry.bytes?.byteLength ?? (await stat(entry.path!)).size;
  if (total > archiveLimit - 2 * 1024 * 1024)
    throw new DomainError(
      "单本工程包上限为 3 GB；更大的资料可使用“备份全部资料”。",
    );
  await requireSpace(dirname(path), total);
  const temporary = path + "." + crypto.randomUUID() + ".tmp";
  const output = await open(temporary, "wx");
  let writes = Promise.resolve(),
    failure: unknown;
  const manifest: Record<string, { bytes: number; sha256: string }> = {};
  const zip = new Zip((error, data) => {
    if (error) {
      failure = error;
      return;
    }
    writes = writes.then(async () => {
      await output.writeFile(data);
    });
    void writes.catch((error) => {
      failure = error;
    });
  });
  try {
    for (const entry of entries) {
      const digest = createHash("sha256");
      let size = 0;
      const file = new ZipPassThrough(entry.name);
      zip.add(file);
      if (entry.bytes) {
        digest.update(entry.bytes);
        size = entry.bytes.byteLength;
        file.push(entry.bytes, true);
        await writes;
      } else {
        for await (const chunk of createReadStream(entry.path!, {
          highWaterMark: 256 * 1024,
        })) {
          digest.update(chunk);
          size += (chunk as Buffer).length;
          file.push(chunk as Buffer, false);
          await writes;
          if (failure) throw failure;
        }
        file.push(new Uint8Array(), true);
        await writes;
      }
      if (failure) throw failure;
      manifest[entry.name] = { bytes: size, sha256: digest.digest("hex") };
    }
    const metadata = new ZipPassThrough("manifest.json");
    zip.add(metadata);
    metadata.push(
      Buffer.from(JSON.stringify({ version: 1, files: manifest })),
      true,
    );
    await writes;
    zip.end();
    await writes;
    if (failure) throw failure;
    await output.sync();
    await output.close();
    await rename(temporary, path);
  } catch (error) {
    zip.terminate();
    await writes.catch(() => {});
    await output.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

// Extract one bounded entry at a time to staging. Neither ZIP bytes nor all
// original images are retained in RAM; paths are allowlisted before opening.
export async function readArchive(
  path: string,
  directory: string,
): Promise<Map<string, string>> {
  if ((await stat(path)).size > archiveLimit + 4 * 1024 * 1024)
    throw new DomainError("工程包超过 3 GB 限制。");
  await mkdir(directory, { recursive: true });
  const entries = new Map<string, string>(),
    completed = new Set<string>();
  let total = 0,
    failure: unknown;
  let writes = Promise.resolve();
  const unzip = new Unzip((file) => {
    if (
      entries.size >= 12000 ||
      (file.name !== "album.json" &&
        file.name !== "manifest.json" &&
        file.name !== "missing.json" &&
        !/^(assets|fonts)\/[a-f0-9]{64}$/.test(file.name)) ||
      entries.has(file.name)
    )
      throw new DomainError("工程包包含非法路径、重复文件或过多文件。");
    const limit =
      file.name === "manifest.json" || file.name === "missing.json"
        ? 2 * 1024 * 1024
        : file.name === "album.json"
          ? 16 * 1024 * 1024
          : file.name.startsWith("fonts/")
            ? 32 * 1024 * 1024
            : 25 * 1024 * 1024;
    if (file.originalSize !== undefined && file.originalSize > limit)
      throw new DomainError("工程包中的单个文件超限。");
    const destination = join(directory, String(entries.size));
    entries.set(file.name, destination);
    let size = 0;
    const handle = open(destination, "wx");
    void handle.catch((error) => {
      failure = error;
    });
    file.ondata = (error, data, final) => {
      if (error) {
        failure = error;
        return;
      }
      size += data.length;
      total += data.length;
      if (size > limit || total > archiveLimit) {
        failure = new DomainError("工程包解压大小超限。");
        file.terminate();
        return;
      }
      writes = writes.then(async () => {
        const fd = await handle;
        await fd.writeFile(data);
        if (final) {
          await fd.close();
          completed.add(file.name);
        }
      });
      void writes.catch((error) => {
        failure = error;
      });
    };
    file.start();
    // Ensure an empty/truncated entry's handle is closed on every exit.
    handles.push(handle);
  });
  const handles: Promise<Awaited<ReturnType<typeof open>>>[] = [];
  unzip.register(UnzipInflate);
  try {
    for await (const chunk of createReadStream(path, {
      highWaterMark: 64 * 1024,
    })) {
      unzip.push(chunk as Buffer, false);
      await writes;
      if (failure) throw failure;
    }
    unzip.push(new Uint8Array(), true);
    await writes;
    if (failure) throw failure;
    if (completed.size !== entries.size)
      throw new DomainError("工程包未完整下载或已损坏。");
    if (!entries.has("album.json")) throw new DomainError("工程包缺少文档。");
    const manifestPath = entries.get("manifest.json");
    if (manifestPath) {
      const metadata = JSON.parse(await readFile(manifestPath, "utf8")) as {
        version: number;
        files: Record<string, { bytes: number; sha256: string }>;
      };
      if (
        metadata.version !== 1 ||
        !metadata.files ||
        Array.isArray(metadata.files) ||
        Object.keys(metadata.files).length !== entries.size - 1
      )
        throw new DomainError("工程包校验清单损坏。");
      for (const [name, path] of entries) {
        if (name === "manifest.json") continue;
        const expected = metadata.files[name];
        if (
          !expected ||
          !Number.isSafeInteger(expected.bytes) ||
          expected.bytes < 0 ||
          !/^[a-f0-9]{64}$/.test(expected.sha256) ||
          (await stat(path)).size !== expected.bytes
        )
          throw new DomainError("工程包文件大小或校验记录不匹配。");
        const digest = createHash("sha256");
        for await (const chunk of createReadStream(path, {
          highWaterMark: 256 * 1024,
        }))
          digest.update(chunk);
        if (digest.digest("hex") !== expected.sha256)
          throw new DomainError("工程包内容校验失败，可能未完整下载或已损坏。");
      }
    }
    return entries;
  } finally {
    await writes.catch(() => {});
    await Promise.allSettled(handles.map(async (h) => (await h).close()));
  }
}
