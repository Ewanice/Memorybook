import type { Album } from "./model";
import { DomainError } from "./model";
export type PrintOptions = {
  fromPage?: number;
  toPage?: number;
  bleedMm?: number;
};
export function exportSelection(album: Album, options: PrintOptions) {
  const from = options.fromPage ?? 1,
    to = options.toPage ?? album.pages.length,
    bleedMm = options.bleedMm ?? 0;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 1 ||
    to < from ||
    to > album.pages.length ||
    !Number.isFinite(bleedMm) ||
    bleedMm < 0 ||
    bleedMm > 10
  )
    throw new DomainError("导出范围或出血尺寸无效。");
  return {
    pages: album.pages.slice(from - 1, to),
    from,
    to,
    bleed: (bleedMm * 72) / 25.4,
  };
}
