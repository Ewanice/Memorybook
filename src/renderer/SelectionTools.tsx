import type { Element, Edit, Page } from "../domain/model";
export function SelectionTools({
  page,
  size: pageSize,
  ids,
  disabled,
  edit,
}: {
  page: Page;
  size: { width: number; height: number };
  ids: string[];
  disabled: boolean;
  edit: (edit: Edit) => void;
}) {
  const elements = page.elements.filter((e) => ids.includes(e.id) && !e.locked);
  const align = (
    axis: "x" | "y",
    mode: "start" | "center" | "end" | "distribute",
  ) => {
    const size = axis === "x" ? "width" : "height";
    const sorted = [...elements].sort((a, b) => a.frame[axis] - b.frame[axis]);
    const start =
        elements.length === 1
          ? 28
          : Math.min(...elements.map((e) => e.frame[axis])),
      end =
        elements.length === 1
          ? pageSize[axis === "x" ? "width" : "height"] - 28
          : Math.max(...elements.map((e) => e.frame[axis] + e.frame[size]));
    const gap =
      (end - start - elements.reduce((n, e) => n + e.frame[size], 0)) /
      Math.max(1, elements.length - 1);
    let cursor = start;
    const edits: Edit[] = sorted.map((e) => {
      let position: number;
      if (mode === "distribute") {
        position = cursor;
        cursor += e.frame[size] + gap;
      } else
        position =
          mode === "start"
            ? start
            : mode === "end"
              ? end - e.frame[size]
              : (start + end - e.frame[size]) / 2;
      return {
        type: "patchElement",
        pageId: page.id,
        elementId: e.id,
        patch: { frame: { [axis]: position } },
      };
    });
    edit({ type: "batch", edits });
  };
  if (!elements.length)
    return (
      <div className="selection-tools">
        <span className="muted">
          拖动空白区域框选 · Shift 加选 · 双击照片取景
        </span>
      </div>
    );
  return (
    <div className="selection-tools">
      <span>已选 {elements.length} 项</span>
      <select
        aria-label="对齐多个元素"
        value=""
        disabled={disabled}
        onChange={(e) => {
          const [axis, mode] = e.target.value.split(":");
          align(axis as "x" | "y", mode as "start");
        }}
      >
        <option value="" disabled>
          {elements.length === 1 ? "对齐到页面" : "对齐与分布"}
        </option>
        <option value="x:start">左对齐</option>
        <option value="x:center">水平居中</option>
        <option value="x:end">右对齐</option>
        <option value="y:start">顶部对齐</option>
        <option value="y:center">垂直居中</option>
        <option value="y:end">底部对齐</option>
        {elements.length > 2 && (
          <>
            <option value="x:distribute">水平等距</option>
            <option value="y:distribute">垂直等距</option>
          </>
        )}
      </select>
      <button
        disabled={disabled || elements.length < 2}
        onClick={() => {
          const groupId = crypto.randomUUID();
          edit({
            type: "batch",
            edits: elements.map((e) => ({
              type: "patchElement",
              pageId: page.id,
              elementId: e.id,
              patch: { groupId },
            })),
          });
        }}
      >
        组合
      </button>
      <button
        disabled={disabled || !elements.some((e) => e.groupId)}
        onClick={() =>
          edit({
            type: "batch",
            edits: elements.map((e) => ({
              type: "patchElement",
              pageId: page.id,
              elementId: e.id,
              patch: { groupId: null },
            })),
          })
        }
      >
        取消组合
      </button>
      <button
        disabled={disabled}
        onClick={() =>
          edit({
            type: "batch",
            edits: elements.map((element: Element) => ({
              type: "removeElement",
              pageId: page.id,
              elementId: element.id,
            })),
          })
        }
      >
        删除所选
      </button>
    </div>
  );
}
