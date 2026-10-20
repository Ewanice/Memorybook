import { useContext, useState } from "react";
import { FontContext } from "./fonts";
import type { Album, Edit } from "../domain/model";
import { backgroundStyles } from "../domain/backgrounds";
export function BookStyle({
  album,
  disabled,
  edit,
}: {
  album: Album;
  disabled: boolean;
  edit: (edit: Edit) => void;
}) {
  const fonts = useContext(FontContext);
  const [scope, setScope] = useState("content"),
    [font, setFont] = useState(""),
    [paper, setPaper] = useState(""),
    [size, setSize] = useState(0);
  const apply = () => {
    const pages = album.pages.filter(
      (p) => scope === "all" || p.role === "content",
    );
    const edits: Edit[] = [];
    for (const page of pages) {
      const background = backgroundStyles.find((p) => p.id === paper);
      if (background)
        edits.push({
          type: "background",
          pageId: page.id,
          color: background.color,
          style: background.id,
          textColors: "match",
        });
      const texts = page.elements.filter((e) => e.type === "text" && !e.locked);
      if (font || size)
        for (const element of texts)
          edits.push({
            type: "patchElement",
            pageId: page.id,
            elementId: element.id,
            patch: {
              style: {
                ...(font ? { fontFamily: font } : {}),
                ...(size ? { fontSize: size } : {}),
              },
            },
          });
    }
    if (
      edits.length &&
      window.confirm(
        `将统一修改 ${pages.length} 页的样式，锁定文字保持不变。可以整体撤销。`,
      )
    )
      edit({ type: "batch", edits });
  };
  return (
    <details className="book-style">
      <summary>整本样式</summary>
      <p className="muted">
        选中的项目会统一应用，其他样式保留。更换字号后请检查文字是否溢出。
      </p>
      <label className="field">
        应用范围
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="content">全部内页</option>
          <option value="all">包含封面和封底</option>
        </select>
      </label>
      <label className="field">
        统一纸张
        <select value={paper} onChange={(e) => setPaper(e.target.value)}>
          <option value="">保持当前纸张</option>
          {backgroundStyles.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        统一字体
        <select value={font} onChange={(e) => setFont(e.target.value)}>
          <option value="">保持当前字体</option>
          <option>Noto Sans SC</option>
          <option>Noto Serif SC</option>
          {fonts.map((f) => (
            <option key={f.id} value={f.family}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        统一字号
        <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
          <option value={0}>保持当前字号</option>
          {[10, 12, 14, 16, 18, 20, 24, 28, 32, 36].map((n) => (
            <option key={n} value={n}>
              {n} pt
            </option>
          ))}
        </select>
      </label>
      <button disabled={disabled || (!paper && !font && !size)} onClick={apply}>
        应用整本样式
      </button>
    </details>
  );
}
