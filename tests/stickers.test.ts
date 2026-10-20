import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type Asset, imageElement } from "../src/domain/model";
import { assetLibraryIndex, assetsForRole } from "../src/domain/asset-library";
import { createAlbum, layoutCatalog } from "../src/domain/templates";
import { assertAlbum } from "../src/domain/validation";
import { applyGenerationPlan } from "../src/infrastructure/generation-plan";
import { Store } from "../src/infrastructure/store";
import { AlbumService } from "../src/application/service";
import { GenerationCoordinator } from "../src/application/generation";
const asset = (n: number): Asset => ({
  id: n.toString(16).padStart(64, "0"),
  name: `asset-${n}.png`,
  mime: "image/png",
  bytes: 10,
  width: 600,
  height: 600,
});
test("照片与贴纸独立分类，未选入本册的全局贴纸仍可选用，同图可具有两种用途", () => {
  const photo = asset(1),
    sticker = asset(2),
    global = asset(3);
  const album = createAlbum("分类", "", "paper", "a5", [photo], undefined, {
    stickers: [sticker],
  });
  assert.deepEqual(
    assetsForRole(album, "photo", [sticker, global]).map((a) => a.id),
    [photo.id],
  );
  assert.deepEqual(
    new Set(
      assetsForRole(album, "sticker", [sticker, global]).map((a) => a.id),
    ),
    new Set([sticker.id, global.id]),
  );
  assert.deepEqual(assetLibraryIndex(album), {
    photos: [photo.id],
    stickers: [sticker.id],
  });
  const dual = createAlbum("双用途", "", "paper", "a5", [photo], undefined, {
    stickers: [photo],
  });
  assert.equal(assetsForRole(dual, "photo").length, 1);
  assert.equal(assetsForRole(dual, "sticker").length, 1);
  const legacy = structuredClone(album);
  delete legacy.assetLibrary;
  assert.deepEqual(
    assetsForRole(legacy, "photo", [sticker]).map((a) => a.id),
    [photo.id],
  );
  assert.deepEqual(
    assetsForRole(legacy, "sticker", [sticker]).map((a) => a.id),
    [sticker.id],
  );
});
test("添加、移除、撤销贴纸均持久保存分类，移出全局库不破坏本册引用", async () => {
  const store = new Store(await mkdtemp(join(tmpdir(), "memory-sticker-")));
  try {
    const service = new AlbumService(store),
      sticker = asset(2),
      photo = asset(1);
    let a = service.create("分类", "", "paper", "a5", [photo]);
    a = service.addAssets(a.id, a.revision, [sticker], "sticker");
    assert.deepEqual(
      assetsForRole(a, "photo").map((a) => a.id),
      [photo.id],
    );
    a = service.edit(a.id, a.revision, {
      type: "addElement",
      pageId: a.pages[0]!.id,
      element: imageElement(
        sticker,
        { x: 30, y: 30, width: 60, height: 60 },
        "sticker",
      ),
    });
    assert.deepEqual(
      assetsForRole(store.get(a.id), "sticker", []).map((a) => a.id),
      [sticker.id],
    );
    a = service.history(a.id, a.revision, "undo");
    a = service.edit(a.id, a.revision, {
      type: "removeAsset",
      assetId: sticker.id,
    });
    assert.equal(assetsForRole(a, "sticker").length, 0);
    assertAlbum(a);
    a = service.history(a.id, a.revision, "undo");
    assert.equal(assetsForRole(a, "sticker").length, 1);
    const bad = structuredClone(a);
    bad.assetLibrary!.stickers.push(asset(8).id);
    assert.throws(() => assertAlbum(bad), /分类/);
  } finally {
    store.close();
  }
});
test("已选贴纸的 Codex 自由稿必须实际排入，固定排版自动填入贴纸", () => {
  const photos = [asset(1), asset(2)],
    sticker = asset(3),
    base = createAlbum("Codex", "", "paper", "a5", photos.slice(0, 1));
  const photo = {
    kind: "photo",
    assetIndex: 1,
    text: null,
    x: 30,
    y: 30,
    width: 300,
    height: 350,
    rotation: 0,
    fontSize: null,
    color: null,
  };
  const plan = {
    pages: [
      {
        layoutId: "custom",
        photoIndices: [1],
        phraseIndices: [],
        elements: [photo],
      },
    ],
  };
  assert.throws(
    () =>
      applyGenerationPlan(
        base,
        photos,
        [sticker],
        [],
        layoutCatalog(),
        "creative",
        plan,
      ),
    /未使用本次选择的贴纸/,
  );
  const complete = {
    pages: [
      {
        ...plan.pages[0]!,
        elements: [
          photo,
          {
            ...photo,
            kind: "sticker",
            assetIndex: 0,
            x: 310,
            y: 420,
            width: 60,
            height: 60,
          },
        ],
      },
    ],
  };
  const book = applyGenerationPlan(
    base,
    photos,
    [sticker],
    [],
    layoutCatalog(),
    "creative",
    complete,
  );
  assert.equal(
    book.pages[1]!.elements.filter(
      (e) => e.type === "image" && e.role === "sticker",
    ).length,
    1,
  );
  assert.deepEqual(book.assetLibrary!.stickers, [sticker.id]);
  const layout = layoutCatalog().find((t) =>
    t.page.elements.some((e) => e.type === "photoSlot" && e.role === "sticker"),
  )!;
  const fixed = applyGenerationPlan(
    base,
    photos,
    [sticker],
    [],
    layoutCatalog(),
    "templates",
    {
      pages: [
        {
          layoutId: layout.id,
          photoIndices: [1],
          phraseIndices: [],
          elements: [],
        },
      ],
    },
  );
  assert(
    fixed.pages[1]!.elements.some(
      (e) =>
        e.type === "image" && e.role === "sticker" && e.assetId === sticker.id,
    ),
  );
});

test("Codex 请求包含独立贴纸元数据与带类型的预览，合法结果保留素材分类", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memory-sticker-request-")),
    store = new Store(dir),
    coordinator = new GenerationCoordinator(store, dir, async () => {});
  const photos = [asset(1), asset(2)],
    sticker = asset(3),
    base = createAlbum("请求", "", "paper", "a5", photos.slice(0, 1));
  coordinator.connect = async () => ({
    connected: true,
    ready: true,
    message: "test",
    executable: "",
    skills: [],
  });
  let checked = false;
  coordinator.bridge.generate = async (
    prompt,
    _schema,
    _skills,
    _signal,
    _progress,
    _model,
    images,
  ) => {
    assert(prompt.includes('"stickers":[{"index":0,"name":"asset-3.png"'));
    assert(prompt.includes('"kind":"photo","index":0'));
    assert(prompt.includes('"kind":"sticker","index":0'));
    assert(prompt.includes("必须在内页实际使用至少一张已选贴纸"));
    assert.deepEqual(images, ["photo-preview.png", "sticker-preview.png"]);
    checked = true;
    return {
      pages: [
        {
          layoutId: "custom",
          photoIndices: [1],
          phraseIndices: [],
          elements: [
            {
              kind: "photo",
              assetIndex: 1,
              text: null,
              x: 30,
              y: 30,
              width: 300,
              height: 350,
              rotation: 0,
              fontSize: null,
              color: null,
            },
            {
              kind: "sticker",
              assetIndex: 0,
              text: null,
              x: 310,
              y: 420,
              width: 60,
              height: 60,
              rotation: 0,
              fontSize: null,
              color: null,
            },
          ],
        },
      ],
    };
  };
  try {
    const book = await coordinator.generate(
      base,
      photos,
      [sticker],
      [],
      layoutCatalog(),
      "creative",
      async () => [
        { kind: "photo", index: 0, path: "photo-preview.png" },
        { kind: "sticker", index: 0, path: "sticker-preview.png" },
      ],
    );
    assert(checked);
    assert.deepEqual(store.get(book.id).assetLibrary!.stickers, [sticker.id]);
  } finally {
    coordinator.close();
    store.close();
  }
});

test("旧工程首次修改和继续导入照片时保留全局贴纸分类", async () => {
  const store = new Store(
      await mkdtemp(join(tmpdir(), "memory-old-stickers-")),
    ),
    photo = asset(1),
    sticker = asset(2);
  try {
    const old = createAlbum("旧工程", "", "paper", "a5", [photo], undefined, {
      stickers: [sticker],
    });
    delete old.assetLibrary;
    store.create(old);
    const service = new AlbumService(store, () => [sticker.id]);
    let book = service.edit(old.id, old.revision, {
      type: "rename",
      name: "已升级",
    });
    assert.deepEqual(book.assetLibrary!.stickers, [sticker.id]);
    book = service.addAssets(book.id, book.revision, [asset(3)]);
    assert.deepEqual(
      assetsForRole(book, "photo").map((a) => a.id),
      [photo.id, asset(3).id],
    );
    assert.deepEqual(
      assetsForRole(book, "sticker").map((a) => a.id),
      [sticker.id],
    );
  } finally {
    store.close();
  }
});
