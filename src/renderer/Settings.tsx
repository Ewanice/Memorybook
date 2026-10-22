import { useEffect, useState } from "react";
import type { Bootstrap, Settings as Preferences } from "../domain/model";
import { defaultSettings } from "../domain/model";
import { AiSettings } from "./AiSettings";
import { PhraseEditor } from "./PhraseEditor";
import { FontSettings } from "./FontSettings";
import { CodexSettings } from "./CodexSettings";
import { StoragePanel } from "./RecoveryCenter";
import { AppearanceSettings } from "./AppearanceSettings";
export function SettingsDialog({
  data,
  onClose,
  onUpdate,
  report,
  initialTab = "通用",
}: {
  data: Bootstrap;
  onClose: () => void;
  onUpdate: (settings: Preferences) => void;
  report: (message: string) => void;
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const settings = data.settings;
  const [cache, setCache] = useState<{ bytes: number; files: number } | null>(
    null,
  );
  const [diagnostics, setDiagnostics] = useState("");
  const [notices, setNotices] = useState("");
  const [paths, setPaths] = useState<Awaited<
    ReturnType<typeof window.memorybook.storageInfo>
  > | null>(null);
  useEffect(() => {
    void window.memorybook
      .storageInfo()
      .then(setPaths)
      .catch((error) => report(error.message));
    void window.memorybook
      .cacheInfo()
      .then(setCache)
      .catch((error) => report(error.message));
  }, [report]);
  async function action(fn: () => Promise<unknown>, success = "") {
    setBusy(true);
    try {
      const result = await fn();
      if (typeof result === "string" && result) report(result);
      else if (success) report(success);
    } catch (error) {
      report(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  function update(next: Preferences) {
    if (
      settings.aiEnabled &&
      !next.aiEnabled &&
      !window.confirm("关闭 AI 会取消正在进行的 AI 修改，是否继续？")
    )
      return;
    void action(async () => onUpdate(await window.memorybook.settings(next)));
  }
  return (
    <div className="modal-backdrop">
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        data-dirty={dirty}
      >
        <header>
          <h2>设置</h2>
          <button
            onClick={() => {
              if (
                !dirty ||
                window.confirm("还有尚未保存的修改，放弃并关闭设置？")
              )
                onClose();
            }}
            disabled={busy}
          >
            完成
          </button>
        </header>
        <div className="settings-body">
          <nav>
            {[
              "通用",
              "外观",
              "文件与导出",
              "备份与恢复",
              "短语库",
              "字体库",
              "本地 Codex",
              "AI",
              "关于",
            ].map((t) => (
              <button
                key={t}
                className={tab === t ? "active" : ""}
                onClick={() => {
                  if (t === tab) return;
                  if (
                    !dirty ||
                    window.confirm("还有尚未保存的修改，放弃并切换？")
                  ) {
                    setDirty(false);
                    setTab(t);
                  }
                }}
              >
                {t}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {tab === "外观" && (
              <AppearanceSettings
                settings={settings}
                onUpdate={onUpdate}
                report={report}
              />
            )}
            {tab === "备份与恢复" && (
              <StoragePanel report={report} onBusy={setBusy} />
            )}
            {tab === "字体库" && <FontSettings report={report} />}
            {tab === "短语库" && (
              <PhraseEditor report={report} onDirty={setDirty} />
            )}
            {tab === "本地 Codex" && (
              <CodexSettings report={report} onDirty={setDirty} />
            )}
            {tab === "通用" && (
              <>
                <h3>让工具适合你的习惯</h3>
                <label className="field">
                  界面缩放
                  <select
                    aria-label="界面缩放"
                    disabled={busy}
                    value={settings.zoom}
                    onChange={(e) =>
                      update({
                        ...settings,
                        zoom: Number(e.target.value) as Preferences["zoom"],
                      })
                    }
                  >
                    {[100, 125, 150].map((v) => (
                      <option key={v} value={v}>
                        {v}%
                      </option>
                    ))}
                  </select>
                  <small>只调整界面，不影响纪念册和 PDF 尺寸。</small>
                </label>
                <label className="check">
                  <input
                    disabled={busy}
                    type="checkbox"
                    checked={settings.guides}
                    onChange={(e) =>
                      update({ ...settings, guides: e.target.checked })
                    }
                  />
                  显示页面安全边距
                </label>
                <label className="check">
                  <input
                    disabled={busy}
                    type="checkbox"
                    checked={settings.snap}
                    onChange={(e) =>
                      update({ ...settings, snap: e.target.checked })
                    }
                  />
                  移动时自动对齐
                </label>
                <p className="muted">
                  修改会自动保存在此电脑，自动保存始终开启。
                </p>
              </>
            )}
            {tab === "文件与导出" && (
              <>
                <h3>保存在你的电脑里</h3>
                <label className="field">
                  新纪念册默认尺寸
                  <select
                    disabled={busy}
                    value={settings.pageSize}
                    onChange={(e) =>
                      update({
                        ...settings,
                        pageSize: e.target.value as Preferences["pageSize"],
                      })
                    }
                  >
                    <option value="a5">A5 竖版 · 148 × 210 mm</option>
                    <option value="square">方形 · 210 × 210 mm</option>
                  </select>
                  <small>不会更改已经创建的纪念册。</small>
                </label>
                <label className="field">
                  导出目录
                  <span className="path-label">
                    {settings.exportDirectory || "首次导出时选择"}
                  </span>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const path = await window.memorybook.chooseDirectory();
                        if (path)
                          onUpdate(
                            await window.memorybook.settings({
                              ...settings,
                              exportDirectory: path,
                            }),
                          );
                      })
                    }
                  >
                    选择文件夹
                  </button>
                  <button
                    disabled={busy || !settings.exportDirectory}
                    onClick={() => update({ ...settings, exportDirectory: "" })}
                  >
                    清除默认导出目录
                  </button>
                </label>
                <label className="field">
                  默认 PDF 质量
                  <select
                    aria-label="默认 PDF 质量"
                    disabled={busy}
                    value={settings.quality}
                    onChange={(e) =>
                      update({
                        ...settings,
                        quality: e.target.value as Preferences["quality"],
                      })
                    }
                  >
                    <option value="high">高清 · 保留原图细节</option>
                    <option value="share">分享 · 较小图片体积</option>
                  </select>
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(() => window.memorybook.dataDirectory())
                  }
                >
                  打开项目数据文件夹
                </button>
                <p className="muted">
                  默认保存在软件目录的「data」文件夹。短语库位于软件根目录，导入字体及内置素材位于「materials」。预览缓存约
                  256 MB 自动淘汰，高清 PDF 使用原图。
                </p>
                {paths && (
                  <details className="storage-paths">
                    <summary>查看实际保存位置</summary>
                    <p>软件：{paths.root}</p>
                    <p>工程：{paths.data}</p>
                    <p>照片与贴纸：{paths.assets}</p>
                    <p>缓存：{paths.cache}</p>
                    <p>字体：{paths.fonts}</p>
                    <p>短语：{paths.phrases}</p>
                  </details>
                )}
                <p className="muted">
                  预览缓存：
                  {cache
                    ? (cache.bytes / 1048576).toFixed(1) + " MB"
                    : "正在读取"}
                </p>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm("清理可重建的预览缓存？原图和工程会保留。")
                    )
                      void action(async () => {
                        await window.memorybook.clearCache();
                        setCache(await window.memorybook.cacheInfo());
                      }, "预览缓存已清理。");
                  }}
                >
                  清理预览缓存
                </button>
                <p className="muted">
                  需要迁移或保存副本时，请使用编辑器中的“备份工程”。
                </p>
              </>
            )}
            {tab === "AI" && (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={settings.aiEnabled}
                    onChange={(e) =>
                      update({ ...settings, aiEnabled: e.target.checked })
                    }
                  />
                  允许主动使用 AI
                </label>
                <AiSettings data={data} action={action} />
              </>
            )}
            {tab === "关于" && (
              <>
                <div className="brand large">
                  拾页<span>MEMORYBOOK</span>
                </div>
                <p>
                  版本 {data.version}
                  {data.development ? " · 开发构建" : ""}
                </p>
                <p className="muted">
                  打开即可使用，普通编辑与 PDF 导出均可离线完成。AI 使用你自己的
                  API Key 或本地 Codex。
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () =>
                      setDiagnostics(await window.memorybook.diagnostics()),
                    )
                  }
                >
                  查看诊断信息
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () =>
                      setNotices(await window.memorybook.notices()),
                    )
                  }
                >
                  第三方许可
                </button>
                {diagnostics && (
                  <details open>
                    <summary>诊断预览 · 不含照片和令牌</summary>
                    <pre className="diagnostics">{diagnostics}</pre>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const path =
                            await window.memorybook.exportDiagnostics();
                          if (path) report("诊断信息已导出。");
                        })
                      }
                    >
                      导出这些信息
                    </button>
                  </details>
                )}
                {notices && (
                  <details open>
                    <summary>第三方许可声明</summary>
                    <pre className="diagnostics">{notices}</pre>
                  </details>
                )}
                <hr />
                <button
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("恢复默认设置？项目和 AI 凭证会保留。"))
                      update(structuredClone(defaultSettings));
                  }}
                >
                  恢复默认设置
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
