import { useEffect, useState } from "react";
import type { DesktopApi } from "../shared/api";
const api = window.memorybook;
const mb = (value: number) => (value / 1048576).toFixed(1) + " MB";
export function StoragePanel({
  report,
  onBusy,
}: {
  report: (message: string) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [usage, setUsage] = useState<Awaited<
    ReturnType<DesktopApi["storageUsage"]>
  > | null>(null);
  const [items, setItems] = useState<
    Awaited<ReturnType<DesktopApi["recovery"]>>
  >([]);
  const [issues, setIssues] = useState<
    Awaited<ReturnType<DesktopApi["health"]>>
  >([]);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const result = await Promise.allSettled([
      api.storageUsage(),
      api.recovery(),
      api.health(),
    ]);
    for (const [i, value] of result.entries()) {
      if (value.status === "rejected") {
        report(
          value.reason instanceof Error
            ? value.reason.message
            : "部分资料信息无法读取",
        );
        continue;
      }
      if (i === 0)
        setUsage(
          value.value as Awaited<ReturnType<DesktopApi["storageUsage"]>>,
        );
      if (i === 1)
        setItems(value.value as Awaited<ReturnType<DesktopApi["recovery"]>>);
      if (i === 2)
        setIssues(value.value as Awaited<ReturnType<DesktopApi["health"]>>);
    }
  }
  useEffect(() => {
    void refresh().catch((e) => report(e.message));
  }, []);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    onBusy?.(true);
    try {
      const result = await action();
      if (typeof result === "string") report(result);
      await refresh();
      window.dispatchEvent(new Event("memorybook-data-changed"));
    } catch (e) {
      report(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <section className="recovery-center">
      <h3>资料保护与恢复</h3>
      <p className="muted">
        工程删除后进入最近删除。自动恢复副本每五分钟保留一次，每本最多十份；撤销保留最近
        200
        步。另有约五分钟一次的完整数据库副本，保留最近三份。恢复工程副本会另存为新工程。
      </p>
      <div className="button-row">
        <button
          disabled={busy}
          onClick={() => void run(() => api.backupWorkspace())}
        >
          备份全部资料
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                "将合并导入备份中的纪念册、贴纸、排版与短语，不覆盖现有工程。API Key 和卡密不会被更换。是否继续？",
              )
            )
              void run(() => api.restoreWorkspace());
          }}
        >
          从资料备份导入
        </button>
      </div>
      <p className="muted">
        完整资料备份是文件夹，请整体保存。单本工程仍可在编辑器备份为 .memorybook
        文件。
      </p>
      {usage && (
        <>
          <dl className="storage-summary">
            {[
              ["照片与贴纸", usage.originals],
              ["数据库与撤销历史", usage.database],
              ["自动恢复副本", usage.snapshots],
              ["导入字体", usage.fonts],
              ["预览缓存", usage.previews],
              ["浏览器缓存", usage.browser],
              ["可回收原图", usage.reclaimable],
              ["磁盘可用", usage.free],
            ].map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value === null ? "无法读取" : mb(Number(value))}</dd>
              </div>
            ))}
          </dl>
          {usage.cleanupBlocked && (
            <p className="warning">安全回收暂不可用：{usage.cleanupBlocked}</p>
          )}
          <button
            disabled={busy || usage.reclaimable === 0}
            onClick={() => {
              if (
                window.confirm(
                  "仅清理导入超过一天，且没有被工程、贴纸库、撤销历史、最近删除或恢复副本引用的原图。是否继续？",
                )
              )
                void run(
                  async () => `已回收 ${mb(await api.cleanupOriginals())}。`,
                );
            }}
          >
            安全回收未使用原图
          </button>
        </>
      )}
      <details>
        <summary>资源异常（{issues.length}）</summary>
        {issues.length ? (
          issues.map((issue) => (
            <p className="warning" key={issue.key}>
              {issue.message}
            </p>
          ))
        ) : (
          <p className="muted">未发现资源异常。</p>
        )}
      </details>
      {usage && (
        <details>
          <summary>数据库恢复文件（{usage.databaseCopies.length}）</summary>
          <p className="muted">
            软件检测到数据库损坏时会尝试最近的自动副本。升级前的副本会一直保留；它们引用的原图也会保留。整理旧副本前，建议先备份全部资料。
          </p>
          <div className="recovery-list">
            {usage.databaseCopies.map((copy) => (
              <article key={copy.name}>
                <div>
                  <strong>
                    {copy.name.startsWith("database-backup")
                      ? "自动数据库副本"
                      : "升级／导入保留副本"}
                  </strong>
                  <small>
                    {new Date(copy.time).toLocaleString("zh-CN")} ·{" "}
                    {mb(copy.bytes)}
                  </small>
                </div>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "只移除这份数据库恢复文件，现有工程不受影响。建议先备份全部资料，此操作不能撤销。",
                      )
                    )
                      void run(() => api.purgeDatabaseCopy(copy.name));
                  }}
                >
                  移除副本
                </button>
              </article>
            ))}
          </div>
        </details>
      )}
      <details>
        <summary>最近删除与恢复副本（{items.length}）</summary>
        <div className="recovery-list">
          {items.map((item) => (
            <article key={item.kind + item.id}>
              <div>
                <strong>{item.name}</strong>
                <small>
                  {item.kind === "trash"
                    ? "最近删除"
                    : item.kind === "snapshot"
                      ? "恢复副本"
                      : "损坏工程"}{" "}
                  ·{" "}
                  {item.time
                    ? new Date(item.time).toLocaleString("zh-CN")
                    : "原记录保留"}
                </small>
              </div>
              {(item.kind === "damaged" || item.recoverable === false) && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => api.exportRecovery(item.id, item.kind))
                  }
                >
                  保存原记录
                </button>
              )}
              {item.kind === "damaged" && (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "把这条损坏工程移至最近删除？原始记录保留，可先保存原记录或备份全部资料。",
                      )
                    )
                      void run(() => api.deleteAlbum(item.id));
                  }}
                >
                  移至最近删除
                </button>
              )}
              {item.kind !== "damaged" && (
                <>
                  <button
                    disabled={busy || item.recoverable === false}
                    onClick={() =>
                      void run(async () => {
                        await api.recover(
                          item.id,
                          item.kind as "trash" | "snapshot",
                        );
                        return "工程已恢复，请返回首页查看。";
                      })
                    }
                  >
                    恢复
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "永久删除这条回收站记录或恢复副本？此操作不能撤销。原图仍需另行安全回收。",
                        )
                      )
                        void run(() =>
                          api.purgeRecovery(
                            item.id,
                            item.kind as "trash" | "snapshot",
                          ),
                        );
                    }}
                  >
                    永久删除
                  </button>
                </>
              )}
            </article>
          ))}
        </div>
      </details>
    </section>
  );
}
