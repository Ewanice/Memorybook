import { stopTestApp } from "./stop-test-app.mjs";
import { packageRoot } from "./release-paths.mjs";
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import {
  mkdir,
  copyFile,
  readFile,
  writeFile,
  rm,
  unlink,
} from "node:fs/promises";
import { join, resolve, dirname, sep } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const base = resolve(".local/shared-settings-" + Date.now());
const shared = join(base, "user-settings");
const instances = [];
async function copyProgram(name) {
  const target = join(base, name);
  const files = JSON.parse(
    await readFile(join(packageRoot, "program-files.json"), "utf8"),
  );
  assert(!files.includes("phrases.txt"), "更新包不能把个人短语作为覆盖目标");
  for (const file of files) {
    await mkdir(dirname(join(target, file)), { recursive: true });
    for (let attempt = 0; ; attempt++) {
      try {
        await copyFile(join(packageRoot, file), join(target, file));
        break;
      } catch (error) {
        if (!["EBUSY", "EPERM"].includes(error.code) || attempt >= 100)
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
  return target;
}
async function launch(root) {
  await unlink(join(root, "data/browser-cache/DevToolsActivePort")).catch(
    (error) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
  const child = spawn(
    join(root, "Memorybook.exe"),
    ["--settings-dir=" + shared, "--remote-debugging-port=0"],
    { windowsHide: true, stdio: "ignore" },
  );
  const instance = { root, child, browser: null };
  instances.push(instance);
  let port;
  for (let i = 0; i < 150; i++) {
    assert.equal(child.exitCode, null, "独立软件副本必须成功启动");
    try {
      port = (
        await readFile(
          join(root, "data/browser-cache/DevToolsActivePort"),
          "utf8",
        )
      ).split("\n")[0];
      break;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(port);
  instance.browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
  for (let i = 0; i < 150; i++) {
    instance.page = instance.browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => page.url().startsWith("memory://app/"));
    if (instance.page) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(instance.page, "软件窗口必须完成加载");
  await instance.page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  return instance;
}
async function stop(instance) {
  await stopTestApp(instance.child, instance.root, instance.browser);
  instance.browser = null;
}
const boot = (p) => p.evaluate(() => window.memorybook.bootstrap());
async function createBook(page, title) {
  await page.getByRole("button", { name: "＋ 新建纪念册" }).click();
  await page.getByPlaceholder("例如：明日世界").fill(title);
  await page.getByRole("button", { name: "生成纪念册 →" }).click();
  await page.getByText("已保存在本机", { exact: true }).waitFor();
}
try {
  const a = await launch(await copyProgram("app-a"));
  const initial = (await boot(a.page)).settings;
  await a.page.evaluate(
    async (settings) =>
      window.memorybook.settings(
        { ...settings, exportDirectory: "D:/SharedExports" },
        settings,
      ),
    initial,
  );
  await createBook(a.page, "A independent book");
  const b = await launch(await copyProgram("app-b"));
  assert.equal(
    (await boot(b.page)).settings.exportDirectory,
    "D:/SharedExports",
  );
  assert.equal(
    (await boot(b.page)).albums.length,
    0,
    "不能把其他副本的工程同步进来",
  );
  await b.page.getByRole("button", { name: "设置", exact: true }).click();
  await b.page.getByRole("button", { name: "文件与导出", exact: true }).click();
  const stale = (await boot(b.page)).settings;
  await a.page.evaluate(async () => {
    const { settings } = await window.memorybook.bootstrap();
    await window.memorybook.settings(
      { ...settings, exportDirectory: "E:/LiveExports" },
      settings,
    );
  });
  await b.page
    .getByText("E:/LiveExports", { exact: true })
    .waitFor({ timeout: 10000 });
  await b.page.evaluate(
    async (old) => window.memorybook.settings({ ...old, guides: false }, old),
    stale,
  );
  assert.equal((await boot(a.page)).settings.guides, false);
  assert.equal((await boot(a.page)).settings.exportDirectory, "E:/LiveExports");
  assert.equal((await boot(a.page)).albums[0].name, "A independent book");
  await b.page.getByRole("button", { name: "完成", exact: true }).click();
  await a.page.evaluate(async () => {
    const current = await window.memorybook.bootstrap();
    await window.memorybook.configureAi(
      current.aiConfig,
      "smoke-only-not-a-real-key",
      current.aiConfig,
    );
  });
  assert.equal((await boot(b.page)).hasAiToken, true);
  await b.page.evaluate(() => window.memorybook.removeAiKey());
  assert.equal((await boot(a.page)).hasAiToken, false);
  // A shared appearance resource must load in a different installation too.
  const png = await readFile("assets/icon.png");
  const id = createHash("sha256").update(png).digest("hex");
  await mkdir(join(shared, "appearance"), { recursive: true });
  await writeFile(join(shared, "appearance", id), png);
  await a.page.evaluate(async (id) => {
    const { settings } = await window.memorybook.bootstrap();
    await window.memorybook.settings(
      { ...settings, homeBackground: id },
      settings,
    );
  }, id);
  assert(
    await b.page.evaluate(
      async (id) =>
        (await fetch("memory://appearance/" + id + "?variant=preview")).ok,
      id,
    ),
  );
  await b.page.evaluate(async () => {
    const doc = await window.memorybook.phraseDocument();
    await window.memorybook.savePhrases(
      "Private phrases stay local\n",
      doc.hash,
    );
  });
  await createBook(b.page, "B preserved during update");
  const bAlbum = (await boot(b.page)).albums[0];
  await stop(a);
  // Delete only this test installation; shared settings are deliberately outside it.
  assert(
    a.root.startsWith(base + sep) && base.startsWith(resolve(".local") + sep),
  );
  await rm(a.root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
  const c = await launch(await copyProgram("app-c"));
  assert.equal((await boot(c.page)).settings.exportDirectory, "E:/LiveExports");
  assert.equal((await boot(c.page)).albums.length, 0);
  assert(
    await c.page.evaluate(
      async (id) =>
        (await fetch("memory://appearance/" + id + "?variant=preview")).ok,
      id,
    ),
  );
  await stop(b);
  // Exactly the update method users use: program files overwrite an existing folder.
  await copyProgram("app-b");
  const updated = await launch(b.root);
  const updatedBoot = await boot(updated.page);
  assert.equal(updatedBoot.albums[0].id, bAlbum.id);
  assert.equal(updatedBoot.albums[0].name, bAlbum.name);
  assert.equal(updatedBoot.settings.exportDirectory, "E:/LiveExports");
  assert.equal(
    await readFile(join(b.root, "phrases.txt"), "utf8"),
    "Private phrases stay local\n",
  );
  await writeFile(
    ".local/shared-settings-verification.json",
    JSON.stringify(
      {
        passed: true,
        twoSimultaneousExecutables: true,
        liveUiRefresh: true,
        independentProjects: true,
        sharedEncryptedKey: true,
        sharedBackground: true,
        reinstallRetainsSettings: true,
        overwriteRetainsProjectsAndPhrases: true,
        archiveSha256: createHash("sha256")
          .update(await readFile(join(packageRoot, "resources/app.asar")))
          .digest("hex"),
      },
      null,
      2,
    ),
  );
  console.log(
    "两个实际 EXE：设置启动继承与实时刷新、独立工程、删除程序后继承设置、覆盖更新保留工程和短语均通过。",
  );
} finally {
  for (const instance of instances)
    if (instance.child.exitCode === null && instance.child.signalCode === null)
      await stop(instance);
}
