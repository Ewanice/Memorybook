import {
  id,
  imageElement,
  textElement,
  type Album,
  type Asset,
  type Frame,
  type Page,
} from "./model";
import { layoutPalette } from "./art-direction";

export const compositionLabels = {
  monologue: "留白独白",
  dialogue: "双帧对话",
  fieldnotes: "现场手记",
  letter: "拼贴来信",
} as const;
export type Composition = keyof typeof compositionLabels;
export const compositionCapacity: Record<Composition, number> = {
  monologue: 1,
  dialogue: 2,
  fieldnotes: 3,
  letter: 2,
};
export type CompositionContent = {
  customLayouts?: import("./layouts").LayoutTemplate[];
  stickers?: Asset[];
  phrases?: string[];
  offset?: number;
};

// All rectangles use a 100 × 100 proportional grid, with explicit photo/text/sticker zones.
export function composePage(
  size: Album["size"],
  theme: Album["theme"],
  layout: Composition,
  photos: Asset[],
  content: CompositionContent = {},
): Page {
  const palette = layoutPalette(layout, theme);
  const page: Page = {
    id: id(),
    role: "content",
    background: palette.background,
    backgroundStyle: palette.paper,
    elements: [],
  };
  const frame = (
    x: number,
    y: number,
    width: number,
    height: number,
  ): Frame => ({
    x: (x * size.width) / 100,
    y: (y * size.height) / 100,
    width: (width * size.width) / 100,
    height: (height * size.height) / 100,
  });
  const ink = palette.ink;
  const accent = palette.accent;
  const offset = content.offset ?? 0;
  const addPhoto = (index: number, rect: Frame, rotation = 0) => {
    const asset = photos[index];
    page.elements.push(
      asset
        ? { ...imageElement(asset, rect), rotation }
        : {
            id: id(),
            type: "photoSlot",
            role: "photo",
            name: `照片 ${index + 1}`,
            frame: rect,
            rotation,
            opacity: 1,
            locked: false,
            visible: true,
          },
    );
  };
  const addPhrase = (
    index: number,
    rect: Frame,
    fontSize: number,
    serif = false,
    align: "left" | "center" | "right" = "left",
  ) => {
    const phrases = content.phrases ?? [];
    const element = textElement(
      phrases.length
        ? phrases[(offset + index) % phrases.length]!
        : content.phrases
          ? ""
          : "在这里写下你的短语",
      rect,
      fontSize,
    );
    element.name = `短语 ${index + 1}`;
    element.style = {
      ...element.style,
      color: ink,
      fontFamily: serif ? "Noto Serif SC" : "Noto Sans SC",
      lineHeight: 1.65,
      align,
    };
    while (
      element.style.fontSize > 7 &&
      Math.ceil(
        Array.from(element.text).length /
          Math.max(1, Math.floor(rect.width / element.style.fontSize)),
      ) *
        element.style.fontSize *
        element.style.lineHeight >
        rect.height
    )
      element.style.fontSize--;
    page.elements.push(element);
  };
  const addSticker = (rect: Frame, rotation: number) => {
    const stickers = content.stickers ?? [];
    const asset = stickers.length
      ? stickers[offset % stickers.length]
      : undefined;
    page.elements.push(
      asset
        ? { ...imageElement(asset, rect, "sticker"), rotation }
        : {
            id: id(),
            type: "photoSlot",
            role: "sticker",
            name: "贴纸位置",
            frame: rect,
            rotation,
            opacity: 1,
            locked: false,
            visible: true,
          },
    );
  };
  const marker = textElement(
    {
      monologue: "A QUIET / MOMENT",
      dialogue: "BETWEEN / US",
      fieldnotes: "NOTES / FROM HERE",
      letter: "A LETTER / TO KEEP",
    }[layout],
    frame(8, 5, 84, 3),
    7.5,
  );
  marker.name = "页眉标记";
  marker.style.color = accent;
  marker.style.letterSpacing = 1.2;
  page.elements.push(marker);
  switch (layout) {
    case "monologue":
      addPhoto(0, frame(8, 14, 84, 51));
      addPhrase(0, frame(8, 72, 65, 17), 17, true);
      addSticker(frame(78, 76, 14, 12), -7);
      break;
    case "dialogue":
      addPhoto(0, frame(8, 14, 39, 47));
      addPhoto(1, frame(53, 24, 39, 47));
      addPhrase(0, frame(8, 66, 39, 22), 12, true);
      addPhrase(1, frame(53, 76, 39, 13), 10);
      addSticker(frame(74, 10, 16, 11), 5);
      break;
    case "fieldnotes":
      addPhrase(0, frame(8, 12, 84, 12), 19, true);
      addPhoto(0, frame(8, 28, 53, 43));
      addPhoto(1, frame(65, 28, 27, 20));
      addPhoto(2, frame(65, 51, 27, 20));
      addSticker(frame(8, 77, 16, 12), -5);
      addPhrase(1, frame(30, 77, 62, 14), 11);
      break;
    case "letter":
      addPhoto(0, frame(10, 16, 53, 37), -3);
      addPhoto(1, frame(45, 57, 43, 29), 3);
      addPhrase(0, frame(67, 17, 25, 33), 12, true);
      addPhrase(1, frame(8, 64, 30, 23), 10);
      addSticker(frame(13, 54, 16, 9), -8);
      break;
  }
  return page;
}
