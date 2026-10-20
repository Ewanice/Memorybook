import { createHash } from "node:crypto";
import { mkdir, readFile, rename, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { DomainError } from "../domain/model";
import type { ImportedFont } from "../domain/fonts";
import { health } from "./health";
import { writeAtomic } from "./atomic-file";

// Parse the bounded SFNT directory; Chromium handles glyph decoding and shaping.
export function inspectFont(bytes: Uint8Array): { name: string } {
  const b = Buffer.from(bytes);
  if (
    b.length < 12 ||
    b.length > 32 * 1024 * 1024 ||
    !(b.readUInt32BE(0) === 0x00010000 || b.toString("ascii", 0, 4) === "OTTO")
  )
    throw new DomainError("请选择有效的 TTF 或 OTF 字体（不超过 32 MB）。");
  const count = b.readUInt16BE(4);
  if (!count || count > 256 || 12 + count * 16 > b.length)
    throw new DomainError("字体目录损坏。");
  const tables = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const p = 12 + i * 16,
      offset = b.readUInt32BE(p + 8),
      length = b.readUInt32BE(p + 12);
    if (offset + length > b.length)
      throw new DomainError("字体表超出文件范围。");
    tables.set(
      b.toString("ascii", p, p + 4),
      b.subarray(offset, offset + length),
    );
  }
  if (!tables.has("head") || !tables.has("cmap") || !tables.has("name"))
    throw new DomainError("字体缺少必要数据表。");
  const os2 = tables.get("OS/2");
  if (
    os2 &&
    os2.length >= 10 &&
    os2.readUInt16BE(8) & (0x0002 | 0x0100 | 0x0200)
  )
    throw new DomainError(
      "此字体禁止文档嵌入或子集化，无法用于 PDF，请选择允许嵌入的字体。",
    );
  const names = tables.get("name")!;
  if (names.length < 6) throw new DomainError("字体名称表损坏。");
  const n = names.readUInt16BE(2),
    start = names.readUInt16BE(4);
  if (6 + n * 12 > names.length) throw new DomainError("字体名称表损坏。");
  const candidates: { name: string; score: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = 6 + i * 12,
      platform = names.readUInt16BE(p),
      lang = names.readUInt16BE(p + 4),
      kind = names.readUInt16BE(p + 6);
    if (![1, 4, 16].includes(kind) || ![0, 3].includes(platform)) continue;
    const length = names.readUInt16BE(p + 8),
      offset = start + names.readUInt16BE(p + 10);
    if (offset + length > names.length || length % 2)
      throw new DomainError("字体名称记录损坏。");
    const name = new TextDecoder("utf-16be")
      .decode(names.subarray(offset, offset + length))
      .replace(/[\u0000-\u001f]/g, "")
      .trim()
      .slice(0, 120);
    if (name)
      candidates.push({
        name,
        score:
          (kind === 4 ? 10 : 0) + (lang === 0x804 ? 4 : lang === 0x409 ? 2 : 0),
      });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) throw new DomainError("无法读取字体名称。");
  return { name: candidates[0]!.name };
}
export class FontStore {
  constructor(readonly directory: string) {}
  path(id: string): string {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new DomainError("字体编号无效。");
    return join(this.directory, id);
  }
  async read(id: string): Promise<Buffer> {
    const path = this.path(id);
    if ((await stat(path)).size > 32 * 1024 * 1024)
      throw new DomainError("字体文件过大。");
    const bytes = await readFile(path);
    inspectFont(bytes);
    if (createHash("sha256").update(bytes).digest("hex") !== id)
      throw new DomainError("字体文件校验失败。");
    return bytes;
  }
  async put(bytes: Uint8Array, expectedId?: string): Promise<ImportedFont> {
    const { name } = inspectFont(bytes);
    const id = createHash("sha256").update(bytes).digest("hex");
    if (expectedId && id !== expectedId)
      throw new DomainError("字体校验失败。");
    await mkdir(this.directory, { recursive: true });
    try {
      const info = await stat(this.path(id));
      if (info.size <= 32 * 1024 * 1024) {
        const existing = await readFile(this.path(id));
        if (createHash("sha256").update(existing).digest("hex") === id)
          return { id, name, family: `MemoryFont_${id}`, bytes: bytes.length };
      }
      await rename(this.path(id), this.path(id) + `.damaged-${Date.now()}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeAtomic(this.path(id), bytes);
    health.resolve(`font:${id}`);
    return { id, name, family: `MemoryFont_${id}`, bytes: bytes.length };
  }
  async list(): Promise<ImportedFont[]> {
    await mkdir(this.directory, { recursive: true });
    const result: ImportedFont[] = [];
    const names = await readdir(this.directory);
    for (const issue of health.list())
      if (issue.key.startsWith("font:") && !names.includes(issue.key.slice(5)))
        health.resolve(issue.key);
    for (const name of names) {
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      try {
        const path = this.path(name);
        if ((await stat(path)).size > 32 * 1024 * 1024)
          throw new DomainError("字体库包含过大的字体文件。");
        const bytes = await readFile(path),
          info = inspectFont(bytes);
        if (createHash("sha256").update(bytes).digest("hex") !== name)
          throw new DomainError("字体库校验失败。");
        result.push({
          id: name,
          name: info.name,
          family: `MemoryFont_${name}`,
          bytes: bytes.length,
        });
        health.resolve(`font:${name}`);
      } catch (error) {
        health.report(
          `font:${name}`,
          new DomainError(
            `字体 ${name.slice(0, 8)} 无法使用，已隔离。重新导入原字体可修复；其他字体不受影响。`,
          ),
        );
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }
}
