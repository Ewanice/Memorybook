import { useEffect, useState } from "react";
import {
  defaultCodexPreferences,
  type CodexPreferences,
} from "../domain/codex";
import type { CodexStatus } from "../infrastructure/codex-bridge";
export function CodexSettings({
  report,
  onDirty,
}: {
  report: (text: string) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [value, setValue] = useState<CodexPreferences | null>(null),
    [status, setStatus] = useState<CodexStatus | null>(null),
    [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saved, setSaved] = useState<CodexPreferences | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const dirty =
    value !== null && JSON.stringify(value) !== JSON.stringify(saved);
  async function reload() {
    const next = await window.memorybook.codexPreferences();
    setValue(next);
    setSaved(next);
    setExternalChange(false);
    onDirty(false);
  }
  useEffect(() => {
    let closed = false;
    const changed = () => {
      void window.memorybook
        .codexPreferences()
        .then((next) => {
          if (closed || JSON.stringify(next) === JSON.stringify(saved)) return;
          if (dirty) setExternalChange(true);
          else {
            setValue(next);
            setSaved(next);
            setExternalChange(false);
          }
        })
        .catch((e) => report(e.message));
    };
    window.addEventListener("memorybook-preferences-changed", changed);
    return () => {
      closed = true;
      window.removeEventListener("memorybook-preferences-changed", changed);
    };
  }, [dirty, saved]);
  useEffect(() => {
    void window.memorybook
      .codexPreferences()
      .then((next) => {
        setValue(next);
        setSaved(next);
      })
      .catch((e) => {
        setLoadError(e.message);
        report(e.message);
      });
    void window.memorybook
      .codexStatus()
      .then(setStatus)
      .catch((e) => report(e.message));
  }, []);
  function change(next: CodexPreferences) {
    setValue(next);
    onDirty(true);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      report((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!value)
    return loadError ? (
      <div>
        <p role="alert">{loadError}</p>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await window.memorybook.saveCodexPreferences(
                structuredClone(defaultCodexPreferences),
              );
              setValue(await window.memorybook.codexPreferences());
              setLoadError("");
            })
          }
        >
          恢复 Codex 默认设置
        </button>
      </div>
    ) : (
      <p>正在读取本地 Codex 设置…</p>
    );
  return (
    <div className="codex-settings">
      <h3>本地 Codex</h3>
      {externalChange && (
        <p role="status">
          共享设置有更新，未保存的输入仍保留。
          <button
            disabled={busy}
            onClick={() => {
              if (
                !dirty ||
                window.confirm("放弃当前未保存的 Codex 输入，读取最新设置？")
              )
                void run(reload);
            }}
          >
            读取最新设置
          </button>
        </p>
      )}
      <p role="status">{status?.message ?? "正在自动检测…"}</p>
      <p className="muted">
        复用本机 Codex 登录，不需要另填 API
        Key。自动连接不请求模型；点击生成后可能消耗 Codex 额度，通常需要联网。
      </p>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () =>
            setStatus(await window.memorybook.reconnectCodex()),
          )
        }
      >
        重新检测连接
      </button>
      <details>
        <summary>连接与模型</summary>
        <label className="field">
          可执行文件
          <input
            aria-label="Codex 可执行文件"
            value={value.executable}
            placeholder="留空自动查找"
            onChange={(e) => change({ ...value, executable: e.target.value })}
          />
        </label>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const path = await window.memorybook.chooseCodex();
              if (path) change({ ...value, executable: path });
            })
          }
        >
          选择 codex.exe
        </button>
        <label className="field">
          模型
          <input
            aria-label="Codex 模型"
            value={value.model}
            placeholder="留空使用本地 Codex 的默认模型"
            onChange={(e) => change({ ...value, model: e.target.value })}
          />
        </label>
      </details>
      <label className="field">
        默认生成提示词
        <textarea
          aria-label="Codex 默认生成提示词"
          rows={9}
          maxLength={12000}
          value={value.prompt}
          onChange={(e) => change({ ...value, prompt: e.target.value })}
        />
      </label>
      <details>
        <summary>生成时参考的 skill（选填，最多 5 个）</summary>
        <p className="muted">
          从本地 Codex 检测，只用于生成设计。软件不会安装或启用额外插件。
        </p>
        <div className="skill-options">
          {status?.skills.map((s) => (
            <label className="check" key={s.path} title={s.description}>
              <input
                type="checkbox"
                checked={value.skillPaths.includes(s.path)}
                disabled={
                  busy ||
                  (!value.skillPaths.includes(s.path) &&
                    value.skillPaths.length >= 5)
                }
                onChange={(e) =>
                  change({
                    ...value,
                    skillPaths: e.target.checked
                      ? [...value.skillPaths, s.path]
                      : value.skillPaths.filter((p) => p !== s.path),
                  })
                }
              />
              {s.name}
            </label>
          ))}
        </div>
        {!status?.skills.length && (
          <p className="muted">尚未检测到可用 skill。</p>
        )}
      </details>
      <div className="button-row">
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await window.memorybook.saveCodexPreferences(
                value,
                saved ?? undefined,
              );
              await reload();
              setStatus(await window.memorybook.codexStatus());
              report("Codex 设置已保存。");
            })
          }
        >
          保存 Codex 设置
        </button>
        <button
          disabled={busy}
          onClick={() =>
            change({ ...value, prompt: defaultCodexPreferences.prompt })
          }
        >
          恢复默认提示词
        </button>
      </div>
    </div>
  );
}
