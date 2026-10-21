import type { Edit, Page } from "../domain/model";
export function EditorActions({
  page,
  ids,
  disabled,
  edit,
  onSelect,
  onCrop,
  onCover,
}: {
  page: Page;
  ids: string[];
  disabled: boolean;
  edit: (e: Edit) => void;
  onSelect: (ids: string[]) => void;
  onCrop: (e: Extract<Page["elements"][number], { type: "image" }>) => void;
  onCover: () => void;
}) {
  const selected = page.elements.filter((e) => ids.includes(e.id));
  const unlocked = selected.filter((e) => !e.locked);
  const first = selected[0];
  return (
    <div className="editor-quick-actions" aria-label="快捷操作">
      <span className="tool-group-label">常用操作</span>
      {page.role === "cover" && (
        <button disabled={disabled} onClick={onCover}>
          封面排版
        </button>
      )}
      <button
        disabled={
          disabled ||
          first?.type !== "image" ||
          first.locked ||
          selected.length !== 1
        }
        onClick={() => {
          if (first?.type === "image") onCrop(first);
        }}
      >
        裁切取景
      </button>
      <button
        title="复制所选元素 · Ctrl+D"
        disabled={disabled || !unlocked.length}
        onClick={() => {
          const groups = new Map<string, string>();
          const copies = unlocked.map((e) => {
            if (e.groupId && !groups.has(e.groupId))
              groups.set(e.groupId, crypto.randomUUID());
            return {
              ...structuredClone(e),
              id: crypto.randomUUID(),
              ...(e.groupId ? { groupId: groups.get(e.groupId)! } : {}),
              frame: { ...e.frame, x: e.frame.x + 8, y: e.frame.y + 8 },
            };
          });
          edit({
            type: "batch",
            edits: copies.map((element) => ({
              type: "addElement",
              pageId: page.id,
              element,
            })),
          });
          onSelect(copies.map((e) => e.id));
        }}
      >
        复制所选
      </button>
      <span className="tool-divider" />
      <button
        disabled={
          disabled ||
          selected.length !== 1 ||
          !unlocked.length ||
          page.elements.at(-1)?.id === first?.id
        }
        title="向上移动一层 · Ctrl+]"
        onClick={() =>
          first &&
          edit({
            type: "layer",
            pageId: page.id,
            elementId: first.id,
            direction: "up",
          })
        }
      >
        上移一层
      </button>
      <button
        disabled={
          disabled ||
          selected.length !== 1 ||
          !unlocked.length ||
          page.elements[0]?.id === first?.id
        }
        title="向下移动一层 · Ctrl+["
        onClick={() =>
          first &&
          edit({
            type: "layer",
            pageId: page.id,
            elementId: first.id,
            direction: "down",
          })
        }
      >
        下移一层
      </button>
      <button
        disabled={disabled || !selected.length}
        onClick={() =>
          edit({
            type: "batch",
            edits: selected.map((e) => ({
              type: "patchElement",
              pageId: page.id,
              elementId: e.id,
              patch: { locked: unlocked.length > 0 },
            })),
          })
        }
      >
        {selected.length > 0 && !unlocked.length ? "解锁所选" : "锁定所选"}
      </button>
      <span className="tool-hint">
        Shift 加选 · 方向键微调 · 双击改文字 / 取景
      </span>
    </div>
  );
}
