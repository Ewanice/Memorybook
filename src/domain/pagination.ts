import { type Album, type Page, type TextElement, textElement } from "./model";
import { paperTextPalette } from "./art-direction";
export const pagePositions = {
  "bottom-center": "下方居中",
  "bottom-left": "左下角",
  "bottom-right": "右下角",
  "top-left": "左上角",
  "top-center": "上方居中",
  "top-right": "右上角",
} as const;
export type Pagination = {
  enabled: boolean;
  position: keyof typeof pagePositions;
  start: number;
};
export const defaultPagination: Pagination = {
  enabled: false,
  position: "bottom-center",
  start: 1,
};
export function pageNumber(
  album: Pick<Album, "size"> &
    Partial<Pick<Album, "pages" | "pagination" | "theme">>,
  page: Page,
): TextElement | null {
  if (!album.pagination?.enabled || page.role !== "content" || !album.pages)
    return null;
  const n = album.pages
    .filter((p) => p.role === "content")
    .findIndex((p) => p.id === page.id);
  if (n < 0) return null;
  const position = album.pagination.position;
  const el = textElement(
    String(album.pagination.start + n),
    {
      x: 24,
      y: position.startsWith("top") ? 10 : album.size.height - 24,
      width: album.size.width - 48,
      height: 14,
    },
    8,
  );
  el.id = "page-number-" + page.id;
  el.name = "页码";
  el.style.align = position.endsWith("left")
    ? "left"
    : position.endsWith("right")
      ? "right"
      : "center";
  el.style.color = paperTextPalette(
    page.backgroundStyle ?? "solid",
    page.background,
  ).accent;
  return el;
}
