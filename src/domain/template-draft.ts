import type { LayoutTemplate } from "./layouts";
import { assertAlbum } from "./validation";
import { DomainError } from "./model";
export function assertTemplateDraft(
  value: unknown,
): asserts value is LayoutTemplate {
  const t = value as LayoutTemplate;
  if (
    !t ||
    Object.keys(t).sort().join() !== "id,name,page,phraseIds,size" ||
    typeof t.id !== "string" ||
    !/^[\w-]{1,80}$/.test(t.id) ||
    typeof t.name !== "string" ||
    t.name.length > 60 ||
    !Array.isArray(t.phraseIds) ||
    t.phraseIds.length > 100 ||
    t.phraseIds.some((id) => typeof id !== "string") ||
    t.page?.role !== "content"
  )
    throw new DomainError("排版草稿格式损坏。");
  assertAlbum({
    schemaVersion: 1,
    id: "draft",
    revision: 0,
    name: "draft",
    updatedAt: "",
    theme: "paper",
    size: t.size,
    assets: [],
    annotations: [],
    pages: [
      { id: "draft-cover", role: "cover", background: "#ffffff", elements: [] },
      t.page,
    ],
  });
}
