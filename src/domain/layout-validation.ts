import { DomainError } from "./model";
import { assertAlbum } from "./validation";
import type { LayoutTemplate } from "./layouts";
export function assertLayout(input: unknown): asserts input is LayoutTemplate {
  if (!input || typeof input !== "object")
    throw new DomainError("排版数据无效。");
  const t = input as LayoutTemplate;
  if (
    Object.keys(t)
      .filter((k) => k !== "kind")
      .sort()
      .join() !== "id,name,page,phraseIds,size" ||
    (t.kind !== undefined && t.kind !== "cover") ||
    typeof t.id !== "string" ||
    !/^[\w-]{1,80}$/.test(t.id) ||
    typeof t.name !== "string" ||
    !t.name.trim() ||
    t.name.length > 60 ||
    !Array.isArray(t.phraseIds) ||
    new Set(t.phraseIds).size !== t.phraseIds.length ||
    t.page?.role !== "content"
  )
    throw new DomainError("排版名称或结构无效。");
  assertAlbum({
    schemaVersion: 1,
    id: "layout-validation",
    revision: 0,
    name: t.name,
    updatedAt: "",
    theme: "paper",
    size: t.size,
    pages: [
      {
        id: "layout-cover",
        role: "cover",
        background: "#ffffff",
        elements: [],
      },
      t.page,
    ],
    assets: [],
    annotations: [],
  });
  if (
    t.kind !== "cover" &&
    !t.page.elements.some((e) => e.type === "photoSlot" && e.role !== "sticker")
  )
    throw new DomainError("自动排版至少需要一个照片位置。");
  if (t.page.elements.some((e) => e.type === "image" || e.locked || !e.visible))
    throw new DomainError("排版请使用图片占位和文字，并保持元素可见、未锁定。");
  if (
    t.phraseIds.some(
      (phraseId) =>
        !t.page.elements.some((e) => e.id === phraseId && e.type === "text"),
    )
  )
    throw new DomainError("短语位置引用无效。");
  for (const role of ["封面标题", "城市角标"])
    if (
      t.page.elements.filter((e) => e.type === "text" && e.name === role)
        .length > 1
    )
      throw new DomainError("封面标题与城市角标各只能设置一个。");
  for (const e of t.page.elements) {
    const f = e.frame,
      r = (e.rotation * Math.PI) / 180;
    const w =
      (Math.abs(Math.cos(r)) * f.width + Math.abs(Math.sin(r)) * f.height) / 2;
    const h =
      (Math.abs(Math.sin(r)) * f.width + Math.abs(Math.cos(r)) * f.height) / 2;
    if (
      f.x + f.width / 2 - w < -0.01 ||
      f.y + f.height / 2 - h < -0.01 ||
      f.x + f.width / 2 + w > t.size.width + 0.01 ||
      f.y + f.height / 2 + h > t.size.height + 0.01
    )
      throw new DomainError("排版元素超出页面，请移动或缩小后保存。");
  }
}
