import { CommitInput } from "./Fields";
import { useContext } from "react";
import { FontContext } from "./fonts";
import { BackgroundPicker } from "./BackgroundPicker";
import type { Album, Edit, Element, Page } from "../domain/model";
import { elementPatch } from "../domain/model";
import { NumberField, TextField } from "./Fields";
import { textOverflows } from "../domain/text";
import { measureText } from "./Scene";
import { OutlineControls, ImageEffectControls } from "./EffectControls";
export function Inspector({
  album,
  page,
  element,
  edit,
  disabled,
  onReplace,
}: {
  album: Album;
  page: Page;
  element: Element | undefined;
  edit: (edit: Edit) => void;
  disabled: boolean;
  onReplace: () => void;
}) {
  const fonts = useContext(FontContext);
  if (!element)
    return (
      <aside className="inspector">
        <div className="panel-title">页面</div>
        <p className="muted">
          选择一个元素，调整它的位置、样式或添加 AI 批注。
        </p>
        <BackgroundPicker page={page} edit={edit} disabled={disabled} />
        <h4>图层</h4>
        <p className="muted">可在下方图层列表中选择被遮挡的元素。</p>
      </aside>
    );
  const el = element;
  const note = album.annotations.find((n) => n.elementId === el.id);
  const locked = disabled || el.locked;
  function change(value: Element) {
    edit({
      type: "patchElement",
      pageId: page.id,
      elementId: el.id,
      patch: elementPatch(el, value),
    });
  }
  return (
    <aside className="inspector">
      <BackgroundPicker page={page} edit={edit} disabled={disabled} />
      <div className="panel-title">
        {el.type === "text"
          ? "文字"
          : el.type === "photoSlot"
            ? "照片槽"
            : el.role === "sticker"
              ? "贴纸"
              : "照片"}
        <span>{el.locked ? "已锁定" : "可自由编辑"}</span>
      </div>
      {el.type === "text" ? (
        <>
          <label className="field">
            字体
            <select
              disabled={locked}
              value={el.style.fontFamily ?? "Noto Sans SC"}
              onChange={(event) =>
                change({
                  ...el,
                  style: {
                    ...el.style,
                    fontFamily: event.target.value,
                  },
                })
              }
            >
              <option value="Noto Sans SC">思源黑体</option>
              <option value="Noto Serif SC">思源宋体</option>
              {fonts.map((f) => (
                <option key={f.id} value={f.family}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <TextField
            key={el.id}
            value={el.text}
            multiline
            label="文字内容"
            disabled={locked}
            onSave={(text) => change({ ...el, text })}
          />
          <div className="field-row">
            <NumberField
              label="字号"
              value={el.style.fontSize}
              min={4}
              max={300}
              disabled={locked}
              onChange={(fontSize) =>
                change({ ...el, style: { ...el.style, fontSize } })
              }
            />
            <label className="field">
              颜色
              <CommitInput
                type="color"
                disabled={locked}
                value={el.style.color}
                onChange={(event) =>
                  change({
                    ...el,
                    style: { ...el.style, color: event.target.value },
                  })
                }
              />
            </label>
          </div>
          <div className="segmented">
            <button
              disabled={locked}
              className={el.style.bold ? "active" : ""}
              onClick={() =>
                change({ ...el, style: { ...el.style, bold: !el.style.bold } })
              }
            >
              加粗
            </button>
            {(["left", "center", "right"] as const).map((align, i) => (
              <button
                key={align}
                disabled={locked}
                className={el.style.align === align ? "active" : ""}
                onClick={() => change({ ...el, style: { ...el.style, align } })}
              >
                {["左", "中", "右"][i]}
              </button>
            ))}
          </div>
          {textOverflows(el, measureText) && (
            <p className="warning">文字超出文本框，请扩大文本框或缩小字号。</p>
          )}
          <OutlineControls
            outline={el.style.outline}
            disabled={locked}
            onChange={(outline) =>
              change({ ...el, style: { ...el.style, outline } })
            }
          />
        </>
      ) : el.type === "photoSlot" ? (
        <>
          <p className="muted">
            这个位置为{el.role === "sticker" ? "贴纸" : "照片"}
            保留。选择图片后会沿用这里的大小与位置。
          </p>
          <button className="wide" disabled={locked} onClick={onReplace}>
            {el.role === "sticker" ? "选择贴纸" : "选择照片"}
          </button>
        </>
      ) : (
        <>
          <button className="wide" disabled={locked} onClick={onReplace}>
            替换图片
          </button>
          <details open={el.role !== "sticker"}>
            <summary>调整画面</summary>
            <label className="field">
              显示方式
              <select
                disabled={locked}
                value={el.fit}
                onChange={(e) =>
                  change({ ...el, fit: e.target.value as "cover" | "contain" })
                }
              >
                <option value="cover">填满照片框</option>
                <option value="contain">完整显示</option>
              </select>
            </label>
            <label className="field">
              画面缩放
              <input
                disabled={locked}
                type="range"
                min="1"
                max="4"
                step="0.05"
                value={1 / el.crop.w}
                onChange={(event) => {
                  const w = 1 / Number(event.target.value);
                  change({
                    ...el,
                    crop: {
                      x: Math.min(el.crop.x, 1 - w),
                      y: Math.min(el.crop.y, 1 - w),
                      w,
                      h: w,
                    },
                  });
                }}
              />
            </label>
            <label className="field">
              横向取景
              <input
                disabled={locked}
                type="range"
                min="0"
                max={Math.max(0, 1 - el.crop.w)}
                step="0.005"
                value={el.crop.x}
                onChange={(event) =>
                  change({
                    ...el,
                    crop: { ...el.crop, x: Number(event.target.value) },
                  })
                }
              />
            </label>
            <label className="field">
              纵向取景
              <input
                disabled={locked}
                type="range"
                min="0"
                max={Math.max(0, 1 - el.crop.h)}
                step="0.005"
                value={el.crop.y}
                onChange={(event) =>
                  change({
                    ...el,
                    crop: { ...el.crop, y: Number(event.target.value) },
                  })
                }
              />
            </label>
          </details>
        </>
      )}
      {el.type !== "text" && (
        <ImageEffectControls
          effects={el.effects}
          disabled={locked}
          onChange={(effects) => change({ ...el, effects })}
        />
      )}
      <details>
        <summary>更多调整</summary>
        <div className="field-row">
          {(["x", "y", "width", "height"] as const).map((key, i) => (
            <NumberField
              key={key}
              label={["横向位置 pt", "纵向位置 pt", "宽度 pt", "高度 pt"][i]!}
              value={el.frame[key]}
              min={key === "width" || key === "height" ? 1 : -5000}
              max={5000}
              disabled={locked}
              onChange={(value) =>
                change({ ...el, frame: { ...el.frame, [key]: value } })
              }
            />
          ))}
        </div>
        <NumberField
          label="旋转角度"
          value={el.rotation}
          min={-360}
          max={360}
          disabled={locked}
          onChange={(rotation) => change({ ...el, rotation })}
        />
        <label className="field">
          不透明度
          <CommitInput
            type="range"
            min="0"
            max="1"
            step=".05"
            disabled={locked}
            value={el.opacity}
            onChange={(e) => change({ ...el, opacity: Number(e.target.value) })}
          />
        </label>
        {el.type === "text" && (
          <NumberField
            label="行距"
            min={0.8}
            max={3}
            step={0.1}
            value={el.style.lineHeight}
            disabled={locked}
            onChange={(lineHeight) =>
              change({ ...el, style: { ...el.style, lineHeight } })
            }
          />
        )}
        {el.type === "text" && (
          <NumberField
            label="字间距"
            min={-2}
            max={20}
            step={0.5}
            value={el.style.letterSpacing ?? 0}
            disabled={locked}
            onChange={(letterSpacing) =>
              change({ ...el, style: { ...el.style, letterSpacing } })
            }
          />
        )}
        <div className="button-row">
          <button
            disabled={locked}
            onClick={() =>
              edit({
                type: "layer",
                pageId: page.id,
                elementId: el.id,
                direction: "up",
              })
            }
          >
            上移一层
          </button>
          <button
            disabled={locked}
            onClick={() =>
              edit({
                type: "layer",
                pageId: page.id,
                elementId: el.id,
                direction: "down",
              })
            }
          >
            下移一层
          </button>
        </div>
      </details>
      <div className="button-row">
        <button
          disabled={disabled}
          onClick={() => change({ ...el, locked: !el.locked })}
        >
          {el.locked ? "解锁" : "锁定"}
        </button>
        <button
          disabled={locked}
          onClick={() =>
            edit({
              type: "addElement",
              pageId: page.id,
              element: {
                ...structuredClone(el),
                id: crypto.randomUUID(),
                frame: { ...el.frame, x: el.frame.x + 12, y: el.frame.y + 12 },
              },
            })
          }
        >
          复制
        </button>
        <button
          disabled={locked}
          className="danger-text"
          onClick={() =>
            edit({ type: "removeElement", pageId: page.id, elementId: el.id })
          }
        >
          删除
        </button>
      </div>
      <div className="annotation-box">
        <h4>让 AI 修改</h4>
        <TextField
          key={`note-${el.id}`}
          label="修改意见"
          value={note?.text ?? ""}
          disabled={disabled}
          multiline
          placeholder="例如：标题大一点，改为暖黄色。"
          onSave={(text) =>
            edit({
              type: "annotation",
              pageId: page.id,
              elementId: el.id,
              text,
              review: true,
            })
          }
        />
        <p className="muted">输入后自动保存，可跨页批注再统一修改。</p>
        {note?.status === "needsReview" && (
          <button
            disabled={disabled}
            onClick={() =>
              edit({
                type: "annotation",
                pageId: page.id,
                elementId: el.id,
                text: note.text,
                review: true,
              })
            }
          >
            元素已改变，确认仍适用
          </button>
        )}
        {note?.message && <p>{note.message}</p>}
      </div>
    </aside>
  );
}
