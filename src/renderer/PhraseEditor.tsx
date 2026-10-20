import { useEffect, useState } from "react";
export function PhraseEditor({
  report,
  onDirty,
}: {
  report: (text: string) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [doc, setDoc] = useState<{ text: string; hash: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  async function load() {
    setBusy(true);
    try {
      const next = await window.memorybook.phraseDocument();
      setDoc(next);
      setDraft(next.text);
      onDirty(false);
      setLoadError("");
    } catch (e) {
      report((e as Error).message);
      setLoadError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="phrase-editor">
      <h3>编辑短语库</h3>
      <p className="muted">
        一行一句，最多 1000 句，每句 80 字。#
        开头为说明。保存后用于新生成的纪念册，已有文字不变。
      </p>
      <label className="field">
        短语内容
        <textarea
          aria-label="短语库内容"
          rows={14}
          disabled={busy || !doc}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onDirty(e.target.value !== doc?.text);
          }}
        />
      </label>
      {loadError && !doc && (
        <>
          <p className="warning">{loadError} 其他功能可继续使用。</p>
          <button
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  "保留原短语文件的副本，然后重建空短语库？原文件不会被直接丢弃。",
                )
              )
                return;
              setBusy(true);
              try {
                const next = await window.memorybook.resetPhrases();
                setDoc(next);
                setDraft(next.text);
                setLoadError("");
                onDirty(false);
                report("已重建空短语库，原文件已另存备份。");
              } catch (error) {
                report(error instanceof Error ? error.message : "重建失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            保留原文件并重建
          </button>
        </>
      )}
      <div className="button-row">
        <button
          className="primary"
          disabled={busy || !doc || draft === doc.text}
          onClick={async () => {
            if (!doc) return;
            setBusy(true);
            try {
              const next = await window.memorybook.savePhrases(draft, doc.hash);
              setDoc(next);
              setDraft(next.text);
              onDirty(false);
              report("短语库已保存。");
            } catch (e) {
              report((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          保存短语库
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (
              draft === doc?.text ||
              window.confirm("重新读取会放弃尚未保存的修改，是否继续？")
            )
              void load();
          }}
        >
          重新读取文件
        </button>
      </div>
    </div>
  );
}
