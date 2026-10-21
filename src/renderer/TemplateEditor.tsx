import { useEffect, useRef, useState } from "react";
import {
  type Album,
  type Edit,
  type Element,
  defaultSettings,
  id,
  textElement,
} from "../domain/model";
import type { LayoutTemplate } from "../domain/layouts";
import { applyEditCore } from "../domain/edit-core";
import { Canvas } from "./Canvas";
import { Inspector } from "./Inspector";
import { ensureFonts } from "./Scene";

export function TemplateEditor({
  initial,
  onClose,
  onSaved,
  report,
}: {
  initial: LayoutTemplate;
  onClose: () => void;
  onSaved: () => Promise<void>;
  report: (text: string) => void;
}) {
  const [value, setValue] = useState(() => structuredClone(initial)),
    live = useRef(value);
  const [selected, setSelected] = useState(""),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const history = useRef<LayoutTemplate[]>([]);
  const future = useRef<LayoutTemplate[]>([]);
  const asAlbum = (t: LayoutTemplate): Album => ({
    schemaVersion: 1,
    id: "template-draft",
    name: t.name || "未命名排版",
    revision: 0,
    updatedAt: "",
    size: t.size,
    theme: "paper",
    pages: [
      {
        id: "template-cover",
        role: "cover",
        background: "#ffffff",
        elements: [],
      },
      t.page,
    ],
    assets: [],
    annotations: [],
  });
  const album = asAlbum(value),
    element = value.page.elements.find((e) => e.id === selected);
  useEffect(() => {
    void ensureFonts(album).catch((e) => report(e.message));
  }, [value]);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    if (dirty)
      draftTimer.current = setTimeout(
        () =>
          void window.memorybook
            .saveTemplateDraft(value)
            .catch((e) => report(e.message)),
        450,
      );
    return () => clearTimeout(draftTimer.current);
  }, [value, dirty]);
  async function close() {
    clearTimeout(draftTimer.current);
    await window.memorybook.saveTemplateDraft(null);
    onClose();
  }
  function update(next: LayoutTemplate) {
    future.current = [];
    history.current.push(structuredClone(live.current));
    if (history.current.length > 50) history.current.shift();
    live.current = next;
    setValue(next);
    setDirty(true);
  }
  function undo(redo = false) {
    const from = redo ? future.current : history.current,
      to = redo ? history.current : future.current;
    const next = from.pop();
    if (next) {
      to.push(structuredClone(live.current));
      live.current = next;
      setValue(next);
      setDirty(true);
    }
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        busy ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      const mod = event.ctrlKey || event.metaKey,
        key = event.key.toLowerCase();
      if (mod && ["z", "y"].includes(key)) {
        event.preventDefault();
        undo(key === "y" || event.shiftKey);
        return;
      }
      if (event.key === "Escape") {
        setSelected("");
        return;
      }
      const element = live.current.page.elements.find((e) => e.id === selected);
      if (!element || element.locked) return;
      const pageId = live.current.page.id;
      if (event.key === "Delete") {
        event.preventDefault();
        commit({ type: "removeElement", pageId, elementId: element.id });
        setSelected("");
      }
      if (mod && key === "d") {
        event.preventDefault();
        const copy = structuredClone(element);
        copy.id = id();
        copy.frame.x += 8;
        copy.frame.y += 8;
        commit({ type: "addElement", pageId, element: copy });
        setSelected(copy.id);
      }
      if (
        !mod &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        commit({
          type: "translateElement",
          pageId,
          elementId: element.id,
          dx:
            event.key === "ArrowLeft"
              ? -step
              : event.key === "ArrowRight"
                ? step
                : 0,
          dy:
            event.key === "ArrowUp"
              ? -step
              : event.key === "ArrowDown"
                ? step
                : 0,
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  function commit(edit: Edit) {
    if (edit.type === "annotation" || edit.type === "batch") return;
    try {
      const next = applyEditCore(asAlbum(live.current), edit);
      const page = next.pages[1]!;
      update({
        ...live.current,
        page,
        phraseIds: [
          ...live.current.phraseIds.filter((key) =>
            page.elements.some((e) => e.id === key),
          ),
          ...(edit.type === "addElement" &&
          edit.element.type === "text" &&
          live.current.phraseIds.includes(selected)
            ? [edit.element.id]
            : []),
        ],
      });
    } catch (e) {
      report((e as Error).message);
    }
  }
  function add(kind: "photo" | "sticker" | "phrase" | "text") {
    const current = live.current,
      small = kind === "sticker";
    const e: Element =
      kind === "text" || kind === "phrase"
        ? textElement(
            kind === "phrase" ? "短语位置" : "固定文字",
            { x: 32, y: 40, width: current.size.width - 64, height: 65 },
            16,
          )
        : {
            id: id(),
            type: "photoSlot",
            role: kind,
            name: small ? "贴纸位置" : "照片位置",
            frame: {
              x: 32,
              y: 60,
              width: small ? 70 : current.size.width * 0.55,
              height: small ? 70 : current.size.height * 0.4,
            },
            rotation: 0,
            opacity: 1,
            locked: false,
            visible: true,
          };
    update({
      ...current,
      page: { ...current.page, elements: [...current.page.elements, e] },
      phraseIds:
        kind === "phrase" ? [...current.phraseIds, e.id] : current.phraseIds,
    });
    setSelected(e.id);
  }
  return (
    <div className="modal-backdrop template-backdrop">
      <section
        className="template-editor"
        role="dialog"
        aria-modal="true"
        aria-label="排版编辑器"
        data-dirty={dirty}
      >
        <header>
          <div>
            <p className="eyebrow">
              {value.kind === "cover"
                ? "封面排版 · 标题与城市可自动填入"
                : "内页排版 · 参与随机生成"}
            </p>
            <input
              aria-label="排版名称"
              maxLength={60}
              value={value.name}
              onChange={(e) =>
                update({ ...live.current, name: e.target.value })
              }
            />
          </div>
          <div className="button-row">
            <button
              disabled={busy || !history.current.length}
              onClick={() => undo()}
            >
              撤销
            </button>
            <button
              disabled={busy || !future.current.length}
              onClick={() => undo(true)}
            >
              重做
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (!dirty || window.confirm("尚未保存排版，放弃修改并关闭？"))
                  void close().catch((e) => report(e.message));
              }}
            >
              关闭
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await window.memorybook.saveLayout(live.current);
                  await onSaved();
                  setDirty(false);
                  await close();
                } catch (e) {
                  report((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              保存排版
            </button>
          </div>
        </header>
        <div className="template-workspace">
          <aside className="template-palette">
            <label className="check">
              <input
                type="checkbox"
                checked={value.kind === "cover"}
                disabled={value.id.startsWith("builtin-")}
                onChange={(e) => {
                  const next = { ...live.current };
                  if (e.target.checked) next.kind = "cover";
                  else delete next.kind;
                  update(next);
                }}
              />
              用作封面
            </label>
            <h4>添加位置</h4>
            <button onClick={() => add("photo")}>＋ 照片位置</button>
            <button onClick={() => add("sticker")}>＋ 贴纸位置</button>
            <button onClick={() => add("phrase")}>＋ 短语位置</button>
            <button onClick={() => add("text")}>＋ 固定文字</button>
            <p className="muted">
              照片和贴纸在生成时填入；短语位置从短语库取句子，固定文字原样保留。
            </p>
            <h4>图层</h4>
            {value.page.elements.map((e) => (
              <button
                className={selected === e.id ? "selected" : ""}
                key={e.id}
                onClick={() => setSelected(e.id)}
              >
                {e.name || e.type}
              </button>
            ))}
          </aside>
          <main className="template-canvas">
            <Canvas
              album={album}
              page={value.page}
              selected={selected}
              onSelect={setSelected}
              onChange={(e) =>
                commit({
                  type: "replaceElement",
                  pageId: value.page.id,
                  element: e,
                })
              }
              readOnly={busy}
              settings={defaultSettings}
              zoom={0.8}
            />
          </main>
          <div className="template-properties">
            {element?.type === "text" && (
              <>
                <label className="field">
                  文字用途
                  <select
                    aria-label="文字用途"
                    value={
                      element.name === "封面标题"
                        ? "title"
                        : element.name === "城市角标"
                          ? "city"
                          : value.phraseIds.includes(element.id)
                            ? "phrase"
                            : "fixed"
                    }
                    onChange={(e) => {
                      const role = e.target.value;
                      update({
                        ...live.current,
                        page: {
                          ...live.current.page,
                          elements: live.current.page.elements.map((el) =>
                            el.id === element.id
                              ? {
                                  ...el,
                                  name:
                                    role === "title"
                                      ? "封面标题"
                                      : role === "city"
                                        ? "城市角标"
                                        : "固定文字",
                                }
                              : el,
                          ),
                        },
                        phraseIds:
                          role === "phrase"
                            ? [
                                ...new Set([
                                  ...live.current.phraseIds,
                                  element.id,
                                ]),
                              ]
                            : live.current.phraseIds.filter(
                                (id) => id !== element.id,
                              ),
                      });
                    }}
                  >
                    <option value="fixed">固定文字</option>
                    <option value="phrase">从短语库填入</option>
                    <option value="title">纪念册标题</option>
                    <option value="city">城市或角标</option>
                  </select>
                </label>
              </>
            )}
            <Inspector
              key={value.page.id + ":" + selected}
              album={album}
              page={value.page}
              element={element}
              edit={commit}
              disabled={busy}
              onReplace={() =>
                report(
                  "这是排版占位，生成纪念册时自动填入图片。排版编辑器不导入原图。",
                )
              }
            />
          </div>
        </div>
        <footer>
          Delete 删除 · 方向键微调 · Shift 加速 · Ctrl+D 复制 · Ctrl+Z 撤销 ·
          Ctrl+Y 重做。
          {value.kind === "cover"
            ? "封面可设置自动填入标题和角标。"
            : "内页至少保留一个照片位置。"}
        </footer>
      </section>
    </div>
  );
}
