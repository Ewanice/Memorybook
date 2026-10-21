import type { Album, Page, ImageElement } from "./model";
import { DomainError } from "./model";
import { defaultImageEffects } from "./model";
import type { LayoutTemplate } from "./layouts";
import { instantiateLayout } from "./layouts";
import { layoutCapacity } from "./templates";
import { scaleImageEffects } from "./image-effects";

export function reflowPage(
  album: Album,
  page: Page,
  template: LayoutTemplate,
): Page[] {
  const photos = page.elements.filter(
    (e): e is ImageElement => e.type === "image" && e.role === "photo",
  );
  const stickers = page.elements.filter(
    (e): e is ImageElement => e.type === "image" && e.role === "sticker",
  );
  const texts = page.elements.filter((e) => e.type === "text");
  const capacity = layoutCapacity(template);
  if (!capacity && photos.length)
    throw new DomainError("这个排版没有照片位置，请选择含照片位置的排版。");
  const result: Page[] = [];
  let text = 0,
    sticker = 0;
  for (
    let offset = 0;
    offset < Math.max(1, photos.length);
    offset += Math.max(1, capacity)
  ) {
    const group = photos.slice(offset, offset + capacity);
    const next = instantiateLayout(
      template,
      album.size,
      group.map((e) => album.assets.find((a) => a.id === e.assetId)!),
      [],
      [],
      0,
      !photos.length,
    );
    let photo = 0;
    next.elements = next.elements.flatMap<import("./model").Element>(
      (element) => {
        if (element.type === "image" && element.role === "photo") {
          const original = group[photo++];
          return original
            ? [
                {
                  ...structuredClone(original),
                  frame: element.frame,
                  rotation: element.rotation,
                  effects: structuredClone(
                    element.effects ?? defaultImageEffects,
                  ),
                },
              ]
            : [];
        }
        if (element.type === "text") {
          const original = texts[text++];
          return original
            ? [
                {
                  ...element,
                  id: original.id,
                  text: original.text,
                  name: original.name,
                },
              ]
            : [];
        }
        return [element];
      },
    );
    // Sticker slots are optional during instantiation, so place original
    // stickers into their scaled template frames explicitly.
    const sx = album.size.width / template.size.width,
      sy = album.size.height / template.size.height;
    for (const slot of template.page.elements.filter(
      (e) => e.type === "photoSlot" && e.role === "sticker",
    )) {
      const original = stickers[sticker++];
      if (original)
        next.elements.push({
          ...structuredClone(original),
          frame: {
            x: slot.frame.x * sx,
            y: slot.frame.y * sy,
            width: slot.frame.width * sx,
            height: slot.frame.height * sy,
          },
          rotation: slot.rotation,
          effects: scaleImageEffects(
            slot.type === "photoSlot"
              ? (slot.effects ?? defaultImageEffects)
              : defaultImageEffects,
            Math.min(sx, sy),
          ),
        });
    }
    result.push(next);
  }
  const first = result[0]!;
  first.id = page.id;
  first.role = page.role;
  // Preserve surplus content rather than silently discarding it. The preview
  // lets the user review these elements before committing the replacement.
  first.elements.push(
    ...structuredClone(texts.slice(text)),
    ...structuredClone(stickers.slice(sticker)),
  );
  if (
    first.elements.length > 100 ||
    album.pages.length + result.length - 1 > 100
  )
    throw new DomainError("套用后超出页面或元素数量限制，请先拆分当前页。");
  return result;
}
