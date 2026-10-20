import { nativeImage } from "electron";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Asset } from "../domain/model";
import { DomainError } from "../domain/model";
import type { AssetStore } from "./assets";
const glyphs: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  P: ["110", "101", "110", "100", "100"],
  S: ["111", "100", "111", "001", "111"],
};
export type ContactSheet = {
  index: number;
  kind: "photo" | "sticker";
  indices: number[];
  path: string;
};
export async function makeContactSheets(
  photos: Asset[],
  stickers: Asset[],
  assets: AssetStore,
  directory: string,
  signal: AbortSignal,
  files: string[],
): Promise<ContactSheet[]> {
  await mkdir(directory, { recursive: true });
  const result: ContactSheet[] = [];
  for (const [kind, items] of [
    ["photo", photos],
    ["sticker", stickers],
  ] as const) {
    for (let offset = 0; offset < items.length; offset += 64) {
      const group = items.slice(offset, offset + 64),
        width = 1280,
        height = Math.ceil(group.length / 8) * 144,
        pixels = Buffer.alloc(width * height * 4, 255);
      for (const [i, asset] of group.entries()) {
        if (signal.aborted) throw new DomainError("生成已取消。");
        const image = nativeImage.createFromBuffer(
          await assets.preview(asset.id, "thumbnail"),
        );
        if (image.isEmpty())
          throw new DomainError(
            `素材 ${asset.name} 无法读取，请重新导入或替换。`,
          );
        const size = image.getSize(),
          scale = Math.min(150 / size.width, 112 / size.height),
          w = Math.max(1, Math.round(size.width * scale)),
          h = Math.max(1, Math.round(size.height * scale));
        const source = image.resize({ width: w, height: h }).toBitmap(),
          x = (i % 8) * 160 + Math.floor((160 - w) / 2),
          y = Math.floor(i / 8) * 144 + 24;
        for (let row = 0; row < h; row++)
          for (let col = 0; col < w; col++) {
            const a = (row * w + col) * 4,
              b = ((row + y) * width + x + col) * 4,
              alpha = source[a + 3]! / 255;
            for (let channel = 0; channel < 3; channel++)
              pixels[b + channel] = Math.round(
                Math.min(255, source[a + channel]! + 255 * (1 - alpha)),
              );
          }
        const label = (kind === "photo" ? "P" : "S") + (offset + i);
        for (const [letter, char] of [...label].entries())
          for (const [row, line] of glyphs[char]!.entries())
            for (const [col, value] of [...line].entries())
              if (value === "1")
                for (let dy = 0; dy < 2; dy++)
                  for (let dx = 0; dx < 2; dx++) {
                    const p =
                      ((Math.floor(i / 8) * 144 + 6 + row * 2 + dy) * width +
                        (i % 8) * 160 +
                        6 +
                        letter * 10 +
                        col * 2 +
                        dx) *
                      4;
                    pixels[p] = pixels[p + 1] = pixels[p + 2] = 28;
                  }
      }
      if (signal.aborted) throw new DomainError("生成已取消。");
      const path = join(directory, `contact-${crypto.randomUUID()}.jpg`);
      await writeFile(
        path,
        nativeImage.createFromBitmap(pixels, { width, height }).toJPEG(82),
      );
      files.push(path);
      result.push({
        path,
        kind,
        index: offset,
        indices: group.map((_, i) => offset + i),
      });
    }
  }
  return result;
}
