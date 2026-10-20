import { CommitInput } from "./Fields";
import type { Page, Edit } from "../domain/model";
import { backgroundStyles } from "../domain/backgrounds";
import { useState } from "react";
export function BackgroundPicker({
  page,
  edit,
  disabled,
}: {
  page: Page;
  edit: (e: Edit) => void;
  disabled: boolean;
}) {
  const [matchText, setMatchText] = useState(true);
  return (
    <details className="background-picker" open={undefined}>
      <summary>
        页面底色与纸张{" "}
        <span>
          {
            backgroundStyles.find(
              (s) => s.id === (page.backgroundStyle ?? "solid"),
            )?.name
          }
        </span>
      </summary>
      <div className="paper-swatches">
        {backgroundStyles.map((s) => (
          <button
            key={s.id}
            disabled={disabled}
            className={
              (page.backgroundStyle ?? "solid") === s.id ? "active" : ""
            }
            title={s.name}
            onClick={() =>
              edit({
                type: "background",
                pageId: page.id,
                color: s.color,
                style: s.id,
                ...(matchText ? { textColors: "match" as const } : {}),
              })
            }
          >
            <i
              className={`paper-sample paper-${s.id}`}
              style={{ backgroundColor: s.color }}
            />
            {s.name}
          </button>
        ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={matchText}
          disabled={disabled}
          onChange={(e) => setMatchText(e.target.checked)}
        />
        同步搭配文字颜色
      </label>
      <small className="muted">锁定文字与叠在照片上的文字保留原色。</small>
      <label className="field">
        自定义底色
        <CommitInput
          type="color"
          disabled={disabled}
          value={page.background}
          onChange={(e) =>
            edit({
              type: "background",
              pageId: page.id,
              color: e.target.value,
              style: page.backgroundStyle,
              ...(matchText ? { textColors: "contrast" as const } : {}),
            })
          }
        />
      </label>
    </details>
  );
}
