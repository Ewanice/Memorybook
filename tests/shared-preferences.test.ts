import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { App } from "electron";
import { Store } from "../src/infrastructure/store";
import { SharedPreferences } from "../src/infrastructure/shared-preferences";
import { configureStorage } from "../src/infrastructure/portable";
import { defaultSettings, defaultAiConfig } from "../src/domain/model";
import { createAlbum } from "../src/domain/templates";
import { AiPreferences } from "../src/infrastructure/ai-preferences";

test("同用户不同软件目录共用设置位置，工程路径保持各自独立", async (t) => {
  const location = await mkdtemp(join(tmpdir(), "memory-settings-location-"));
  t.after(() => rm(location, { recursive: true, force: true }));
  const appFor = (root: string) =>
    ({
      getAppPath: () => join(root, "resources", "app.asar"),
      getPath: (key: string) =>
        key === "appData"
          ? join(location, "profile")
          : join(root, "Memorybook.exe"),
      setPath: () => {},
      setAppLogsPath: () => {},
    }) as unknown as App;
  const a = configureStorage(appFor(join(location, "app-a")), false);
  const b = configureStorage(appFor(join(location, "app-b")), false);
  assert.equal(a.preferences, b.preferences);
  assert.notEqual(a.data, b.data);
  assert(a.data.startsWith(a.root));
  assert(b.data.startsWith(b.root));
});

test("共享设置持续可见，工程与素材库独立；删掉程序和本地资料后仍继承设置，旧副本不能覆盖", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "memory-shared-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = new Store(join(root, "app-a", "data")),
    b = new Store(join(root, "app-b", "data"));
  a.saveSettings({ ...defaultSettings, exportDirectory: "D:/Exports" });
  a.setValue("layout-library", "[]");
  const book = a.create(createAlbum("A 的工程", "", "paper", "a5", []));
  const first = new SharedPreferences(join(root, "profile"));
  const second = new SharedPreferences(join(root, "profile"));
  a.useSharedPreferences(first);
  b.useSharedPreferences(second);
  assert.equal(b.settings().exportDirectory, "D:/Exports");
  b.saveSettings(
    { ...b.settings(), exportDirectory: "E:/NewExports" },
    b.settings(),
  );
  assert.equal(a.settings().exportDirectory, "E:/NewExports");
  assert(first.changed());
  assert(!first.changed());
  assert.equal(a.list()[0]!.id, book.id);
  assert.equal(b.list().length, 0);
  b.setValue("sticker-library", "[]");
  assert.equal(a.getValue("sticker-library"), null);
  assert.equal(b.getValue("layout-library"), null);
  assert.throws(() => first.setValue("layout-library", "[]"));
  a.close();
  b.close();
  first.close();
  second.close();
  await rm(join(root, "app-a"), { recursive: true, force: true });
  const reinstalled = new Store(join(root, "app-c", "data"));
  reinstalled.saveSettings({
    ...defaultSettings,
    exportDirectory: "old-folder-value",
  });
  const shared = new SharedPreferences(join(root, "profile"));
  reinstalled.useSharedPreferences(shared);
  assert.equal(reinstalled.settings().exportDirectory, "E:/NewExports");
  assert.equal(reinstalled.list().length, 0);
  reinstalled.close();
  shared.close();
});

test("多窗口只合并实际修改的设置字段，同字段冲突拒绝旧值，恢复默认支持移除可选外观字段", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "memory-merge-"));
  const a = new SharedPreferences(root),
    b = new SharedPreferences(root);
  t.after(async () => {
    a.close();
    b.close();
    await rm(root, { recursive: true, force: true });
  });
  a.seedFrom({ getValue: () => null });
  const stale = structuredClone(defaultSettings);
  a.saveSettings({ ...stale, exportDirectory: "D:/First" }, stale);
  const merged = b.saveSettings({ ...stale, accentColor: "#123456" }, stale);
  assert.equal(merged.exportDirectory, "D:/First");
  assert.equal(merged.accentColor, "#123456");
  assert.throws(
    () => b.saveSettings({ ...stale, exportDirectory: "E:/Stale" }, stale),
    /另一个软件窗口/,
  );
  const reset = a.saveSettings(defaultSettings, merged);
  assert.equal(reset.accentColor, undefined);
  assert.equal(reset.exportDirectory, "");
});

test("AI 配置与本机加密凭证成对共享，旧编辑拒绝写入且不能修改当前凭证", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "memory-shared-ai-"));
  const a = new Store(join(root, "a")),
    b = new Store(join(root, "b"));
  const pa = new SharedPreferences(join(root, "profile")),
    pb = new SharedPreferences(join(root, "profile"));
  t.after(async () => {
    a.close();
    b.close();
    pa.close();
    pb.close();
    await rm(root, { recursive: true, force: true });
  });
  a.useSharedPreferences(pa);
  b.useSharedPreferences(pb);
  const cipher = {
    encrypt: (s: string) => Buffer.from(s).toString("base64"),
    decrypt: (s: string) => Buffer.from(s, "base64").toString(),
  };
  const aiA = new AiPreferences(a, cipher),
    aiB = new AiPreferences(b, cipher);
  aiA.configure(
    { ...defaultAiConfig, model: "first" },
    "test-only-value",
    defaultAiConfig,
  );
  assert.equal(aiB.config().model, "first");
  assert.equal(aiB.key(), "test-only-value");
  assert.throws(
    () =>
      aiB.configure(
        { ...defaultAiConfig, model: "stale" },
        "wrong-value",
        defaultAiConfig,
      ),
    /另一个副本/,
  );
  assert.equal(aiA.config().model, "first");
  assert.equal(aiA.key(), "test-only-value");
  aiB.removeKey();
  assert.equal(aiA.hasKey(), false);
});

test("共享设置损坏可恢复最近副本，保留损坏原字节；非法设置原文被隔离且不妨碍工程", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "memory-shared-damaged-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let prefs = new SharedPreferences(root);
  prefs.seedFrom({ getValue: () => null });
  prefs.saveSettings({ ...defaultSettings, exportDirectory: "D:/Kept" });
  prefs.close();
  await writeFile(join(root, "preferences.sqlite"), "broken-settings-database");
  prefs = new SharedPreferences(root);
  assert.equal(
    JSON.parse(prefs.getValue("settings")!).exportDirectory,
    "D:/Kept",
  );
  assert(
    (await readdir(root)).some((n) => n.startsWith("damaged-preferences-")),
  );
  prefs.setValue("settings", '{"invalid":true}');
  prefs.saveSettings(defaultSettings);
  prefs.close();
  const db = new DatabaseSync(join(root, "preferences.sqlite"), {
    readOnly: true,
  });
  assert.equal(
    (
      db
        .prepare(
          "SELECT value FROM quarantined_preferences WHERE key='settings'",
        )
        .get() as { value: string }
    ).value,
    '{"invalid":true}',
  );
  db.close();
});
