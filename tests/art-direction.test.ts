import { test } from "node:test";
import assert from "node:assert/strict";
import {
  layoutCatalog,
  createAlbum,
  createPage,
} from "../src/domain/templates";
import { contrastRatio, layoutPalette } from "../src/domain/art-direction";
import { sizes, textElement } from "../src/domain/model";
import { assertLayout } from "../src/domain/layout-validation";
import { applyEdit } from "../src/domain/edit";
import { pageNumber } from "../src/domain/pagination";
test("全部内置排版在两种尺寸与配色下具有纸张方案、可读文字和完整安全边距", () => {
  for (const size of Object.values(sizes))
    for (const theme of ["paper", "live"] as const) {
      const catalog = layoutCatalog(size, theme),
        papers = new Set(catalog.map((t) => t.page.backgroundStyle));
      assert.equal(catalog.length, 11);
      assert(papers.size >= 6);
      for (const t of catalog) {
        assertLayout(t);
        for (const e of t.page.elements)
          if (e.type === "text")
            assert(
              contrastRatio(e.style.color, t.page.background) >= 4.5,
              `${t.name}: ${e.name} contrast`,
            );
        const content = t.page.elements.filter(
          (e) =>
            e.type === "photoSlot" ||
            (e.type === "text" && e.name !== "页眉标记"),
        );
        for (let i = 0; i < content.length; i++)
          for (let j = i + 1; j < content.length; j++) {
            const a = content[i]!.frame,
              b = content[j]!.frame;
            const overlapX =
                Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
              overlapY =
                Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
            assert(
              overlapX <= 0 || overlapY <= 0,
              `${t.name}: ${content[i]!.name} overlaps ${content[j]!.name}`,
            );
          }
      }
    }
});
test("换纸时可同步文字色，锁定文字不变；自定义底色保留可读自选颜色，整个修改可独立撤销", () => {
  const album = createAlbum("配色", "", "live", "a5", []),
    page = album.pages[0]!;
  const locked = textElement("锁定字", {
    x: 30,
    y: 30,
    width: 100,
    height: 50,
  });
  locked.locked = true;
  locked.style.color = "#ffcc00";
  page.elements.push(locked);
  const next = applyEdit(album, {
    type: "background",
    pageId: page.id,
    color: "#f4f0e6",
    style: "fiber",
    textColors: "match",
  });
  assert.deepEqual(
    next.pages[0]!.elements.find((e) => e.id === locked.id),
    locked,
  );
  for (const e of next.pages[0]!.elements)
    if (e.type === "text" && !e.locked)
      assert(contrastRatio(e.style.color, next.pages[0]!.background) >= 4.5);
  assert.equal(
    album.pages[0]!.background,
    layoutPalette("monologue", "live").background,
  );
  const unchanged = applyEdit(album, {
    type: "background",
    pageId: page.id,
    color: "#f4f0e6",
    style: "fiber",
  });
  assert.deepEqual(unchanged.pages[0]!.elements, page.elements);
  const custom = structuredClone(next),
    text = custom.pages[0]!.elements.find(
      (e) => e.type === "text" && !e.locked,
    )!;
  if (text.type !== "text") throw Error();
  text.style.color = "#682c4e";
  const safe = applyEdit(custom, {
    type: "background",
    pageId: page.id,
    color: "#f8f2e8",
    textColors: "contrast",
  });
  assert.equal(
    (safe.pages[0]!.elements.find((e) => e.id === text.id) as typeof text).style
      .color,
    "#682c4e",
  );
  const note = pageNumber(
    {
      ...next,
      pagination: { enabled: true, position: "bottom-center", start: 1 },
    },
    next.pages[1]!,
  );
  assert(note);
  assert(contrastRatio(note.style.color, next.pages[1]!.background) >= 4.5);
});
test("套用模板保留成套背景与文字配色；普通照片网格也使用已选贴纸与短语", () => {
  const photo = {
      id: "a".repeat(64),
      name: "photo.png",
      mime: "image/png" as const,
      bytes: 10,
      width: 900,
      height: 1200,
    },
    sticker = { ...photo, id: "b".repeat(64), name: "sticker.png" };
  const page = createPage(sizes.a5, "paper", "ticket", [photo, photo], {
    stickers: [sticker],
    phrases: ["那一天，一起留下回忆。"],
  });
  assert.equal(page.backgroundStyle, "kraft");
  assert(page.elements.some((e) => e.type === "image" && e.role === "sticker"));
  assert(
    page.elements.some(
      (e) => e.type === "text" && e.text === "那一天，一起留下回忆。",
    ),
  );
  assert.equal(
    (
      page.elements.find((e) => e.name === "回忆文字") as {
        style: { fontFamily: string };
      }
    ).style.fontFamily,
    "Noto Serif SC",
  );
});

test("照片上的覆盖文字不随纸张颜色改动", () => {
  const a = createAlbum("覆盖文字", "", "paper", "a5", [
    {
      id: "f".repeat(64),
      name: "photo.png",
      mime: "image/png",
      bytes: 10,
      width: 1000,
      height: 1000,
    },
  ]);
  const text = textElement("白色照片标题", {
    x: 40,
    y: 60,
    width: 250,
    height: 55,
  });
  text.style.color = "#ffffff";
  a.pages[0]!.elements.push(text);
  const next = applyEdit(a, {
    type: "background",
    pageId: a.pages[0]!.id,
    color: "#f4f0e6",
    style: "fiber",
    textColors: "match",
  });
  assert.equal(
    (next.pages[0]!.elements.find((e) => e.id === text.id) as typeof text).style
      .color,
    "#ffffff",
  );
});
