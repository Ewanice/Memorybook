import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ResourceLibrary } from "../src/infrastructure/resource-library";
import {
  coverCatalog,
  defaultCovers,
  instantiateCover,
} from "../src/domain/covers";
import {
  createAlbum,
  layoutCatalog,
  randomLayoutPlan,
  suggestedPageCount,
} from "../src/domain/templates";
import { assertLayout } from "../src/domain/layout-validation";
import { assertTemplateDraft } from "../src/domain/template-draft";
import { assertAlbum, assertSettings } from "../src/domain/validation";
import { defaultSettings, sizes } from "../src/domain/model";
import { Store } from "../src/infrastructure/store";
import { applyGenerationPlan } from "../src/infrastructure/generation-plan";
const asset = {
  id: "a".repeat(64),
  name: "photo",
  mime: "image/png" as const,
  width: 400,
  height: 300,
  bytes: 100,
};
function library() {
  const values = new Map<string, string>();
  return new ResourceLibrary(
    {
      getValue: (k) => values.get(k) ?? null,
      setValue: (k, v) => {
        values.set(k, v);
      },
    },
    "unused",
    "unused",
  );
}
test("空白与多图封面在本地和 Codex 模式中均不丢图、不重复，预估页数匹配", () => {
  const photos = Array.from({ length: 8 }, (_, i) => ({
    ...asset,
    id: (i + 1).toString(16).padStart(64, "0"),
  }));
  for (const coverId of ["", "builtin-duo"]) {
    const used = coverId ? 2 : 0;
    const book = createAlbum("cover", "", "paper", "a5", photos, {
      density: "standard",
      coverMode: "photo",
      layout: "random",
      coverLayoutId: coverId,
      randomSeed: 41,
    });
    const placed = book.pages.flatMap((p) =>
      p.elements.flatMap((e) =>
        e.type === "image" && e.role === "photo" ? [e.assetId] : [],
      ),
    );
    assert.equal(placed.length, photos.length);
    assert.equal(new Set(placed).size, photos.length);
    assert.equal(
      book.pages.length,
      suggestedPageCount(photos.length, "standard", "random", 41, [], [], used),
    );
    const base = createAlbum(
      "cover",
      "",
      "paper",
      "a5",
      photos.slice(0, used),
      { density: "standard", coverMode: "photo", coverLayoutId: coverId },
    );
    const indices = photos.flatMap((_, i) => (i < used ? [] : [i]));
    const pages = [];
    for (let i = 0; i < indices.length; i += 6)
      pages.push({
        layoutId: "builtin-index",
        photoIndices: indices.slice(i, i + 6),
        phraseIndices: [],
        elements: [],
      });
    const generated = applyGenerationPlan(
      base,
      photos,
      [],
      [],
      layoutCatalog(),
      "templates",
      { pages },
    );
    const all = generated.pages.flatMap((p) =>
      p.elements.flatMap((e) =>
        e.type === "image" && e.role === "photo" ? [e.assetId] : [],
      ),
    );
    assert.equal(all.length, photos.length);
    assert.equal(new Set(all).size, photos.length);
  }
});
test("默认封面可编辑持久保存、标注用途；完整图片封面标题顶部居中，旧封面不被修改", () => {
  const lib = library();
  const cover = defaultCovers(sizes.a5, "paper")[1]!;
  assertLayout(cover);
  assertTemplateDraft(cover);
  const title = cover.page.elements.find((e) => e.name === "封面标题")!;
  assert(title.type === "text");
  assert.equal(title.frame.y, 0);
  assert.equal(title.style.align, "center");
  assert(!title.style.outline?.enabled);
  const existing = createAlbum("old", "city", "paper", "a5", [asset]);
  const snapshot = structuredClone(existing);
  title.style.color = "#743e62";
  cover.name = "My cover";
  lib.saveLayout(cover);
  const album = createAlbum(
    "新标题",
    "北京",
    "paper",
    "a5",
    [asset],
    { density: "standard", coverMode: "complete" },
    { customLayouts: lib.layouts() },
  );
  assertAlbum(album);
  const text = album.pages[0]!.elements.find((e) => e.name === "封面标题")!;
  assert(text.type === "text");
  assert.equal(text.text, "新标题");
  assert.equal(text.style.color, "#743e62");
  assert.deepEqual(existing, snapshot);
  assert.equal(coverCatalog(sizes.a5, "paper", lib.layouts()).length, 2);
});
test("删除内置与自定义排版后不再参与生成；恢复默认保留自定义，封面不混入随机内页", () => {
  const lib = library();
  const custom = structuredClone(layoutCatalog()[0]!);
  custom.id = "custom-one";
  lib.saveLayout(custom);
  const cover = structuredClone(defaultCovers(sizes.a5, "paper")[0]!);
  cover.id = "custom-cover";
  lib.saveLayout(cover);
  lib.removeLayout("builtin-hero");
  lib.removeLayout("builtin-cover-photo");
  const plan = randomLayoutPlan(
    80,
    42,
    lib.layouts(),
    sizes.a5,
    "paper",
    lib.hiddenLayouts(),
  );
  assert(plan.every((t) => t.id !== "builtin-hero" && t.kind !== "cover"));
  assert.equal(
    coverCatalog(sizes.a5, "paper", lib.layouts(), lib.hiddenLayouts()).length,
    2,
  );
  const photos = Array.from({ length: 20 }, (_, i) => ({
    ...asset,
    id: i.toString(16).padStart(64, "0"),
  }));
  const options = {
    ...({
      density: "standard",
      coverMode: "complete",
      layout: "random",
    } as const),
    randomSeed: 42,
  };
  const book = createAlbum("x", "", "paper", "a5", photos, options, {
    customLayouts: lib.layouts(),
    hiddenLayoutIds: lib.hiddenLayouts(),
  });
  assert.equal(
    book.pages.length,
    suggestedPageCount(
      photos.length,
      "standard",
      "random",
      42,
      lib.layouts(),
      lib.hiddenLayouts(),
    ),
  );
  lib.removeLayout(custom.id);
  assert(!lib.layouts().some((t) => t.id === custom.id));
  lib.restoreLayouts();
  assert.equal(lib.hiddenLayouts().length, 0);
  assert(lib.layouts().some((t) => t.id === cover.id));
  const all = layoutCatalog();
  for (const t of all.slice(0, -1)) lib.removeLayout(t.id);
  assert.throws(() => lib.removeLayout(all.at(-1)!.id), /至少保留/);
});
test("内页排版可用作封面；标题角色自动填入，缺失或已删除的选择明确报错", () => {
  const t = layoutCatalog()[0]!;
  const text = t.page.elements.find((e) => e.type === "text")!;
  text.name = "封面标题";
  const page = instantiateCover(
    t,
    sizes.a5,
    [asset],
    [],
    ["短语"],
    "来自用户的标题",
    "北京",
  );
  assert.equal(page.role, "cover");
  assert(
    page.elements.some((e) => e.type === "text" && e.text === "来自用户的标题"),
  );
  assert(
    !t.page.elements.some(
      (e) => e.type === "text" && e.text === "来自用户的标题",
    ),
  );
  assert.throws(
    () =>
      createAlbum("x", "", "paper", "a5", [], {
        density: "standard",
        coverMode: "photo",
        coverLayoutId: "missing",
      }),
    /已删除/,
  );
});
test("外观设置兼容旧设置并持久保存，首页背景纳入原图保护；拒绝注入样式与路径", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "memorybook-appearance-"));
  const store = new Store(folder);
  t.after(() => {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  });
  assertSettings(defaultSettings);
  const settings = {
    ...defaultSettings,
    displayName: "我的回忆",
    accentColor: "#96576b",
    homeBackground: asset.id,
    homeBackgroundOpacity: 0.25,
    homeBackgroundScale: 1.75,
  };
  store.saveSettings(settings);
  assert.deepEqual(store.settings(), settings);
  assert(store.protectedAssets().has(asset.id));
  assert.throws(() =>
    assertSettings({ ...settings, homeBackground: "file:///secret" }),
  );
  assert.throws(() =>
    assertSettings({ ...settings, accentColor: "url(https://example.com)" }),
  );
  assert.throws(() =>
    assertSettings({ ...settings, homeBackgroundOpacity: 2 }),
  );
  assert.throws(() =>
    assertSettings({ ...settings, homeBackgroundScale: 0.5 }),
  );
  assert.throws(() => assertSettings({ ...settings, homeBackgroundScale: 5 }));
  assert.throws(() =>
    assertSettings({ ...settings, displayName: " ".repeat(3) }),
  );
});
