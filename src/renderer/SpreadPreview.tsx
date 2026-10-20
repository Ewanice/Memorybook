import type { Album } from "../domain/model";
import { Scene } from "./Scene";
export function SpreadPreview({
  album,
  pageId,
  zoom,
  onPage,
}: {
  album: Album;
  pageId: string;
  zoom: number;
  onPage: (id: string) => void;
}) {
  const current = album.pages.findIndex((p) => p.id === pageId),
    start = current <= 0 ? 0 : current % 2 ? current : current - 1;
  const left = start ? album.pages[start] : undefined,
    right = album.pages[start ? start + 1 : 0];
  return (
    <div className="spread-preview">
      <div className="spread-navigation">
        <button
          disabled={start === 0}
          onClick={() => onPage(album.pages[start <= 1 ? 0 : start - 2]!.id)}
        >
          上一组
        </button>
        <span>
          {start
            ? `第 ${start + 1}–${Math.min(start + 2, album.pages.length)} 页`
            : "封面"}{" "}
          · 跨页预览
        </span>
        <button
          disabled={
            start === 0
              ? album.pages.length <= 1
              : start + 2 >= album.pages.length
          }
          onClick={() => onPage(album.pages[start ? start + 2 : 1]!.id)}
        >
          下一组
        </button>
      </div>
      <div className="spread-pages">
        {[left, right].map((page, i) => (
          <div
            key={i}
            className={page ? "spread-sheet" : "spread-empty"}
            style={{
              width: album.size.width * zoom,
              height: album.size.height * zoom,
            }}
          >
            {page && <Scene album={album} page={page} />}
          </div>
        ))}
      </div>
    </div>
  );
}
