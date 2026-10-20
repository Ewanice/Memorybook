import { composeClassicPage } from "./classic-layouts";
import { layoutPalette } from "./art-direction";
import {
  type Album,
  type Asset,
  type Page,
  type Settings,
  DomainError,
  id,
  imageElement,
  textElement,
  sizes,
} from "./model";
import {
  composePage,
  compositionLabels,
  compositionCapacity,
  type Composition,
  type CompositionContent,
} from "./compositions";
import {
  type LayoutTemplate,
  instantiateLayout,
  shuffledCycle,
} from "./layouts";
export type TemplateName =
  | Composition
  | "hero"
  | "duo"
  | "three"
  | "grid"
  | "index"
  | "chapter"
  | "ticket"
  | "ending"
  | "blank";
export type CreateOptions = {
  customSize?: Album["size"];
  density: "spacious" | "standard" | "rich";
  coverMode: "photo" | "complete";
  layout?: "auto" | "collection" | "random" | Composition;
  usePhrases?: boolean;
  randomSeed?: number;
  pagination?: import("./pagination").Pagination;
  generator?: "local" | "codex";
  codexMode?: "templates" | "creative";
};
export const defaultCreateOptions: CreateOptions = {
  density: "standard",
  coverMode: "photo",
};
export const templateLabels: Record<TemplateName, string> = {
  ...compositionLabels,
  blank: "空白页",
  hero: "单张主图",
  duo: "双图故事",
  three: "三图叙事",
  grid: "四格回忆",
  index: "六图索引",
  chapter: "章节扉页",
  ticket: "票根与回忆",
  ending: "尾页",
};
export function suggestedPageCount(
  photoCount: number,
  density: CreateOptions["density"],
  layout: CreateOptions["layout"] = "auto",
  seed = 1,
  custom: LayoutTemplate[] = [],
): number {
  if (layout === "random")
    return randomLayoutPlan(photoCount, seed, custom).length + 1;
  if (layout && layout !== "auto") {
    let remaining = Math.max(0, photoCount - 1),
      pages = 1,
      index = 0;
    const cycle = Object.keys(compositionLabels) as Composition[];
    do {
      const selected =
        layout === "collection" ? cycle[index++ % cycle.length]! : layout;
      remaining -= compositionCapacity[selected];
      pages++;
    } while (remaining > 0 && pages <= 101);
    return pages;
  }
  const capacity = density === "spacious" ? 2 : density === "rich" ? 6 : 4;
  return Math.max(2, 1 + Math.ceil(Math.max(0, photoCount - 1) / capacity));
}
export function createPage(
  size: Album["size"],
  theme: Album["theme"],
  layout: TemplateName,
  assets: Asset[] = [],
  content: CompositionContent = {},
): Page {
  if (Object.hasOwn(compositionLabels, layout))
    return composePage(size, theme, layout as Composition, assets, content);
  return composeClassicPage(size, theme, layout, assets, content);
}

export function createAlbum(
  name: string,
  city: string,
  theme: Album["theme"],
  pageSize: Settings["pageSize"],
  assets: Asset[],
  options: CreateOptions = defaultCreateOptions,
  content: CompositionContent = {},
): Album {
  if (
    options.customSize &&
    ![options.customSize.width, options.customSize.height].every(
      (n) => Number.isFinite(n) && n >= 283.464 && n <= 1275.591,
    )
  )
    throw new DomainError("自定义成品尺寸每边须在 100–450 mm 之间。");
  if (
    !["spacious", "standard", "rich"].includes(options.density) ||
    !["photo", "complete"].includes(options.coverMode) ||
    (options.layout !== undefined &&
      ![
        "auto",
        "collection",
        "random",
        ...Object.keys(compositionLabels),
      ].includes(options.layout)) ||
    (options.randomSeed !== undefined &&
      (!Number.isInteger(options.randomSeed) ||
        options.randomSeed < 0 ||
        options.randomSeed > 4294967295)) ||
    (options.usePhrases !== undefined &&
      typeof options.usePhrases !== "boolean")
  )
    throw new DomainError("生成选项无效。");
  if (
    suggestedPageCount(
      assets.length,
      options.density,
      options.layout,
      options.randomSeed,
      content.customLayouts,
    ) > 100
  )
    throw new DomainError(
      "所选排版将超过 100 页，请减少照片或改用丰富密度的基础网格。",
    );
  if (options.coverMode === "complete" && !assets[0])
    throw new DomainError("完整封面模式需要先导入一张封面图片。");
  const size = options.customSize ? { ...options.customSize } : sizes[pageSize];
  const coverPalette = layoutPalette("monologue", theme);
  const title = textElement(
    name || "我的纪念册",
    {
      x: 28,
      y: size.height * 0.75,
      width: size.width - 56,
      height: size.height * 0.18,
    },
    32,
  );
  title.style.bold = true;
  title.style.color = coverPalette.ink;
  title.name = "封面标题";
  title.style.fontFamily = theme === "paper" ? "Noto Serif SC" : "Noto Sans SC";
  const badge = textElement(
    city,
    { x: 28, y: size.height - 36, width: size.width - 56, height: 20 },
    10,
  );
  badge.style.color = coverPalette.accent;
  badge.name = "城市角标";
  const cover: Page = {
    id: id(),
    role: "cover",
    background: coverPalette.background,
    backgroundStyle: coverPalette.paper,
    elements: [],
  };
  if (assets[0])
    cover.elements.push(
      imageElement(assets[0], {
        x: 0,
        y: 0,
        width: size.width,
        height:
          options.coverMode === "complete" ? size.height : size.height * 0.69,
      }),
    );
  if (options.coverMode !== "complete") cover.elements.push(title, badge);
  const pages = [cover];
  const capacity =
    options.density === "spacious" ? 2 : options.density === "rich" ? 6 : 4;
  if (options.layout === "random") {
    let photo = 1;
    for (const [index, template] of randomLayoutPlan(
      assets.length,
      options.randomSeed ?? 1,
      content.customLayouts,
      size,
      theme,
    ).entries()) {
      const capacity = layoutCapacity(template);
      pages.push(
        instantiateLayout(
          template,
          size,
          assets.slice(photo, photo + capacity),
          content.stickers ?? [],
          content.phrases ?? [],
          index,
          assets.length <= 1,
        ),
      );
      photo += capacity;
    }
  }
  for (let i = 1; options.layout !== "random" && i < assets.length;) {
    const cycle = Object.keys(compositionLabels) as Composition[];
    const professional =
      options.layout && options.layout !== "auto"
        ? options.layout === "collection"
          ? cycle[(pages.length - 1) % cycle.length]!
          : options.layout
        : null;
    const usedCapacity = professional
      ? compositionCapacity[professional]
      : capacity;
    const group = assets.slice(i, i + usedCapacity);
    const layouts = {
      1: "hero",
      2: "duo",
      3: "three",
      4: "grid",
      5: "index",
      6: "index",
    } as const;
    const p = createPage(
      size,
      theme,
      professional ?? layouts[group.length as keyof typeof layouts],
      group,
      { ...content, offset: pages.length - 1 },
    );
    p.elements = p.elements.filter((e) => e.type !== "photoSlot");
    pages.push(p);
    i += usedCapacity;
  }
  if (pages.length === 1) {
    const layout =
      options.layout && options.layout !== "auto" && options.layout !== "random"
        ? options.layout === "collection"
          ? "monologue"
          : options.layout
        : "blank";
    const p = createPage(size, theme, layout, [], content);
    p.elements = p.elements.filter(
      (e) => !(e.type === "photoSlot" && e.role === "sticker"),
    );
    pages.push(p);
  }
  const album: Album = {
    schemaVersion: 1,
    id: id(),
    revision: 0,
    name: name || "我的纪念册",
    updatedAt: new Date().toISOString(),
    size,
    theme,
    pages,
    assets: [
      ...new Map(
        [...assets, ...(content.stickers ?? [])].map((a) => [a.id, a]),
      ).values(),
    ],
    assetLibrary: {
      photos: [...new Set(assets.map((a) => a.id))],
      stickers: [...new Set((content.stickers ?? []).map((a) => a.id))],
    },
    annotations: [],
    ...(options.pagination ? { pagination: options.pagination } : {}),
  };
  return album;
}

export function layoutCapacity(template: LayoutTemplate): number {
  return template.page.elements.filter(
    (e) => e.type === "photoSlot" && e.role !== "sticker",
  ).length;
}
export function layoutCatalog(
  size: Album["size"] = sizes.a5,
  theme: Album["theme"] = "paper",
  custom: LayoutTemplate[] = [],
): LayoutTemplate[] {
  return [
    ...(Object.keys(templateLabels) as TemplateName[])
      .filter((name) => name !== "blank" && name !== "ending")
      .map((name) => {
        const page = createPage(size, theme, name);
        if (
          !page.elements.some(
            (e) => e.type === "photoSlot" && e.role === "sticker",
          )
        ) {
          const caption = page.elements.find(
            (e) => e.type === "text" && e.name === "回忆文字",
          );
          if (caption) caption.frame.width = size.width - 132;
          page.elements.push({
            id: id(),
            type: "photoSlot",
            role: "sticker",
            name: "贴纸位置",
            frame: {
              x: size.width - 76,
              y: size.height - 80,
              width: 44,
              height: 44,
            },
            rotation: -6,
            opacity: 1,
            visible: true,
            locked: false,
          });
        }
        return {
          id: "builtin-" + name,
          name: templateLabels[name],
          size,
          page,
          phraseIds: page.elements
            .filter(
              (e) =>
                e.type === "text" &&
                (e.name.startsWith("短语") || e.name === "回忆文字"),
            )
            .map((e) => e.id),
        };
      }),
    ...custom,
  ];
}
export function randomLayoutPlan(
  count: number,
  seed: number,
  custom: LayoutTemplate[] = [],
  size = sizes.a5,
  theme: Album["theme"] = "paper",
): LayoutTemplate[] {
  const next = shuffledCycle(layoutCatalog(size, theme, custom), seed);
  const result: LayoutTemplate[] = [];
  let remaining = Math.max(0, count - 1);
  do {
    const t = next();
    result.push(t);
    remaining -= layoutCapacity(t);
  } while (remaining > 0 && result.length < 100);
  return result;
}
