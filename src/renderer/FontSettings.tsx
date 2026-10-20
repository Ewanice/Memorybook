import { useEffect, useState } from "react";
import type { ImportedFont } from "../domain/fonts";
import { loadImportedFonts } from "./fonts";
export function FontSettings({
  report,
}: {
  report: (message: string) => void;
}) {
  const [fonts, setFonts] = useState<ImportedFont[]>([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.memorybook
      .fonts()
      .then(async (fonts) => {
        await loadImportedFonts(fonts.map((f) => f.id));
        setFonts(fonts);
      })
      .catch((e) => report(e.message));
  }, []);
  return (
    <>
      <h3>为记忆，选一种字迹</h3>
      <p className="muted">
        内置思源黑体和思源宋体。可导入 TTF、OTF
        字体，保存在软件目录「materials/imported-fonts」，工程备份会包含用到的字体。
      </p>
      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await window.memorybook.importFonts();
            setFonts(result.fonts);
            await loadImportedFonts(result.fonts.map((f) => f.id));
            window.dispatchEvent(new Event("memorybook-fonts-changed"));
            if (result.failures.length) report(result.failures.join("\n"));
          } catch (e) {
            report((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "正在导入…" : "＋ 导入字体"}
      </button>
      <div className="font-library">
        {fonts.length === 0 ? (
          <p className="muted">尚未导入字体</p>
        ) : (
          fonts.map((f) => (
            <div className="font-card" key={f.id}>
              <strong>{f.name}</strong>
              <small>
                {(f.bytes / 1024 / 1024).toFixed(1)} MB · 已保存到素材目录
              </small>
              <p style={{ fontFamily: f.family }}>
                把这一刻，写进纪念册。 Aa 0123
              </p>
              <button
                disabled={busy}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `移除字体“${f.name}”？仍被资料引用的字体不会被删除。`,
                    )
                  )
                    return;
                  setBusy(true);
                  try {
                    await window.memorybook.removeFont(f.id);
                    setFonts(await window.memorybook.fonts());
                    window.dispatchEvent(new Event("memorybook-fonts-changed"));
                  } catch (e) {
                    report(e instanceof Error ? e.message : "字体移除失败");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                移除未使用字体
              </button>
            </div>
          ))
        )}
      </div>
      <p className="muted">
        导入字体可在文字属性中选择。字体缺少的字形由内置字体补齐，导出前请预览确认。
      </p>
    </>
  );
}
