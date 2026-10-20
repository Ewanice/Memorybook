import type { Album } from "./model";
export type ImportedFont = {
  id: string;
  name: string;
  family: string;
  bytes: number;
};
export function usedFontIds(album: Pick<Album, "pages">): string[] {
  return [
    ...new Set(
      album.pages.flatMap((p) =>
        p.elements.flatMap((e) =>
          e.type === "text" && e.style.fontFamily?.startsWith("MemoryFont_")
            ? [e.style.fontFamily.slice(11)]
            : [],
        ),
      ),
    ),
  ];
}
export function fontCss(ids: string[]): string {
  return ids
    .map((id) => {
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("字体编号无效");
      return `@font-face{font-family:MemoryFont_${id};src:url(memory://font/${id});font-display:block}`;
    })
    .join("\n");
}
