import { id, textElement, type Album, type Asset, type Page } from "./model";
import { layoutPalette } from "./art-direction";
import { instantiateLayout, fitPhrase, type LayoutTemplate } from "./layouts";
export function coverPhotoIndices(album: Album, photos: Asset[]): number[] {
  const used = new Set(
    album.pages[0]?.elements.flatMap((e) =>
      e.type === "image" && e.role === "photo" ? [e.assetId] : [],
    ) ?? [],
  );
  return photos.flatMap((a, i) => (used.has(a.id) ? [i] : []));
}

export function defaultCovers(
  size: Album["size"],
  theme: Album["theme"],
): LayoutTemplate[] {
  const palette = layoutPalette("monologue", theme);
  return (["photo", "complete"] as const).map((mode) => {
    const complete = mode === "complete";
    const title = textElement(
      "纪念册标题",
      {
        x: 28,
        y: complete ? 0 : size.height * 0.75,
        width: size.width - 56,
        height: size.height * 0.18,
      },
      complete ? 28 : 32,
    );
    title.name = "封面标题";
    title.style = {
      ...title.style,
      bold: true,
      color: complete ? "#ffffff" : palette.ink,
      align: complete ? "center" : "left",
      fontFamily: theme === "paper" ? "Noto Serif SC" : "Noto Sans SC",
    };
    const badge = textElement(
      "城市角标",
      { x: 28, y: size.height - 36, width: size.width - 56, height: 20 },
      10,
    );
    badge.name = "城市角标";
    badge.style.color = complete ? "#ffffff" : palette.accent;
    const page: Page = {
      id: id(),
      role: "content",
      background: palette.background,
      backgroundStyle: palette.paper,
      elements: [
        {
          id: id(),
          type: "photoSlot",
          role: "photo",
          name: "封面图片",
          frame: {
            x: 0,
            y: 0,
            width: size.width,
            height: complete ? size.height : size.height * 0.69,
          },
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
        },
        title,
        badge,
      ],
    };
    return {
      id: "builtin-cover-" + mode,
      name: complete ? "完整图片封面" : "照片与标题封面",
      kind: "cover",
      size,
      page,
      phraseIds: [],
    };
  });
}
export function coverCatalog(
  size: Album["size"],
  theme: Album["theme"],
  custom: LayoutTemplate[] = [],
  hidden: string[] = [],
): LayoutTemplate[] {
  const all = new Map(defaultCovers(size, theme).map((t) => [t.id, t]));
  for (const t of custom.filter((t) => t.kind === "cover")) all.set(t.id, t);
  return [...all.values()].filter((t) => !hidden.includes(t.id));
}
export function instantiateCover(
  template: LayoutTemplate,
  size: Album["size"],
  photos: Asset[],
  stickers: Asset[],
  phrases: string[],
  name: string,
  city: string,
  keepSlots = false,
): Page {
  const page = instantiateLayout(
    template,
    size,
    photos,
    stickers,
    phrases,
    0,
    keepSlots,
  );
  page.role = "cover";
  if (
    template.kind !== "cover" &&
    !page.elements.some((e) => e.type === "text" && e.name === "封面标题")
  ) {
    const heading = page.elements
      .filter((e) => e.type === "text")
      .sort((a, b) => b.style.fontSize - a.style.fontSize)[0];
    if (heading) heading.name = "封面标题";
  }
  for (const e of page.elements)
    if (e.type === "text") {
      if (e.name === "封面标题") e.text = name || "我的纪念册";
      if (e.name === "城市角标") e.text = city;
      fitPhrase(e);
    }
  return page;
}
