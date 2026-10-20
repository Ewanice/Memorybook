import { renderToStaticMarkup } from "react-dom/server";
import { Scene, ensureFonts, measureText } from "./Scene";
import type { Album } from "../domain/model";
import { textOverflows } from "../domain/text";
declare global {
  interface Window {
    memorybookExport: {
      render: (
        album: Album,
        quality: "high" | "share",
        options?: { pageIds: string[]; bleed: number },
      ) => Promise<string[]>;
      preflight: (before: Album, after: Album) => Promise<boolean>;
    };
  }
}
window.memorybookExport = {
  render: async (album, quality, options) => {
    const pages = options
      ? album.pages.filter((p) => options.pageIds.includes(p.id))
      : album.pages;
    await ensureFonts(
      {
        pages: pages.map((p) => ({
          ...p,
          elements: p.elements.filter((e) => e.visible),
        })),
      },
      true,
    );
    return pages.map((page) =>
      renderToStaticMarkup(
        <Scene
          album={album}
          page={page}
          bleed={options?.bleed}
          variant={quality === "share" ? "share" : "original"}
        />,
      ),
    );
  },
  preflight: async (before, after) => {
    await ensureFonts(after);
    const original = new Map(
      before.pages.flatMap((p) => p.elements).map((e) => [e.id, e]),
    );
    return after.pages
      .flatMap((p) => p.elements)
      .some(
        (e) =>
          e.type === "text" &&
          JSON.stringify(e) !== JSON.stringify(original.get(e.id)) &&
          textOverflows(e, measureText),
      );
  },
};
