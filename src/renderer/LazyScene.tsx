import { useEffect, useRef, useState, memo } from "react";
import type { Album, Page } from "../domain/model";
import { Scene } from "./Scene";
export const LazyScene = memo(function LazyScene({
  album,
  page,
}: {
  album: Album;
  page: Page;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? false),
      { rootMargin: "250px" },
    );
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{
        width: "100%",
        height: "100%",
        aspectRatio: `${album.size.width}/${album.size.height}`,
      }}
    >
      {visible ? <Scene album={album} page={page} variant="thumbnail" /> : null}
    </div>
  );
});
