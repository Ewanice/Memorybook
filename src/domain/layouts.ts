import {
  type Album,
  type Page,
  type Asset,
  type Element,
  DomainError,
  id,
  imageElement,
} from "./model";
export type LayoutTemplate = {
  id: string;
  name: string;
  size: Album["size"];
  page: Page;
  phraseIds: string[];
};
export function fitPhrase(element: Extract<Element, { type: "text" }>): void {
  while (
    element.style.fontSize > 7 &&
    Math.ceil(
      Array.from(element.text).length /
        Math.max(
          1,
          Math.floor(
            element.frame.width /
              (element.style.fontSize +
                Math.max(0, element.style.letterSpacing ?? 0)),
          ),
        ),
    ) *
      element.style.fontSize *
      element.style.lineHeight >
      element.frame.height
  )
    element.style.fontSize--;
}
export function instantiateLayout(
  template: LayoutTemplate,
  size: Album["size"],
  photos: Asset[],
  stickers: Asset[],
  phrases: string[],
  offset = 0,
  keepSlots = false,
): Page {
  const sx = size.width / template.size.width,
    sy = size.height / template.size.height;
  let photo = 0,
    sticker = 0,
    phrase = offset;
  const page: Page = {
    id: id(),
    role: "content",
    background: template.page.background,
    ...(template.page.backgroundStyle
      ? { backgroundStyle: template.page.backgroundStyle }
      : {}),
    elements: [],
  };
  for (const original of template.page.elements) {
    let e = structuredClone(original);
    e.id = id();
    e.frame = {
      x: original.frame.x * sx,
      y: original.frame.y * sy,
      width: original.frame.width * sx,
      height: original.frame.height * sy,
    };
    if (e.type === "photoSlot") {
      const asset =
        e.role === "sticker"
          ? stickers.length
            ? stickers[(offset + sticker++) % stickers.length]
            : undefined
          : photos[photo++];
      if (asset)
        e = {
          ...imageElement(asset, e.frame, e.role ?? "photo"),
          id: e.id,
          rotation: e.rotation,
          opacity: e.opacity,
        };
      else if (!keepSlots || e.role === "sticker") continue;
    } else if (e.type === "text") {
      e.style.fontSize *= Math.min(sx, sy);
      if (template.phraseIds.includes(original.id)) {
        e.text = phrases.length ? phrases[phrase++ % phrases.length]! : "";
        fitPhrase(e);
      }
    }
    page.elements.push(e);
  }
  return page;
}
export function shuffledCycle<T>(items: T[], seed: number): () => T {
  if (!items.length) throw new DomainError("没有可用排版。");
  let state = seed >>> 0,
    bag: T[] = [];
  const random = () => {
    state += 0x6d2b79f5;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    if (!bag.length) {
      bag = [...items];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
    }
    return bag.pop()!;
  };
}
