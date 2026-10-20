import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/infrastructure/store";
import { openStore } from "../src/infrastructure/open-store";
import { health } from "../src/infrastructure/health";
import { ResourceLibrary } from "../src/infrastructure/resource-library";
import { createAlbum, layoutCatalog } from "../src/domain/templates";
import { applyEdit } from "../src/domain/edit";
import { assertAlbum } from "../src/domain/validation";
import { imageDimensions } from "../src/infrastructure/image-header";
import { reflowPage } from "../src/domain/reflow";
import { imageElement, type Asset } from "../src/domain/model";
import { writeArchive, readArchive } from "../src/infrastructure/archive";
import { zipSync, unzipSync, Zip, ZipPassThrough } from "fflate";
import { exportSelection } from "../src/domain/export-options";
import { assertMissingResources } from "../src/domain/missing-resources";
import { backupDatabase } from "../src/infrastructure/database-backup";
import { propose, clearProviderCache } from "../src/infrastructure/ai-provider";
import { textElement, defaultAiConfig } from "../src/domain/model";
const temp = () => mkdtempSync(join(tmpdir(), "memorybook-resilience-"));

test("自定义尺寸与页范围校验，不改变原书页码来源", () => {
  const a = createAlbum("A4", "", "paper", "a5", [], {
    density: "standard",
    coverMode: "photo",
    customSize: { width: (210 * 72) / 25.4, height: (297 * 72) / 25.4 },
  });
  assertAlbum(a);
  assert.equal(a.size.height, (297 * 72) / 25.4);
  const selection = exportSelection(a, { fromPage: 2, toPage: 2, bleedMm: 3 });
  assert.equal(selection.pages.length, 1);
  assert.equal(selection.pages[0]!.id, a.pages[1]!.id);
  assert.equal(a.pages.length, 2);
  assert(Math.abs(selection.bleed - 8.503937) < 0.001);
  assert.throws(() => exportSelection(a, { fromPage: 0 }));
  assert.throws(() => exportSelection(a, { toPage: 3 }));
  assert.throws(() =>
    createAlbum("bad", "", "paper", "a5", [], {
      density: "standard",
      coverMode: "photo",
      customSize: { width: 1, height: 1 },
    }),
  );
});
test("缺失资源说明只允许本工程资源，不能把损坏包伪装成任意外部引用", () => {
  const a = createAlbum("missing", "", "paper", "a5", []);
  assertMissingResources({ assets: [], fonts: [] }, a);
  assert.throws(() =>
    assertMissingResources({ assets: ["f".repeat(64)], fonts: [] }, a),
  );
  assert.throws(() =>
    assertMissingResources({ assets: [], fonts: [], extra: true }, a),
  );
});

test("后台数据库副本可以恢复损坏数据库并保留工程与设置", async () => {
  const directory = temp(),
    store = new Store(directory);
  const album = store.create(
    createAlbum("database recovery", "", "paper", "a5", []),
  );
  store.setValue("template-draft", "fixture draft");
  await backupDatabase(directory);
  store.close();
  writeFileSync(join(directory, "memorybook.sqlite"), "broken database");
  const restored = await openStore(directory);
  try {
    assert.equal(restored.get(album.id).name, album.name);
    assert.equal(restored.getValue("template-draft"), "fixture draft");
  } finally {
    restored.close();
  }
});
test("数据库表结构损坏时保留原库并打开可恢复工作空间", async (t) => {
  const directory = temp(),
    db = new DatabaseSync(join(directory, "memorybook.sqlite"));
  db.exec("CREATE TABLE unexpected(value TEXT);PRAGMA user_version=3;");
  db.close();
  const store = await openStore(directory);
  t.after(() => store.close());
  assert.deepEqual(store.list(), []);
  assert(readdirSync(directory).some((n) => n.startsWith("damaged-database-")));
});
test("旧版撤销记录损坏不会阻断升级或正文编辑", async (t) => {
  const directory = temp(),
    album = createAlbum("legacy usable", "", "paper", "a5", []),
    db = new DatabaseSync(join(directory, "memorybook.sqlite"));
  db.exec(
    "CREATE TABLE albums(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,document TEXT NOT NULL,cursor INTEGER NOT NULL DEFAULT 0);CREATE TABLE history(album_id TEXT,seq INTEGER,before_doc TEXT,after_doc TEXT,origin TEXT);CREATE TABLE preferences(key TEXT PRIMARY KEY,value TEXT);PRAGMA user_version=2;",
  );
  db.prepare("INSERT INTO albums VALUES(?,?,?,1)").run(
    album.id,
    0,
    JSON.stringify(album),
  );
  db.prepare("INSERT INTO history VALUES(?,?,?,?,?)").run(
    album.id,
    1,
    "{broken",
    JSON.stringify(album),
    "manual",
  );
  db.close();
  const store = await openStore(directory);
  t.after(() => store.close());
  assert.equal(store.list()[0]!.name, album.name);
  const saved = store.save(
    { ...store.get(album.id), name: "still editable" },
    0,
  );
  assert.equal(saved.name, "still editable");
  assert(readdirSync(directory).some((n) => n.startsWith("before-schema-v3-")));
});
test("导入资料保留撤销历史，字体引用包含场景内的字体族名称", (t) => {
  const source = new Store(temp()),
    target = new Store(temp());
  t.after(() => {
    source.close();
    target.close();
  });
  let album = source.create(createAlbum("history copy", "", "paper", "a5", []));
  const font = "b".repeat(64),
    text = album.pages[0]!.elements[0]!;
  if (text.type !== "text") throw new Error();
  text.style.fontFamily = "MemoryFont_" + font;
  album = source.save({ ...album, name: "changed" }, album.revision);
  assert(source.protectedAssets().has(font));
  const copy = target.transaction(() => target.copyFrom(source, album.id));
  const previous = target.history(copy.id, "undo", copy.revision);
  assert.equal(previous.name, "history copy");
  assert(target.protectedAssets().has(font));
});
test("AI 分组失败后可复用已完成组，并能选择已导入字体", async () => {
  clearProviderCache();
  const originalFetch = globalThis.fetch;
  let calls = 0,
    fail = true;
  const album = createAlbum("AI retry", "", "paper", "a5", []),
    page = album.pages[1]!;
  page.elements = Array.from({ length: 9 }, (_, i) =>
    textElement(
      `line ${i}`,
      { x: 30, y: 20 + i * 45, width: 200, height: 35 },
      12,
    ),
  );
  album.annotations = page.elements.map((e) => ({
    id: crypto.randomUUID(),
    pageId: page.id,
    elementId: e.id,
    text: "调整字体",
    status: "pending",
    message: "",
  }));
  const family = "MemoryFont_" + "c".repeat(64);
  globalThis.fetch = async (_url, init) => {
    calls++;
    const request = JSON.parse(String(init!.body));
    const content = JSON.parse(request.messages[1].content.split("\n")[0]);
    if (content.annotations.length === 1 && fail)
      return new Response("", { status: 429 });
    const changes = Object.fromEntries(
      [
        "x",
        "y",
        "width",
        "height",
        "rotation",
        "opacity",
        "text",
        "fontSize",
        "color",
        "align",
        "lineHeight",
        "bold",
        "fontFamily",
        "letterSpacing",
        "crop",
      ].map((k) => [k, null]),
    );
    const result = {
      results: content.annotations.map((note: { id: string }) => ({
        annotationId: note.id,
        status: "proposed",
        message: "已调整字体",
        changes: { ...changes, fontFamily: family },
      })),
    };
    return Response.json({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(result) } },
      ],
    });
  };
  const input = { taskId: crypto.randomUUID(), album, previews: [] },
    config = {
      key: "test-key",
      settings: { ...defaultAiConfig, model: "fixture" },
      fontFamilies: [family],
    };
  try {
    await assert.rejects(
      propose(input, config, new AbortController().signal),
      /429/,
    );
    assert.equal(calls, 2);
    fail = false;
    const result = (await propose(
      input,
      config,
      new AbortController().signal,
    )) as { results: { element: { style: { fontFamily: string } } }[] };
    assert.equal(calls, 3);
    assert.equal(result.results.length, 9);
    assert(result.results.every((r) => r.element.style.fontFamily === family));
  } finally {
    globalThis.fetch = originalFetch;
    clearProviderCache();
  }
});

test("单个损坏工程不阻断工程列表，原始记录保留且可发现", (t) => {
  const directory = temp(),
    store = new Store(directory);
  t.after(() => store.close());
  const good = store.create(createAlbum("good", "", "paper", "a5", [])),
    bad = store.create(createAlbum("bad", "", "paper", "a5", []));
  const db = new DatabaseSync(join(directory, "memorybook.sqlite"));
  db.prepare("UPDATE albums SET document=? WHERE id=?").run("{broken", bad.id);
  db.close();
  assert.deepEqual(
    store.list().map((a) => a.id),
    [good.id],
  );
  assert.equal(store.get(good.id).name, "good");
  assert(store.recovery().some((r) => r.kind === "damaged" && r.id === bad.id));
  assert(health.list().some((r) => r.key === `album:${bad.id}`));
});
test("整个数据库损坏时隔离原字节，正常打开新工作空间", async (t) => {
  const directory = temp(),
    raw = Buffer.from("corrupt sqlite bytes");
  writeFileSync(join(directory, "memorybook.sqlite"), raw);
  const store = await openStore(directory);
  t.after(() => store.close());
  assert.deepEqual(store.list(), []);
  const quarantine = readdirSync(directory).find((n) =>
    n.startsWith("damaged-database-"),
  )!;
  assert.deepEqual(
    readFileSync(join(directory, quarantine, "memorybook.sqlite")),
    raw,
  );
  store.create(createAlbum("usable", "", "paper", "a5", []));
  assert.equal(store.list().length, 1);
});
test("最近删除和恢复副本可以恢复，恢复副本不覆盖现有工程", (t) => {
  const store = new Store(temp());
  t.after(() => store.close());
  const album = store.create(createAlbum("recovery", "", "paper", "a5", []));
  store.remove(album.id);
  assert.equal(store.list().length, 0);
  assert(store.recovery().some((r) => r.kind === "trash"));
  store.recover(album.id, "trash");
  assert.equal(store.get(album.id).name, album.name);
  const snapshot = store.recovery().find((r) => r.kind === "snapshot")!;
  const copy = store.recover(snapshot.id, "snapshot");
  assert.notEqual(copy.id, album.id);
  assert.equal(store.list().length, 2);
  assert.throws(() => store.recover("../memorybook.sqlite", "snapshot"));
});
test("撤销历史保留两百步并且回收保护覆盖历史、回收站和快照", (t) => {
  const store = new Store(temp());
  t.after(() => store.close());
  let album = store.create(createAlbum("history", "", "paper", "a5", []));
  for (let i = 0; i < 205; i++)
    album = store.save({ ...album, name: `history ${i}` }, album.revision);
  for (let i = 0; i < 200; i++)
    album = store.history(album.id, "undo", album.revision);
  assert.throws(() => store.history(album.id, "undo", album.revision));
  const id = "a".repeat(64);
  store.setValue("sticker-library", JSON.stringify([{ id }]));
  assert(store.protectedAssets().has(id));
});
test("损坏贴纸和排版记录被逐条隔离，库原文被保留", (t) => {
  const store = new Store(temp());
  t.after(() => store.close());
  const library = new ResourceLibrary(
    store,
    join(store.directory, "phrases.txt"),
    "assets/phrases.txt",
  );
  const valid: Asset = {
    id: "a".repeat(64),
    name: "sticker",
    mime: "image/png",
    width: 10,
    height: 10,
    bytes: 100,
  };
  const raw = JSON.stringify([valid, { id: "bad" }]);
  store.setValue("sticker-library", raw);
  assert.deepEqual(library.stickers(), [valid]);
  assert.equal(store.getValue("sticker-library"), raw);
  const template = layoutCatalog()[0]!;
  store.setValue(
    "layout-library",
    JSON.stringify([template, { name: "broken" }]),
  );
  assert.deepEqual(library.layouts(), [template]);
  library.removeSticker(valid.id);
  assert.deepEqual(library.stickers(), []);
});
test("套用低容量排版自动拆页且不丢照片、文字或贴纸", () => {
  const photos: Asset[] = Array.from({ length: 6 }, (_, i) => ({
    id: i.toString(16).padStart(64, "0"),
    name: `photo ${i}`,
    mime: "image/png",
    width: 1000,
    height: 800,
    bytes: 100,
  }));
  const album = createAlbum("reflow", "", "paper", "a5", photos),
    page = album.pages[1]!;
  page.elements = photos.map((a, i) =>
    imageElement(a, { x: 30, y: 30 + i * 30, width: 100, height: 100 }),
  );
  const template = layoutCatalog().find(
    (t) =>
      t.page.elements.filter(
        (e) => e.type === "photoSlot" && e.role !== "sticker",
      ).length === 1,
  )!;
  const pages = reflowPage(album, page, template);
  assert.equal(pages.length, 6);
  assert.deepEqual(
    pages
      .flatMap((p) =>
        p.elements.filter((e) => e.type === "image").map((e) => e.id),
      )
      .sort(),
    page.elements.map((e) => e.id).sort(),
  );
  const next = applyEdit(album, {
    type: "batch",
    edits: [
      ...pages.slice(1).map((page) => ({ type: "addPage" as const, page })),
      { type: "replacePage", page: pages[0]! },
    ],
  });
  assertAlbum(next);
});
test("批量编辑具有原子性和单步撤销，不修改源对象", (t) => {
  const store = new Store(temp());
  t.after(() => store.close());
  const album = store.create(createAlbum("atomic", "", "paper", "a5", [])),
    page = album.pages[0]!,
    el = page.elements[0]!;
  assert.throws(() =>
    applyEdit(album, {
      type: "batch",
      edits: [
        {
          type: "translateElement",
          pageId: page.id,
          elementId: el.id,
          dx: 10,
          dy: 0,
        },
        { type: "removeElement", pageId: page.id, elementId: "absent" },
      ],
    }),
  );
  assert.equal(store.get(album.id).pages[0]!.elements[0]!.frame.x, el.frame.x);
  const next = store.save(
    applyEdit(album, {
      type: "batch",
      edits: [
        {
          type: "translateElement",
          pageId: page.id,
          elementId: el.id,
          dx: 10,
          dy: 0,
        },
        { type: "rename", name: "changed" },
      ],
    }),
    album.revision,
  );
  const previous = store.history(album.id, "undo", next.revision);
  assert.equal(previous.name, album.name);
  assert.equal(previous.pages[0]!.elements[0]!.frame.x, el.frame.x);
});
test("图片头尺寸预检在解码前拒绝超大尺寸", () => {
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.writeUInt32BE(100000, 16);
  header.writeUInt32BE(100000, 20);
  assert.throws(() => imageDimensions(header), /尺寸过大/);
  header.writeUInt32BE(20, 16);
  header.writeUInt32BE(30, 20);
  assert.deepEqual(imageDimensions(header), { width: 20, height: 30 });
  assert.throws(() => imageDimensions(Buffer.from("bad")));
});
test("流式工程包读写完整，拒绝非法路径、重复条目和截断文件", async () => {
  const directory = temp(),
    path = join(directory, "album.memorybook"),
    id = "a".repeat(64),
    bytes = Buffer.alloc(3 * 1024 * 1024, 7);
  const input = join(directory, "asset");
  writeFileSync(input, bytes);
  await writeArchive(path, [
    { name: "album.json", bytes: Buffer.from("{}") },
    { name: `assets/${id}`, path: input },
  ]);
  const files = await readArchive(path, join(directory, "read"));
  assert.equal(statSync(files.get(`assets/${id}`)!).size, bytes.length);
  assert.deepEqual(readFileSync(files.get(`assets/${id}`)!), bytes);
  const tampered = unzipSync(readFileSync(path));
  tampered["album.json"] = Buffer.from("[]");
  writeFileSync(join(directory, "tampered"), zipSync(tampered));
  await assert.rejects(
    readArchive(join(directory, "tampered"), join(directory, "tampered-read")),
    /校验失败/,
  );
  const chunks: Uint8Array[] = [];
  const duplicate = new Zip((_error, data) => chunks.push(data));
  for (let i = 0; i < 2; i++) {
    const entry = new ZipPassThrough("album.json");
    duplicate.add(entry);
    entry.push(Buffer.from("{}"), true);
  }
  duplicate.end();
  writeFileSync(join(directory, "duplicate"), Buffer.concat(chunks));
  await assert.rejects(
    readArchive(
      join(directory, "duplicate"),
      join(directory, "duplicate-read"),
    ),
    /重复文件/,
  );
  writeFileSync(
    join(directory, "evil"),
    zipSync({ "../../outside": Buffer.from("no") }),
  );
  await assert.rejects(
    readArchive(join(directory, "evil"), join(directory, "evil-read")),
    /非法路径/,
  );
  writeFileSync(
    join(directory, "truncated"),
    readFileSync(path).subarray(0, 200),
  );
  await assert.rejects(
    readArchive(
      join(directory, "truncated"),
      join(directory, "truncated-read"),
    ),
  );
});
