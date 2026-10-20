import { useState } from "react";
import type { Album } from "../domain/model";
import { Scene } from "./Scene";
export function Comparison({
  snapshots,
  initialPageId,
  onClose,
  onUndo,
  onReject,
  annotations,
}: {
  snapshots: { before: Album; after: Album };
  initialPageId: string;
  onClose: () => void;
  onUndo: () => void;
  onReject?: (noteId: string) => void;
  annotations?: Album["annotations"];
}) {
  const [pageId, setPageId] = useState(initialPageId);
  const before =
    snapshots.before.pages.find((p) => p.id === pageId) ??
    snapshots.before.pages[0]!;
  const after = snapshots.after.pages.find((p) => p.id === before.id)!;
  return (
    <div className="modal-backdrop">
      <section
        className="comparison-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="AI 修改前后"
      >
        <header>
          <h2>AI 修改前后</h2>
          <select
            aria-label="对比页面"
            value={before.id}
            onChange={(event) => setPageId(event.target.value)}
          >
            {snapshots.before.pages.map((p, i) => (
              <option key={p.id} value={p.id}>
                第 {i + 1} 页
              </option>
            ))}
          </select>
          <button onClick={onClose}>完成</button>
        </header>
        <div className="comparison-pages">
          <div>
            <h4>修改前</h4>
            <Scene album={snapshots.before} page={before} />
          </div>
          <div>
            <h4>修改后</h4>
            <Scene album={snapshots.after} page={after} />
          </div>
        </div>
        <footer>
          <div>
            {snapshots.after.annotations
              .filter((n) => n.pageId === before.id)
              .map((note) => {
                const status = annotations
                  ? annotations.find((n) => n.id === note.id)?.status
                  : note.status;
                return (
                  <p key={note.id}>
                    <strong>
                      {status === "applied"
                        ? "已应用"
                        : status === "needsInput"
                          ? "需说明"
                          : "已变更／待处理"}
                    </strong>{" "}
                    · {note.message || note.text}
                    {status === "applied" && onReject && (
                      <button onClick={() => onReject(note.id)}>
                        撤回此条修改
                      </button>
                    )}
                  </p>
                );
              })}
          </div>
          <button onClick={onUndo}>撤销本次 AI 修改</button>
        </footer>
      </section>
    </div>
  );
}
