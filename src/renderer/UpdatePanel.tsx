import { useEffect, useState } from "react";
import type { UpdateState } from "../infrastructure/update-protocol";
const initial: UpdateState = {
  status: "idle",
  message: "仅在点击检查更新时联网，不会自动检查或提示。",
  received: 0,
  total: 0,
};
export function UpdatePanel() {
  const [state, setState] = useState(initial),
    [error, setError] = useState("");
  useEffect(() => {
    let closed = false;
    const refresh = () => {
      void window.memorybook
        .updateState()
        .then((value) => {
          if (!closed) setState(value);
        })
        .catch((e) => {
          if (!closed) setError(e.message);
        });
    };
    refresh();
    const timer = setInterval(refresh, 500);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }, []);
  const active = ["checking", "downloading", "preparing"].includes(
    state.status,
  );
  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      setState(await window.memorybook.updateState());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="settings-group update-panel" aria-label="软件更新">
      <h3>软件更新</h3>
      <p className="muted">
        手动检查，可取消下载和准备。工程、照片、字体、短语及共享设置均保留。
      </p>
      <p role="status">{state.message}</p>
      {state.version && state.status !== "current" && (
        <p>
          新版本 {state.version}
          {state.differential ? " · 二进制差分更新" : ""}
        </p>
      )}
      {state.total > 0 && active && (
        <>
          <progress
            value={state.received}
            max={state.total}
            aria-label="更新下载进度"
          />
          <small>
            {(state.received / 1048576).toFixed(1)} /{" "}
            {(state.total / 1048576).toFixed(1)} MiB
          </small>
        </>
      )}
      {state.notes && (
        <details>
          <summary>查看更新说明</summary>
          <p style={{ whiteSpace: "pre-wrap" }}>{state.notes}</p>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="button-row">
        <button
          disabled={active || state.status === "installing"}
          onClick={() => void run(() => window.memorybook.checkUpdate())}
        >
          检查更新
        </button>
        {state.status === "available" && (
          <button
            className="primary"
            onClick={() => void run(() => window.memorybook.prepareUpdate())}
          >
            下载更新
          </button>
        )}
        {state.status === "ready" && (
          <button
            className="primary"
            onClick={() =>
              window.dispatchEvent(new Event("memorybook-install-update"))
            }
          >
            重启并更新
          </button>
        )}
        {(active || state.status === "ready") && (
          <button
            onClick={() => void run(() => window.memorybook.cancelUpdate())}
          >
            取消更新
          </button>
        )}
      </div>
      <small className="muted">
        更新源可在软件目录的 update-source.json
        中配置。替换程序时会出现独立更新窗口，仍可取消并恢复原版本。
      </small>
    </section>
  );
}
