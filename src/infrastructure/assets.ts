import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  readdir,
  unlink,
  utimes,
} from "node:fs/promises";
import { join, basename } from "node:path";
import { nativeImage } from "electron";
import type { Asset } from "../domain/model";
import { DomainError } from "../domain/model";
import { imageDimensions } from "./image-header";
import { health } from "./health";
import { writeAtomic } from "./atomic-file";
export class AssetStore {
  private verified = new Map<string, string>();
  private pending = new Map<string, Promise<Buffer>>();
  private maintenance: Promise<void> = Promise.resolve();
  private slots = 2;
  private waiting: (() => void)[] = [];
  private async withSlot<T>(action: () => Promise<T>): Promise<T> {
    if (this.slots === 0)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.slots--;
    try {
      return await action();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.slots++;
    }
  }
  constructor(
    readonly directory: string,
    readonly cacheDirectory = join(directory, "..", "previews"),
  ) {}
  path(id: string): string {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new DomainError("素材编号无效。");
    return join(this.directory, id);
  }
  async read(id: string): Promise<Buffer> {
    try {
      const path = this.path(id);
      const info = await stat(path),
        signature = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
      if (info.size > 25 * 1024 * 1024)
        throw new DomainError("素材文件大小异常。");
      const bytes = await readFile(path);
      if (this.verified.get(id) !== signature) {
        if (createHash("sha256").update(bytes).digest("hex") !== id)
          throw new DomainError("素材文件校验失败。");
        imageDimensions(bytes);
        this.verified.set(id, signature);
        if (this.verified.size > 2000)
          this.verified.delete(this.verified.keys().next().value!);
      }
      health.resolve(`asset:${id}`);
      return bytes;
    } catch (error) {
      health.report(
        `asset:${id}`,
        new DomainError(
          `素材 ${id.slice(0, 8)} 缺失或损坏，请重新导入原文件或替换；其他内容可继续编辑。`,
        ),
      );
      throw new DomainError(
        `素材 ${id.slice(0, 8)} 缺失或损坏，请重新导入原文件或替换。`,
      );
    }
  }
  async verify(id: string): Promise<void> {
    try {
      const info = await stat(this.path(id));
      if (
        this.verified.get(id) !== `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
      )
        await this.read(id);
    } catch {
      health.report(
        `asset:${id}`,
        new DomainError(
          `素材 ${id.slice(0, 8)} 缺失或损坏，请重新导入原文件或替换。`,
        ),
      );
      throw new DomainError(
        `素材 ${id.slice(0, 8)} 缺失或损坏，请重新导入原文件或替换。`,
      );
    }
  }
  async preview(
    id: string,
    variant: "thumbnail" | "preview" | "share",
  ): Promise<Buffer> {
    const key = `${id}-${variant}`;
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.withSlot(() => this.makePreview(id, variant));
      this.pending.set(key, pending);
      // Release either result; the original promise still reports failures to every caller.
      void pending.then(
        () => this.pending.delete(key),
        () => this.pending.delete(key),
      );
    }
    return pending;
  }
  async previewPath(
    id: string,
    variant: "thumbnail" | "preview" | "share",
  ): Promise<string> {
    const data = await this.preview(id, variant);
    const path = join(
      this.cacheDirectory,
      `${id}-${variant}-v2.${data[0] === 255 ? "jpg" : "png"}`,
    );
    try {
      await stat(path);
    } catch {
      throw new DomainError("预览缓存暂不可写，请检查目录权限后重试。");
    }
    return path;
  }
  private async makePreview(
    id: string,
    variant: "thumbnail" | "preview" | "share",
  ): Promise<Buffer> {
    await this.verify(id);
    for (const ext of ["jpg", "png"]) {
      const cached = join(this.cacheDirectory, `${id}-${variant}-v2.${ext}`);
      try {
        if ((await stat(cached)).size > 16 * 1024 * 1024) {
          await unlink(cached);
          continue;
        }
        const data = await readFile(cached);
        try {
          const size = imageDimensions(data);
          if (Math.max(size.width, size.height) > 1440)
            throw new Error("invalid preview dimensions");
          if (nativeImage.createFromBuffer(data).isEmpty())
            throw new Error("invalid preview");
        } catch {
          await unlink(cached);
          continue;
        }
        // Access times are deliberately updated only once a day to reduce writes.
        if (Date.now() - (await stat(cached)).mtimeMs > 86400000)
          await utimes(cached, new Date(), new Date());
        return data;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          health.report(
            "preview-cache",
            new DomainError(
              "预览缓存暂不可读写，正在使用临时预览，原图和编辑不受影响。",
            ),
          );
          break;
        }
      }
    }
    const original = nativeImage.createFromBuffer(await this.read(id));
    if (original.isEmpty()) throw new DomainError("图片素材无法读取。");
    const size = original.getSize();
    const edge =
      variant === "thumbnail" ? 240 : variant === "share" ? 1200 : 1440;
    const scale = Math.min(1, edge / Math.max(size.width, size.height));
    const resized = original.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: "best",
    });
    const pixels = resized.toBitmap();
    let transparent = false;
    for (let i = 3; i < pixels.length; i += 4)
      if (pixels[i] !== 255) {
        transparent = true;
        break;
      }
    const data = transparent
      ? resized.toPNG()
      : resized.toJPEG(variant === "thumbnail" ? 78 : 84);
    const path = join(
      this.cacheDirectory,
      `${id}-${variant}-v2.${transparent ? "png" : "jpg"}`,
    );
    try {
      await mkdir(this.cacheDirectory, { recursive: true });
      await writeAtomic(path, data, false);
      this.maintenance = this.maintenance
        .catch(() => {})
        .then(() => this.trimCache());
      await this.maintenance;
      health.resolve("preview-cache");
    } catch {
      health.report(
        "preview-cache",
        new DomainError(
          "预览缓存暂不可读写，正在使用临时预览，原图和编辑不受影响。",
        ),
      );
    }
    return data;
  }
  private async trimCache(): Promise<void> {
    const entries = await this.cacheEntries();
    let total = entries.reduce((n, e) => n + e.bytes, 0);
    for (const entry of entries.sort((a, b) => a.time - b.time)) {
      const legacy = !entry.name.includes("-v2.");
      if (!legacy && total <= 256 * 1024 * 1024) continue;
      if (this.pending.has(entry.name.split("-v2.")[0]!)) continue;
      await unlink(join(this.cacheDirectory, entry.name));
      total -= entry.bytes;
    }
  }
  private async cacheEntries(): Promise<
    { name: string; bytes: number; time: number }[]
  > {
    await mkdir(this.cacheDirectory, { recursive: true });
    const result = [];
    for (const entry of await readdir(this.cacheDirectory, {
      withFileTypes: true,
    })) {
      if (
        !entry.isFile() ||
        !/^[a-f0-9]{64}-(thumbnail|preview|share)(-v2)?\.(png|jpg)$/.test(
          entry.name,
        )
      )
        continue;
      try {
        const info = await stat(join(this.cacheDirectory, entry.name));
        result.push({ name: entry.name, bytes: info.size, time: info.mtimeMs });
      } catch (error) {
        // A concurrent eviction can remove an entry after readdir.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return result;
  }
  async cacheInfo(): Promise<{ bytes: number; files: number }> {
    const entries = await this.cacheEntries();
    return {
      bytes: entries.reduce((n, e) => n + e.bytes, 0),
      files: entries.length,
    };
  }
  async clearCache(): Promise<void> {
    await Promise.all([...this.pending.values()]);
    await this.maintenance;
    for (const entry of await this.cacheEntries())
      await unlink(join(this.cacheDirectory, entry.name));
  }
  async import(path: string): Promise<Asset> {
    const info = await stat(path);
    if (info.size > 25 * 1024 * 1024) throw new DomainError("超过 25 MB 限制");
    return this.put(await readFile(path), basename(path));
  }
  async put(
    data: Uint8Array,
    name: string,
    expectedId?: string,
  ): Promise<Asset> {
    if (!data.byteLength || data.byteLength > 25 * 1024 * 1024)
      throw new DomainError("图片大小不符合要求。");
    const buffer = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    let mime: Asset["mime"];
    if (
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      mime = "image/png";
    else if (buffer[0] === 255 && buffer[1] === 216) mime = "image/jpeg";
    else if (
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    )
      mime = "image/webp";
    else throw new DomainError("只支持 JPEG、PNG 和 WebP 图片。");
    imageDimensions(buffer);
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) throw new DomainError("图片无法解码。");
    const { width, height } = image.getSize();
    if (width > 30000 || height > 30000 || width * height > 100_000_000)
      throw new DomainError("图片像素尺寸过大。");
    const id = createHash("sha256").update(buffer).digest("hex");
    if (expectedId && id !== expectedId)
      throw new DomainError("工程素材校验失败。");
    await mkdir(this.directory, { recursive: true });
    try {
      const existing = await readFile(this.path(id));
      if (createHash("sha256").update(existing).digest("hex") === id)
        return { id, name, mime, width, height, bytes: buffer.length };
      // Keep damaged bytes for diagnosis; importing the exact original repairs
      // every reference without changing project IDs or layout.
      await rename(this.path(id), this.path(id) + `.damaged-${Date.now()}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await writeAtomic(this.path(id), buffer);
    this.verified.delete(id);
    health.resolve(`asset:${id}`);
    return { id, name, mime, width, height, bytes: buffer.length };
  }
}
