import { useState } from "react";
import type { Album, Asset, Edit } from "../domain/model";
import { assetsForRole, type AssetRole } from "../domain/asset-library";
import { assetUrl } from "./Scene";
import { TextField } from "./Fields";
export function AssetLibrary({
  album,
  disabled,
  onAdd,
  edit,
  role,
  stickers,
}: {
  album: Album;
  disabled: boolean;
  onAdd: (asset: Asset) => void;
  edit: (edit: Edit) => void;
  role: AssetRole;
  stickers: Asset[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const items = assetsForRole(album, role, stickers);
  const filtered = items.filter((a) =>
    a.name.toLowerCase().includes(query.toLowerCase()),
  );
  const detail = items.find((a) => a.id === selected);
  const inProject = album.assets.some((a) => a.id === selected);
  const references = (id: string) =>
    album.pages.reduce(
      (n, p) =>
        n +
        p.elements.filter((e) => e.type === "image" && e.assetId === id).length,
      0,
    );
  return (
    <>
      <input
        aria-label="筛选素材"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="按名称查找"
      />
      <div className="asset-grid">
        {filtered.map((a) => (
          <div key={a.id}>
            <button disabled={disabled} onClick={() => onAdd(a)} title={a.name}>
              <img loading="lazy" src={assetUrl(a.id)} alt={a.name} />
            </button>
            <button
              className="asset-detail-button"
              aria-label={`素材详情 ${a.name}`}
              onClick={() => setSelected(a.id)}
            >
              {album.assets.some((v) => v.id === a.id)
                ? `${references(a.id)} 次使用`
                : "贴纸库"}{" "}
              · 详情
            </button>
          </div>
        ))}
      </div>
      {!filtered.length && (
        <p className="muted">
          {query
            ? "没有匹配的素材。"
            : role === "sticker"
              ? "贴纸库还没有贴纸。上传透明 PNG 或 WebP 贴纸后，点击即可加入当前页。"
              : "还没有照片，可从电脑导入后点击加入画布。"}
        </p>
      )}
      {detail && (
        <section className="asset-detail">
          <header>
            <h4>素材详情</h4>
            <button onClick={() => setSelected("")}>收起</button>
          </header>
          <img src={assetUrl(detail.id, "preview")} alt={detail.name} />
          <TextField
            key={detail.id}
            label="素材名称"
            value={detail.name}
            disabled={disabled || !inProject}
            onSave={(name) =>
              edit({ type: "renameAsset", assetId: detail.id, name })
            }
          />
          <p className="muted">
            {detail.width} × {detail.height} px ·{" "}
            {(detail.bytes / 1048576).toFixed(1)} MB
            <br />
            当前纪念册使用 {references(detail.id)} 次
          </p>
          <button
            disabled={disabled || !inProject || references(detail.id) > 0}
            onClick={() => {
              if (
                window.confirm(
                  "从当前纪念册移除此未使用素材？历史与其他项目的引用会保留。",
                )
              ) {
                edit({ type: "removeAsset", assetId: detail.id });
                setSelected("");
              }
            }}
          >
            移出本册
          </button>
        </section>
      )}
    </>
  );
}
