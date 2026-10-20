import type { Album } from "./model";
import { DomainError } from "./model";
import { usedFontIds } from "./fonts";
export type MissingResources = { assets: string[]; fonts: string[] };
export function assertMissingResources(
  value: unknown,
  album: Album,
): asserts value is MissingResources {
  const record = value as MissingResources;
  if (
    !record ||
    Object.keys(record).sort().join() !== "assets,fonts" ||
    !Array.isArray(record.assets) ||
    !Array.isArray(record.fonts) ||
    record.assets.length > 1000 ||
    record.fonts.length > 10000
  )
    throw new DomainError("缺失资源说明格式无效。");
  const fonts = new Set(usedFontIds(album));
  for (const [kind, ids] of Object.entries(record)) {
    if (
      new Set(ids).size !== ids.length ||
      ids.some(
        (id: string) =>
          typeof id !== "string" ||
          !/^[a-f0-9]{64}$/.test(id) ||
          (kind === "assets"
            ? !album.assets.some((a) => a.id === id)
            : !fonts.has(id)),
      )
    )
      throw new DomainError("缺失资源说明引用了无效资源。");
  }
}
