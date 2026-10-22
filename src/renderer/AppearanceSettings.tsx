import { useState } from "react";
import type { Settings } from "../domain/model";
import { TextField, CommitInput } from "./Fields";

export function themeVariables(accent = "#315a43"): Record<string, string> {
  const rgb = [1, 3, 5].map((n) => parseInt(accent.slice(n, n + 2), 16) / 255);
  const lum = rgb
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i]!, 0);
  return {
    "--accent": accent,
    "--accent-ink": lum > 0.179 ? "#18231e" : "#ffffff",
    "--accent-soft": `color-mix(in srgb, ${accent} 10%, white)`,
    "--accent-line": `color-mix(in srgb, ${accent} 40%, white)`,
  };
}
export function AppearanceSettings({
  settings,
  onUpdate,
  report,
}: {
  settings: Settings;
  onUpdate: (s: Settings) => void;
  report: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function save(patch: Partial<Settings>) {
    setBusy(true);
    try {
      onUpdate(
        await window.memorybook.settings({ ...settings, ...patch }, settings),
      );
    } catch (e) {
      report((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="appearance-settings">
      <h3>你的创作空间</h3>
      <p className="muted">外观保存在本机，不改变纪念册与 PDF 的设计。</p>
      <TextField
        label="首页名称"
        value={settings.displayName ?? "拾页"}
        disabled={busy}
        onSave={(name) => void save({ displayName: name.trim() })}
      />
      <p className="muted">1–24 个字符，可写工作室名或自己的名字。</p>
      <label className="field">
        主题色
        <CommitInput
          type="color"
          value={settings.accentColor ?? "#315a43"}
          disabled={busy}
          onChange={(e) => void save({ accentColor: e.target.value })}
        />
      </label>
      <div className="accent-presets" aria-label="推荐主题色">
        {[
          ["森林", "#315a43"],
          ["海蓝", "#335f85"],
          ["玫瑰", "#96576b"],
          ["琥珀", "#956023"],
          ["紫藤", "#705c94"],
        ].map(([name, color]) => (
          <button
            key={color}
            title={name}
            aria-label={name + "主题色"}
            disabled={busy}
            onClick={() => void save({ accentColor: color })}
            style={{ background: color }}
          />
        ))}
      </div>
      <section className="settings-group">
        <h4>首页背景</h4>
        <p className="muted">
          仅显示在首页；设置、弹窗与编辑器保持清晰的工作背景。
        </p>
        {settings.homeBackground && (
          <img
            className="home-background-preview"
            alt="当前首页背景"
            src={`memory://appearance/${settings.homeBackground}?variant=preview`}
          />
        )}
        <div className="button-row">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                onUpdate(await window.memorybook.chooseHomeBackground());
              } catch (e) {
                report((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            选择背景图片
          </button>
          <button
            disabled={busy || !settings.homeBackground}
            onClick={() => void save({ homeBackground: "" })}
          >
            移除背景
          </button>
        </div>
        {settings.homeBackground && (
          <>
            <label className="field">
              背景缩放 · {Math.round((settings.homeBackgroundScale ?? 1) * 100)}
              %
              <CommitInput
                aria-label="背景缩放"
                type="range"
                min="1"
                max="4"
                step="0.05"
                value={settings.homeBackgroundScale ?? 1}
                disabled={busy}
                onChange={(e) =>
                  void save({ homeBackgroundScale: Number(e.target.value) })
                }
              />
              <small>
                100% 自动铺满窗口，可放大至 400%；背景固定，不随页面滚动。
              </small>
            </label>
            <label className="field">
              背景浓度
              <CommitInput
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.homeBackgroundOpacity ?? 0.16}
                disabled={busy}
                onChange={(e) =>
                  void save({ homeBackgroundOpacity: Number(e.target.value) })
                }
              />
            </label>
          </>
        )}
      </section>
      <button
        disabled={busy}
        onClick={() =>
          void save({
            displayName: "拾页",
            accentColor: "#315a43",
            homeBackground: "",
            homeBackgroundOpacity: 0.16,
            homeBackgroundScale: 1,
          })
        }
      >
        恢复默认外观
      </button>
    </div>
  );
}
