import { useState } from "react";
import type { LibraryContent } from "../shared/api";
import { assetUrl } from "./Scene";
import { Scene } from "./Scene";
import { layoutCatalog } from "../domain/templates";
import type { LayoutTemplate } from "../domain/layouts";

export function ResourceLibrary({
  content,
  busy,
  upload,
  remove,
  reload,
  open,
  editPhrases,
  editLayout,
  newLayout,
  removeLayout,
}: {
  content: LibraryContent | null;
  busy: boolean;
  upload: () => void;
  remove: (id: string) => void;
  reload: () => void;
  open: () => void;
  editPhrases: () => void;
  editLayout: (template: LayoutTemplate) => void;
  newLayout: () => void;
  removeLayout: (id: string) => void;
}) {
  const [tab, setTab] = useState<"stickers" | "phrases" | "layouts">(
    "stickers",
  );
  return (
    <section className="resource-library" aria-label="创作素材库">
      <header>
        <div>
          <p className="eyebrow">属于你的创作素材</p>
          <h2>让每一本，都带着你的印记</h2>
        </div>
        <div className="library-tabs" role="tablist" aria-label="素材库类型">
          <button
            role="tab"
            aria-selected={tab === "stickers"}
            onClick={() => setTab("stickers")}
          >
            贴纸库 <small>{content?.stickers.length ?? 0}</small>
          </button>
          <button
            role="tab"
            aria-selected={tab === "phrases"}
            onClick={() => setTab("phrases")}
          >
            短语库 <small>{content?.phrases.length ?? 0}</small>
          </button>
          <button
            role="tab"
            aria-selected={tab === "layouts"}
            onClick={() => setTab("layouts")}
          >
            排版库 <small>{11 + (content?.layouts.length ?? 0)}</small>
          </button>
        </div>
      </header>
      {tab === "stickers" ? (
        <div role="tabpanel" aria-label="贴纸库">
          <div className="resource-intro">
            <p className="muted">
              上传自己的贴纸，跨工程复用；新建时选择本次要用的贴纸。
            </p>
            <button disabled={busy} onClick={upload}>
              ＋ 上传贴纸
            </button>
          </div>
          <div className="sticker-shelf">
            {content?.stickers.map((a) => (
              <article className="sticker-item" key={a.id}>
                <img src={assetUrl(a.id)} alt={a.name} loading="lazy" />
                <span title={a.name}>{a.name}</span>
                <button
                  disabled={busy}
                  aria-label={`移除贴纸 ${a.name}`}
                  onClick={() => remove(a.id)}
                >
                  移出库
                </button>
              </article>
            ))}
            {!content?.stickers.length && (
              <p className="resource-empty">
                还没有贴纸。透明 PNG 和 WebP 能保留边缘与透明背景。
              </p>
            )}
          </div>
        </div>
      ) : tab === "phrases" ? (
        <div role="tabpanel" aria-label="短语库">
          <div className="resource-intro">
            <p className="muted">
              一行一句，保存为 UTF-8。修改后重新读取，已有工程里的文字保持不变。
            </p>
            <div className="button-row">
              <button disabled={busy} onClick={editPhrases}>
                编辑短语库
              </button>
              <button disabled={busy} onClick={open}>
                打开短语文件位置
              </button>
              <button disabled={busy} onClick={reload}>
                重新读取
              </button>
            </div>
          </div>
          <code className="phrase-path">{content?.phrasePath}</code>
          {content?.phraseError && (
            <p role="alert" className="warning">
              {content.phraseError}
            </p>
          )}
          <div className="phrase-shelf">
            {content?.phrases.map((phrase, i) => (
              <p key={i}>
                <small>{String(i + 1).padStart(2, "0")}</small>
                {phrase}
              </p>
            ))}
          </div>
          {content && !content.phraseError && !content.phrases.length && (
            <p className="resource-empty">
              短语库为空，可在文本文件中添加自己喜欢的句子。
            </p>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label="排版库">
          <div className="resource-intro">
            <p className="muted">
              所有照片排版都会参与随机生成。内置排版可复制后修改，自定义排版可随时编辑。
            </p>
            <button disabled={busy} onClick={newLayout}>
              ＋ 新建排版
            </button>
          </div>
          <div className="layout-library-grid">
            {layoutCatalog(undefined, undefined, content?.layouts).map((t) => (
              <article key={t.id}>
                <div className="layout-library-preview">
                  <Scene
                    album={{ size: t.size, assets: [] }}
                    page={t.page}
                    variant="thumbnail"
                  />
                </div>
                <strong>{t.name}</strong>
                <div className="button-row">
                  <button disabled={busy} onClick={() => editLayout(t)}>
                    {t.id.startsWith("builtin-") ? "复制并编辑" : "编辑排版"}
                  </button>
                  {!t.id.startsWith("builtin-") && (
                    <button disabled={busy} onClick={() => removeLayout(t.id)}>
                      删除排版
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
