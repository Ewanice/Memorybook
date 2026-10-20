import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAlbum,
  createPage,
  layoutCatalog,
  randomLayoutPlan,
  suggestedPageCount,
} from "../src/domain/templates";
import { shuffledCycle, instantiateLayout } from "../src/domain/layouts";
import { assertLayout } from "../src/domain/layout-validation";
import { ResourceLibrary } from "../src/infrastructure/resource-library";
import { applyGenerationPlan } from "../src/infrastructure/generation-plan";
import { assertAlbum } from "../src/domain/validation";
import { applyEdit } from "../src/domain/edit";
import { pageNumber } from "../src/domain/pagination";
import { sizes, type Asset } from "../src/domain/model";
import { GenerationCoordinator } from "../src/application/generation";
import { Store } from "../src/infrastructure/store";

const photo = (index: number): Asset => ({
  id: index.toString(16).padStart(64, "0"),
  name: `照片${index}`,
  width: 900,
  height: 1200,
  bytes: 100,
  mime: "image/png",
});
test("Codex 自由版面只接受给定素材和合法几何，固定模式拒绝自由元素", () => {
  const photos = [photo(1), photo(2)],
    base = createAlbum("测试", "", "paper", "a5", photos.slice(0, 1));
  const image = {
    kind: "photo",
    assetIndex: 1,
    text: null,
    x: 28,
    y: 40,
    width: 300,
    height: 350,
    rotation: 0,
    fontSize: null,
    color: null,
  };
  const text = {
    kind: "text",
    assetIndex: null,
    text: "一起留下回忆",
    x: 28,
    y: 420,
    width: 300,
    height: 50,
    rotation: 0,
    fontSize: 16,
    color: "#33443b",
  };
  const plan = {
    pages: [
      {
        layoutId: "custom",
        photoIndices: [1],
        phraseIndices: [],
        elements: [image, text],
      },
    ],
  };
  assertAlbum(
    applyGenerationPlan(
      base,
      photos,
      [],
      [],
      layoutCatalog(),
      "creative",
      plan,
    ),
  );
  assert.throws(() =>
    applyGenerationPlan(
      base,
      photos,
      [],
      [],
      layoutCatalog(),
      "templates",
      plan,
    ),
  );
  const invalid = structuredClone(plan);
  invalid.pages[0]!.elements[0]!.x = -100;
  assert.throws(() =>
    applyGenerationPlan(
      base,
      photos,
      [],
      [],
      layoutCatalog(),
      "creative",
      invalid,
    ),
  );
  invalid.pages[0]!.elements[0]!.x = 28;
  invalid.pages[0]!.elements[0]!.assetIndex = 4;
  assert.throws(() =>
    applyGenerationPlan(
      base,
      photos,
      [],
      [],
      layoutCatalog(),
      "creative",
      invalid,
    ),
  );
});
const template = () => {
  const page = createPage(sizes.a5, "paper", "monologue");
  return {
    id: "user-layout",
    name: "自定义排版",
    size: sizes.a5,
    page,
    phraseIds: page.elements
      .filter((e) => e.type === "text" && e.name.startsWith("短语"))
      .map((e) => e.id),
  };
};
test("随机轮用覆盖全部排版，种子一致且每轮无重复", () => {
  const items = Array.from({ length: 11 }, (_, i) => i);
  const next = shuffledCycle(items, 42),
    other = shuffledCycle(items, 42);
  const a = Array.from({ length: 22 }, next),
    b = Array.from({ length: 22 }, other);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.slice(0, 11)).size, 11);
  assert.equal(new Set(a.slice(11)).size, 11);
  assert.notDeepEqual(a.slice(0, 11), items);
  const plan = randomLayoutPlan(90, 42, [template()]);
  assert.equal(new Set(plan.slice(0, 12).map((t) => t.id)).size, 12);
});
test("随机排版预估与生成一致，不丢照片，自定义排版参与生成", () => {
  for (const count of [0, 1, 2, 17, 90, 160]) {
    const photos = Array.from({ length: count }, (_, i) => photo(i + 1));
    const album = createAlbum(
      "测试",
      "",
      "paper",
      "a5",
      photos,
      {
        density: "standard",
        coverMode: "photo",
        layout: "random",
        randomSeed: 135,
      },
      { customLayouts: [template()] },
    );
    assertAlbum(album);
    assert.equal(
      album.pages.length,
      suggestedPageCount(count, "standard", "random", 135, [template()]),
    );
    assert.equal(
      album.pages
        .flatMap((p) => p.elements)
        .filter((e) => e.type === "image" && e.role === "photo").length,
      count,
    );
  }
});
test("排版保存校验、填充与独立元素 ID，不携带原图或失效短语引用", () => {
  const t = template();
  assertLayout(t);
  const a = instantiateLayout(
    t,
    sizes.square,
    [photo(1)],
    [photo(2)],
    ["用户的句子"],
  );
  const b = instantiateLayout(t, sizes.square, [photo(1)], [], []);
  assert(
    !a.elements.some((e) => b.elements.some((other) => other.id === e.id)),
  );
  assert(a.elements.some((e) => e.type === "text" && e.text === "用户的句子"));
  const invalid = structuredClone(t);
  invalid.phraseIds = ["missing"];
  assert.throws(() => assertLayout(invalid));
  invalid.phraseIds = [];
  invalid.page.elements[0]!.frame.x = -900;
  assert.throws(() => assertLayout(invalid));
});
test("短语软件内编辑与外部文件共用，版本冲突不覆盖，长句可读取修复", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memorybook-editor-")),
    path = join(dir, "短语库.txt"),
    seed = join(dir, "seed.txt");
  await writeFile(seed, "原句");
  const values = new Map<string, string>(),
    library = new ResourceLibrary(
      {
        getValue: (key) => values.get(key) ?? null,
        setValue: (key, value) => {
          values.set(key, value);
        },
      },
      path,
      seed,
    );
  const old = await library.phraseDocument();
  await library.savePhrases("新句一\n新句二", old.hash);
  assert.deepEqual(await library.phrases(), ["新句一", "新句二"]);
  await assert.rejects(library.savePhrases("过期修改", old.hash), /其他窗口/);
  await writeFile(path, "长".repeat(81));
  const long = await library.phraseDocument();
  assert.equal(long.text.length, 81);
  await library.savePhrases("修复后的句子", long.hash);
  assert.equal(await readFile(path, "utf8"), "修复后的句子");
  library.saveLayout(template());
  assert.equal(library.layouts().length, 1);
  library.removeLayout("user-layout");
  assert.equal(library.layouts().length, 0);
});
test("页码随内页顺序重新计算，不修改文字元素，兼容旧工程", () => {
  const a = createAlbum("测试", "", "paper", "a5", []);
  assert.equal(pageNumber(a, a.pages[1]!), null);
  a.pages.push(createPage(a.size, a.theme, "blank"));
  const b = applyEdit(a, {
    type: "pagination",
    value: { enabled: true, position: "bottom-right", start: 5 },
  });
  assert.equal(pageNumber(b, b.pages[0]!), null);
  assert.equal(pageNumber(b, b.pages[1]!)?.text, "5");
  assert.equal(pageNumber(b, b.pages[2]!)?.text, "6");
  const c = applyEdit(b, {
    type: "movePage",
    pageId: b.pages[2]!.id,
    direction: "up",
  });
  assert.equal(
    pageNumber(
      c,
      c.pages.find((p) => p.id === b.pages[2]!.id)!,
    )?.text,
    "5",
  );
  assert.throws(() =>
    applyEdit(b, {
      type: "pagination",
      value: { enabled: true, position: "wrong" as "bottom-right", start: 0 },
    }),
  );
});
test("Codex 固定排版方案严格校验照片完整性、引用和模式", () => {
  const photos = [photo(1), photo(2), photo(3)],
    base = createAlbum("测试", "", "paper", "a5", photos.slice(0, 1));
  const catalog = layoutCatalog();
  const result = {
    pages: [
      {
        layoutId: "builtin-dialogue",
        photoIndices: [1, 2],
        phraseIndices: [0],
        elements: [],
      },
    ],
  };
  const album = applyGenerationPlan(
    base,
    photos,
    [],
    ["短语"],
    catalog,
    "templates",
    result,
  );
  assertAlbum(album);
  assert.equal(album.pages.length, 2);
  assert.throws(() =>
    applyGenerationPlan(base, photos, [], ["短语"], catalog, "templates", {
      pages: [{ ...result.pages[0], photoIndices: [1, 1] }],
    }),
  );
  assert.throws(() =>
    applyGenerationPlan(base, photos, [], ["短语"], catalog, "templates", {
      pages: [{ ...result.pages[0], layoutId: "missing" }],
    }),
  );
  assert.throws(() =>
    applyGenerationPlan(base, photos, [], ["短语"], catalog, "templates", {
      pages: [{ ...result.pages[0], phraseIndices: [5] }],
    }),
  );
});
test("取消 Codex 生成后晚到结果不会创建工程", async () => {
  const path = await mkdtemp(join(tmpdir(), "memorybook-generation-")),
    store = new Store(path);
  const coordinator = new GenerationCoordinator(store, path, async () => {});
  let complete!: (value: unknown) => void;
  coordinator.connect = async () => ({
    connected: true,
    ready: true,
    message: "test",
    executable: "",
    skills: [],
  });
  coordinator.bridge.generate = async () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const base = createAlbum("测试", "", "paper", "a5", [photo(1)]);
  try {
    const result = coordinator.generate(
      base,
      [photo(1), photo(2)],
      [],
      [],
      layoutCatalog(),
      "templates",
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    coordinator.cancel();
    await assert.rejects(result, /取消/);
    complete({
      pages: [
        {
          layoutId: "builtin-monologue",
          photoIndices: [1],
          phraseIndices: [],
          elements: [],
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(store.list().length, 0);
  } finally {
    coordinator.close();
    store.close();
  }
});
