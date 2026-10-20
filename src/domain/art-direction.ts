import type { Album, Page } from "./model";
import type { BackgroundStyle } from "./backgrounds";
export type PagePalette = {
  paper: BackgroundStyle;
  background: string;
  ink: string;
  accent: string;
};
type PaletteTuple = [BackgroundStyle, string, string, string];
const paper: Record<string, PaletteTuple> = {
  monologue: ["fiber", "#f5f1e7", "#354139", "#726246"],
  dialogue: ["linen", "#ede7dd", "#4a4240", "#855749"],
  fieldnotes: ["grid", "#f0f1e8", "#344d43", "#5a6858"],
  letter: ["kraft", "#decaa9", "#4c3c30", "#755442"],
  hero: ["rice", "#f6f3eb", "#374a45", "#6b7c73"],
  duo: ["wash", "#e9efeb", "#354a43", "#546f64"],
  three: ["fiber", "#f1ede5", "#4c4846", "#7c6453"],
  grid: ["solid", "#f4f0e9", "#3e4a45", "#71776d"],
  index: ["dots", "#eff0e8", "#3d5147", "#6c755d"],
  chapter: ["wash", "#f1e5dc", "#57423d", "#825c50"],
  ticket: ["kraft", "#dbc4a0", "#473a2d", "#6c5336"],
  ending: ["rice", "#f5f1e8", "#42483e", "#6b755c"],
  blank: ["fiber", "#f5f1e7", "#354139", "#726246"],
};
const live: Record<string, PaletteTuple> = {
  monologue: ["fiber", "#222b29", "#f3ede0", "#d6be8c"],
  dialogue: ["linen", "#28313a", "#e9edf0", "#bec6d0"],
  fieldnotes: ["grid", "#25312d", "#eeefe0", "#bfc8a0"],
  letter: ["kraft", "#3a302c", "#f5ecdd", "#d4b18b"],
  hero: ["rice", "#222b2d", "#edf0e7", "#afc4bb"],
  duo: ["fiber", "#203331", "#edf1e8", "#b9cdb9"],
  three: ["linen", "#302b32", "#f2e9ee", "#d4b5c3"],
  grid: ["solid", "#242c30", "#eef1ec", "#b8c4c5"],
  index: ["dots", "#293029", "#f0eedf", "#c5c7a5"],
  chapter: ["wash", "#382c2c", "#f6ece3", "#d6b6a6"],
  ticket: ["kraft", "#352e28", "#f2e9d8", "#d6bd8d"],
  ending: ["rice", "#25312d", "#eeefe0", "#bfc8a0"],
  blank: ["fiber", "#222b29", "#f3ede0", "#d6be8c"],
};
function channels(color: string): number[] {
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
}
export function luminance(color: string): number {
  return channels(color)
    .map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i]!, 0);
}
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function readableColor(
  color: string,
  background: string,
  min = 4.5,
): string {
  if (contrastRatio(color, background) >= min) return color;
  const dark = "#1f2925",
    light = "#faf7ef",
    target =
      contrastRatio(dark, background) > contrastRatio(light, background)
        ? dark
        : light;
  const from = channels(color),
    to = channels(target);
  for (let n = 1; n <= 20; n++) {
    const value =
      "#" +
      from
        .map((v, i) =>
          Math.round(v + ((to[i]! - v) * n) / 20)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    if (contrastRatio(value, background) >= min) return value;
  }
  return target;
}
export function layoutPalette(
  layout: string,
  theme: Album["theme"],
): PagePalette {
  const value = (theme === "live" ? live : paper)[layout];
  if (!value) throw new Error(`Unknown layout palette: ${layout}`);
  const [texture, background, ink, accent] = value;
  return {
    paper: texture,
    background,
    ink: readableColor(ink, background, 7),
    accent: readableColor(accent, background),
  };
}
export function paperTextPalette(
  style: BackgroundStyle,
  background: string,
): { ink: string; accent: string } {
  const base =
    style === "kraft"
      ? ["#473a2d", "#6c5336"]
      : style === "wash"
        ? ["#354a43", "#546f64"]
        : style === "linen"
          ? ["#4a4240", "#75594d"]
          : ["#354139", "#6b715f"];
  return {
    ink: readableColor(base[0]!, background, 7),
    accent: readableColor(base[1]!, background),
  };
}
export function matchPageText(
  page: Page,
  mode: "match" | "contrast",
): string[] {
  const palette = paperTextPalette(
      page.backgroundStyle ?? "solid",
      page.background,
    ),
    changed: string[] = [];
  for (const e of page.elements) {
    if (e.type !== "text" || e.locked) continue;
    const f = e.frame;
    const onPhoto = page.elements.some((photo) => {
      if (
        photo.type !== "image" ||
        photo.role !== "photo" ||
        !photo.visible ||
        photo.opacity < 0.9
      )
        return false;
      const p = photo.frame,
        w = Math.max(
          0,
          Math.min(f.x + f.width, p.x + p.width) - Math.max(f.x, p.x),
        ),
        h = Math.max(
          0,
          Math.min(f.y + f.height, p.y + p.height) - Math.max(f.y, p.y),
        );
      return w * h >= f.width * f.height * 0.5;
    });
    if (onPhoto) continue;
    const color =
      mode === "match"
        ? /页眉|角标|城市|标记/.test(e.name)
          ? palette.accent
          : palette.ink
        : readableColor(e.style.color, page.background);
    if (color !== e.style.color) {
      e.style.color = color;
      changed.push(e.id);
    }
  }
  return changed;
}
