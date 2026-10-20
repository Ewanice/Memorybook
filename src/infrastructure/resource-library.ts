import { readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { LayoutTemplate } from "../domain/layouts";
import { assertLayout } from "../domain/layout-validation";
import type { Asset } from "../domain/model";
import { DomainError } from "../domain/model";
import { health } from "./health";
import { writeAtomic } from "./atomic-file";

export function parsePhrases(text: string): string[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (lines.length > 1000)
    throw new DomainError("短语库最多 1000 行，请减少内容后重新读取。");
  if (lines.some((line) => Array.from(line).length > 80))
    throw new DomainError("短语每行最多 80 个字符，请将长句拆行后重新读取。");
  return [...new Set(lines)];
}

type Values = {
  getValue(key: string): string | null;
  setValue(key: string, value: string): void;
  archivePreference?(key: string, value: string): void;
};
export class ResourceLibrary {
  constructor(
    private values: Values,
    readonly phrasePath: string,
    private seedPath: string,
  ) {}
  stickers(): Asset[] {
    const raw = this.values.getValue("sticker-library");
    return this.readEntries(
      raw,
      "sticker-library",
      (value: unknown): value is Asset => {
        const a = value as Asset;
        if (
          !a ||
          !/^[a-f0-9]{64}$/.test(a.id) ||
          typeof a.name !== "string" ||
          !["image/png", "image/jpeg", "image/webp"].includes(a.mime) ||
          ![a.width, a.height, a.bytes].every(
            (n) => Number.isInteger(n) && n > 0,
          ) ||
          a.bytes > 25 * 1024 * 1024 ||
          a.width * a.height > 100_000_000
        )
          throw new DomainError("贴纸记录损坏。");
        return true;
      },
    ).slice(0, 500);
  }
  private readEntries<T>(
    raw: string | null,
    key: string,
    validate: (value: unknown) => value is T,
  ): T[] {
    if (!raw) return [];
    const result: T[] = [];
    let damaged = 0;
    try {
      const values: unknown = JSON.parse(raw);
      if (!Array.isArray(values)) throw new DomainError("素材库格式损坏。");
      for (const value of values) {
        try {
          if (validate(value)) result.push(value);
        } catch {
          damaged++;
        }
      }
    } catch {
      damaged++;
    }
    if (damaged) {
      this.values.archivePreference?.(key, raw);
      health.report(
        key,
        new DomainError(
          `已隔离 ${damaged} 条异常素材库记录，原始记录已保留；正常内容可继续使用。`,
        ),
      );
    } else health.resolve(key);
    return result;
  }
  addStickers(assets: Asset[]): void {
    const merged = [
      ...new Map(
        [...this.stickers(), ...assets].map((a) => [a.id, a]),
      ).values(),
    ];
    if (merged.length > 500)
      throw new DomainError(
        "贴纸库最多保存 500 张贴纸，请先移除不需要的贴纸。",
      );
    this.values.setValue("sticker-library", JSON.stringify(merged));
  }
  removeSticker(id: string): void {
    if (!this.stickers().some((a) => a.id === id))
      throw new DomainError("贴纸不存在，请刷新贴纸库。");
    this.values.setValue(
      "sticker-library",
      JSON.stringify(this.stickers().filter((a) => a.id !== id)),
    );
  }
  private async readPhraseText(): Promise<{ text: string; hash: string }> {
    try {
      await stat(this.phrasePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        await writeFile(this.phrasePath, await readFile(this.seedPath), {
          flag: "wx",
        });
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== "EEXIST")
          throw writeError;
      }
    }
    const info = await stat(this.phrasePath);
    if (info.size > 512 * 1024)
      throw new DomainError("短语库文件超过 512 KB，请减少内容。");
    const bytes = await readFile(this.phrasePath);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new DomainError("短语库需要保存为 UTF-8 文本格式。");
    }
    return { text, hash: createHash("sha256").update(bytes).digest("hex") };
  }
  async phrases(): Promise<string[]> {
    return parsePhrases((await this.readPhraseText()).text);
  }
  selected(ids: string[]): Asset[] {
    if (
      !Array.isArray(ids) ||
      ids.length > 500 ||
      new Set(ids).size !== ids.length
    )
      throw new DomainError("贴纸选择无效。");
    const all = this.stickers();
    return ids.map((id) => {
      const a = all.find((asset) => asset.id === id);
      if (!a) throw new DomainError("选择的贴纸已移出库，请重新选择。");
      return a;
    });
  }
  layouts(): LayoutTemplate[] {
    const raw = this.values.getValue("layout-library");
    return this.readEntries(
      raw,
      "layout-library",
      (value: unknown): value is LayoutTemplate => {
        assertLayout(value);
        return true;
      },
    ).slice(0, 50);
  }
  saveLayout(template: LayoutTemplate): void {
    assertLayout(template);
    if (template.id.startsWith("builtin-"))
      throw new DomainError("内置排版请另存为自己的排版。");
    const all = this.layouts(),
      index = all.findIndex((t) => t.id === template.id);
    if (index < 0) all.push(template);
    else all[index] = template;
    if (all.length > 50) throw new DomainError("最多保存 50 个自定义排版。");
    this.values.setValue("layout-library", JSON.stringify(all));
  }
  removeLayout(id: string): void {
    const all = this.layouts();
    if (!all.some((t) => t.id === id)) throw new DomainError("排版不存在。");
    this.values.setValue(
      "layout-library",
      JSON.stringify(all.filter((t) => t.id !== id)),
    );
  }
  async phraseDocument(): Promise<{ text: string; hash: string }> {
    return this.readPhraseText();
  }
  async resetPhrases(): Promise<{ text: string; hash: string }> {
    try {
      const raw = await readFile(this.phrasePath);
      await writeAtomic(this.phrasePath + `.damaged-${Date.now()}.txt`, raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeAtomic(
      this.phrasePath,
      Buffer.from("# 一行一句；旧文件已另存备份。\n", "utf8"),
    );
    health.resolve("phrases");
    return this.phraseDocument();
  }
  async savePhrases(
    text: string,
    expectedHash: string,
  ): Promise<{ text: string; hash: string }> {
    if (typeof text !== "string" || Buffer.byteLength(text) > 512 * 1024)
      throw new DomainError("短语文件最多 512 KB。");
    parsePhrases(text);
    const current = createHash("sha256")
      .update(await readFile(this.phrasePath))
      .digest("hex");
    if (current !== expectedHash)
      throw new DomainError(
        "短语文件已被其他窗口或外部程序修改，请先重新读取再保存。",
      );
    await writeAtomic(this.phrasePath, Buffer.from(text, "utf8"));
    return this.phraseDocument();
  }
}
