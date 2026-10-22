import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { inspectFont, FontStore } from "../src/infrastructure/fonts";
import {
  migrateLegacy,
  migratePortableNames,
  configureStorage,
} from "../src/infrastructure/portable";
import { createAlbum } from "../src/domain/templates";
import { applyEdit } from "../src/domain/edit";
import { assertAlbum } from "../src/domain/validation";
import { usedFontIds, fontCss } from "../src/domain/fonts";
import { Store } from "../src/infrastructure/store";
import { defaultSettings } from "../src/domain/model";
import type { App } from "electron";
import { rm } from "node:fs/promises";

test("全新目录不读取系统用户目录，不继承其他安装的设置或工程；本目录重启保留设置", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "memory-fresh-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const legacy = join(folder, "old-system-profile"),
    root = join(folder, "Memorybook");
  const oldStore = new Store(legacy);
  oldStore.saveSettings({
    ...defaultSettings,
    exportDirectory: join(folder, "old-exports"),
    aiEnabled: true,
  });
  oldStore.create(createAlbum("旧工程", "", "paper", "a5", []));
  oldStore.close();
  const requested: string[] = [];
  const app = {
    getAppPath: () => join(root, "resources", "app.asar"),
    getPath: (key: string) => {
      requested.push(key);
      return key === "userData" ? legacy : join(root, "Memorybook.exe");
    },
    setPath: () => {},
    setAppLogsPath: () => {},
  } as unknown as App;
  const paths = configureStorage(app, false);
  assert.equal(paths.root, root);
  assert(!requested.includes("userData"));
  await migrateLegacy(paths);
  const fresh = new Store(paths.data);
  assert.deepEqual(fresh.settings(), defaultSettings);
  assert.equal(fresh.list().length, 0);
  fresh.saveSettings({
    ...defaultSettings,
    exportDirectory: join(root, "chosen-exports"),
  });
  fresh.close();
  await migrateLegacy(paths);
  const reopened = new Store(paths.data);
  assert.equal(
    reopened.settings().exportDirectory,
    join(root, "chosen-exports"),
  );
  reopened.close();
  const original = new Store(legacy);
  assert.equal(original.list()[0]!.name, "旧工程");
  assert.equal(
    original.settings().exportDirectory,
    join(folder, "old-exports"),
  );
  original.close();
});
function fontFixture(restriction = 0) {
  const name = Buffer.from("Fixture Font", "utf16le");
  name.swap16();
  const names = Buffer.alloc(18 + name.length);
  names.writeUInt16BE(1, 2);
  names.writeUInt16BE(18, 4);
  names.writeUInt16BE(3, 6);
  names.writeUInt16BE(0x409, 10);
  names.writeUInt16BE(4, 12);
  names.writeUInt16BE(name.length, 14);
  name.copy(names, 18);
  const os2 = Buffer.alloc(10);
  os2.writeUInt16BE(restriction, 8);
  const tables = [
    ["head", Buffer.alloc(54)],
    ["cmap", Buffer.alloc(4)],
    ["name", names],
    ["OS/2", os2],
  ] as const;
  const bytes = Buffer.alloc(
    12 + tables.length * 16 + tables.reduce((n, t) => n + t[1].length, 0),
  );
  bytes.writeUInt32BE(0x10000);
  bytes.writeUInt16BE(tables.length, 4);
  let offset = 12 + tables.length * 16;
  tables.forEach(([tag, data], i) => {
    const p = 12 + i * 16;
    bytes.write(tag, p, "ascii");
    bytes.writeUInt32BE(offset, p + 8);
    bytes.writeUInt32BE(data.length, p + 12);
    data.copy(bytes, offset);
    offset += data.length;
  });
  return bytes;
}
test("字体拒绝损坏目录、禁止嵌入及路径伪造，重复导入按摘要复用", async () => {
  const bytes = fontFixture();
  assert.equal(inspectFont(bytes).name, "Fixture Font");
  assert.throws(() => inspectFont(fontFixture(2)), /禁止文档嵌入/);
  const broken = Buffer.from(bytes);
  broken.writeUInt32BE(0xffffffff, 20);
  assert.throws(() => inspectFont(broken), /范围/);
  const directory = await mkdtemp(join(tmpdir(), "memory-font-")),
    store = new FontStore(directory);
  const first = await store.put(bytes),
    second = await store.put(bytes);
  assert.equal(first.id, second.id);
  assert.deepEqual(await store.list(), [first]);
  await writeFile(store.path("f".repeat(64)), "broken font");
  assert.deepEqual(await store.list(), [first], "损坏字体不能阻断其他字体");
  assert.throws(() => store.path("../../secret"), /编号/);
  await assert.rejects(store.put(bytes, "f".repeat(64)), /校验/);
  const album = createAlbum("字体", "", "paper", "a5", []),
    text = album.pages[0]!.elements.find((e) => e.type === "text")!;
  if (text.type !== "text") throw Error();
  text.style.fontFamily = first.family;
  assertAlbum(album);
  assert.deepEqual(usedFontIds(album), [first.id]);
  assert(fontCss([first.id]).includes(`memory://font/${first.id}`));
  text.style.fontFamily = "malicious;url(https://example.com)";
  assert.throws(() => assertAlbum(album), /结构/);
});
test("逐页纸张可撤销，不改变其他页或旧文档格式", () => {
  const album = createAlbum("纸张", "", "paper", "a5", []),
    page = album.pages[0]!;
  delete page.backgroundStyle;
  const updated = applyEdit(album, {
    type: "background",
    pageId: page.id,
    color: "#d7b991",
    style: "kraft",
  });
  assert.equal(updated.pages[0]!.backgroundStyle, "kraft");
  assert.equal(album.pages[0]!.backgroundStyle, undefined);
  assertAlbum(album);
  assertAlbum(updated);
  assert.throws(
    () =>
      applyEdit(album, {
        type: "background",
        pageId: page.id,
        color: "#d7b991",
        style: "bogus" as never,
      }),
    /结构/,
  );
});
test("同目录旧数据升级保留源与原图，已有目标数据库不会被覆盖", async () => {
  const root = await mkdtemp(join(tmpdir(), "memory-portable-")),
    legacy = join(root, "数据"),
    data = join(root, "new");
  await mkdir(join(legacy, "assets"), { recursive: true });
  await writeFile(join(legacy, "assets", "original"), "photo");
  const db = new DatabaseSync(join(legacy, "memorybook.sqlite"));
  db.exec(
    "CREATE TABLE example(value TEXT);INSERT INTO example VALUES('saved');",
  );
  db.close();
  await migrateLegacy({ root, data, migrate: true });
  await access(join(legacy, "memorybook.sqlite"));
  assert.equal(
    await readFile(join(data, "assets", "original"), "utf8"),
    "photo",
  );
  const target = new DatabaseSync(join(data, "memorybook.sqlite"));
  assert.equal(
    target.prepare("SELECT value FROM example").get()!.value,
    "saved",
  );
  target.exec("UPDATE example SET value='new'");
  target.close();
  await migrateLegacy({ root, data, migrate: true });
  const reopened = new DatabaseSync(join(data, "memorybook.sqlite"));
  assert.equal(
    reopened.prepare("SELECT value FROM example").get()!.value,
    "new",
  );
  reopened.close();
});

test("中文旧目录迁移至 ASCII 路径，保留源且不覆盖已编辑的英文短语", async () => {
  const root = await mkdtemp(join(tmpdir(), "memory-ascii-")),
    data = join(root, "data"),
    old = join(root, "数据");
  await mkdir(data, { recursive: true });
  await mkdir(join(old, "assets"), { recursive: true });
  const db = new DatabaseSync(join(old, "memorybook.sqlite"));
  db.exec("CREATE TABLE saved(value TEXT);INSERT INTO saved VALUES('old');");
  db.close();
  await writeFile(join(old, "assets", "original"), "image");
  const seed = join(root, "seed.txt");
  await writeFile(seed, "seed");
  await writeFile(join(root, "phrases.txt"), "seed");
  await writeFile(join(root, "短语库.txt"), "my phrases");
  const fonts = new FontStore(join(root, "素材", "导入字体"));
  const font = await fonts.put(fontFixture());
  const paths = {
    root,
    data,
    migrate: true,
  };
  await migrateLegacy(paths);
  await migratePortableNames(paths, seed);
  assert.equal(await readFile(join(root, "phrases.txt"), "utf8"), "my phrases");
  assert.equal(
    await readFile(join(data, "assets", "original"), "utf8"),
    "image",
  );
  assert.equal(
    (await new FontStore(join(root, "materials", "imported-fonts")).list())[0]!
      .id,
    font.id,
  );
  await access(join(old, "memorybook.sqlite"));
  await access(join(root, "短语库.txt"));
  await writeFile(join(root, "phrases.txt"), "new edit");
  await migratePortableNames(paths, seed);
  assert.equal(await readFile(join(root, "phrases.txt"), "utf8"), "new edit");
});
