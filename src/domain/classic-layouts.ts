import {
  id,
  imageElement,
  textElement,
  type Album,
  type Asset,
  type Frame,
  type Page,
} from "./model";
import type { CompositionContent } from "./compositions";
import { layoutPalette } from "./art-direction";
import { fitPhrase } from "./layouts";
export function composeClassicPage(
  size: Album["size"],
  theme: Album["theme"],
  layout: string,
  photos: Asset[],
  content: CompositionContent,
): Page {
  const palette = layoutPalette(layout, theme),
    page: Page = {
      id: id(),
      role: "content",
      background: palette.background,
      backgroundStyle: palette.paper,
      elements: [],
    };
  const frame = (x: number, y: number, w: number, h: number): Frame => ({
    x: (x * size.width) / 100,
    y: (y * size.height) / 100,
    width: (w * size.width) / 100,
    height: (h * size.height) / 100,
  });
  if (layout === "blank") return page;
  const marker = textElement(
    (
      {
        hero: "LITTLE / MOMENTS",
        duo: "A DAY / TOGETHER",
        three: "SCENES / TO REMEMBER",
        grid: "IN GOOD / COMPANY",
        index: "STORY / ARCHIVE",
        chapter: "A NEW / CHAPTER",
        ticket: "NIGHT / NOTES",
        ending: "TO BE / CONTINUED",
      } as Record<string, string>
    )[layout]!,
    frame(8, 5, 84, 3),
    7.5,
  );
  marker.name = "页眉标记";
  marker.style.color = palette.accent;
  marker.style.letterSpacing = 1.2;
  page.elements.push(marker);
  const photo = (index: number, f: Frame, contain = false) => {
    const asset = photos[index];
    const e = asset
      ? imageElement(asset, f)
      : {
          id: id(),
          type: "photoSlot" as const,
          role: "photo" as const,
          name: contain ? "票根" : `照片 ${index + 1}`,
          frame: f,
          rotation: 0,
          opacity: 1,
          locked: false,
          visible: true,
        };
    if (contain && e.type === "image") e.fit = "contain";
    page.elements.push(e);
  };
  const phrase = (f: Frame, font = 12, center = false) => {
    const phrases = content.phrases ?? [],
      e = textElement(
        phrases.length ? phrases[(content.offset ?? 0) % phrases.length]! : "",
        f,
        font,
      );
    e.name = "回忆文字";
    e.style.color = palette.ink;
    e.style.fontFamily = "Noto Serif SC";
    e.style.lineHeight = 1.6;
    e.style.align = center ? "center" : "left";
    fitPhrase(e);
    page.elements.push(e);
  };
  const sticker = (f: Frame, rotation = -5) => {
    const values = content.stickers ?? [],
      asset = values.length
        ? values[(content.offset ?? 0) % values.length]
        : undefined;
    page.elements.push(
      asset
        ? { ...imageElement(asset, f, "sticker"), rotation }
        : {
            id: id(),
            type: "photoSlot",
            role: "sticker",
            name: "贴纸位置",
            frame: f,
            rotation,
            opacity: 1,
            locked: false,
            visible: true,
          },
    );
  };
  switch (layout) {
    case "hero":
      photo(0, frame(8, 14, 84, 57));
      phrase(frame(8, 77, 64, 14), 15);
      sticker(frame(79, 79, 12, 10));
      break;
    case "duo":
      photo(0, frame(8, 14, 40, 53));
      photo(1, frame(52, 25, 40, 50));
      phrase(frame(8, 73, 40, 18), 12);
      sticker(frame(78, 82, 13, 10), 5);
      break;
    case "three":
      photo(0, frame(8, 14, 84, 37));
      photo(1, frame(8, 54, 40, 21));
      photo(2, frame(52, 54, 40, 21));
      phrase(frame(8, 80, 64, 13), 12);
      sticker(frame(79, 82, 12, 10));
      break;
    case "grid":
      for (let i = 0; i < 4; i++)
        photo(i, frame(i % 2 ? 52 : 8, i < 2 ? 14 : 47, 40, 30));
      phrase(frame(8, 82, 64, 11), 11);
      sticker(frame(79, 82, 12, 10), 4);
      break;
    case "index":
      for (let i = 0; i < 6; i++)
        photo(i, frame(8 + (i % 3) * 29, 15 + Math.floor(i / 3) * 28, 26, 25));
      phrase(frame(8, 75, 64, 17), 12);
      sticker(frame(79, 79, 12, 11));
      break;
    case "chapter": {
      const title = textElement("新的章节", frame(8, 14, 84, 15), 28);
      title.name = "章节标题";
      title.style.fontFamily = "Noto Serif SC";
      title.style.color = palette.ink;
      page.elements.push(title);
      photo(0, frame(8, 35, 84, 42));
      phrase(frame(8, 82, 64, 11), 11);
      sticker(frame(79, 82, 12, 10), 4);
      break;
    }
    case "ticket":
      photo(0, frame(8, 14, 84, 43));
      photo(1, frame(43, 62, 49, 17), true);
      phrase(frame(8, 62, 29, 18), 11);
      sticker(frame(11, 84, 18, 8));
      break;
    case "ending": {
      const title = textElement("未完待续", frame(8, 37, 84, 16), 30);
      title.name = "尾页标题";
      title.style.fontFamily = "Noto Serif SC";
      title.style.align = "center";
      title.style.color = palette.ink;
      page.elements.push(title);
      phrase(frame(18, 60, 64, 16), 13, true);
      sticker(frame(44, 81, 12, 9), 0);
      break;
    }
  }
  return page;
}
