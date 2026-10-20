import { createContext } from "react";
import type { ImportedFont } from "../domain/fonts";
export const FontContext = createContext<ImportedFont[]>([]);
const loaded = new Map<string, Promise<void>>();
export const failedFonts = new Set<string>();
window.addEventListener("memorybook-fonts-changed", () => {
  failedFonts.clear();
  loaded.clear();
});
export async function loadImportedFonts(
  ids: string[],
  strict = false,
): Promise<void> {
  const results = await Promise.allSettled(
    ids.map((id) => {
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("字体编号无效。");
      let pending = loaded.get(id);
      if (!pending) {
        pending = (async () => {
          const face = new FontFace(
            `MemoryFont_${id}`,
            `url(memory://font/${id})`,
          );
          await face.load();
          document.fonts.add(face);
          failedFonts.delete(id);
        })();
        loaded.set(id, pending);
        void pending.catch(() => {
          loaded.delete(id);
          failedFonts.add(id);
        });
      }
      return pending;
    }),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) {
    window.dispatchEvent(
      new CustomEvent("memorybook-resource-warning", {
        detail:
          "部分字体失效，预览暂用内置字体。请重新导入原字体或更换字体；导出会检查字体完整性。",
      }),
    );
    if (strict)
      throw new Error(
        "工程使用的字体缺失或损坏，请重新导入原字体或更换为内置字体后再导出。",
      );
  }
}
