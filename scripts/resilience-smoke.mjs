import { _electron as electron, expect } from "@playwright/test";
import {
  mkdir,
  writeFile,
  readFile,
  unlink,
  readdir,
  rename,
} from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const directory = resolve(".local/resilience-smoke-" + Date.now()),
  output = resolve(".local/resilience-output-" + Date.now());
await mkdir(directory, { recursive: true });
await mkdir(output, { recursive: true });
const application = await electron.launch({
  args: ["."],
  env: { ...process.env, MEMORY_USER_DATA: directory },
  timeout: 60000,
});
const errors = [];
let badFont;
const result = { passed: false, directory, checks: [] };
try {
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByPlaceholder("在这里粘贴完整卡密")
    .fill(await readFile(".local/development.license", "utf8"));
  await page.getByRole("button", { name: "验证并开始" }).click();
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  const fixtures = [];
  for (let seed = 0; seed < 6; seed++) {
    const bytes = await application.evaluate(({ nativeImage }, seed) => {
      const width = 1200,
        height = 900,
        b = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const p = (y * width + x) * 4;
          b[p] = (x / 8 + seed * 40) % 255;
          b[p + 1] = (y / 7 + seed * 25) % 255;
          b[p + 2] = 100 + seed * 20;
          b[p + 3] = 255;
        }
      return nativeImage
        .createFromBitmap(b, { width, height })
        .toPNG()
        .toString("base64");
    }, seed);
    const path = join(directory, `fixture-${seed}.png`);
    await writeFile(path, Buffer.from(bytes, "base64"));
    fixtures.push(path);
  }
  await application.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, fixtures);
  const setup = await page.evaluate(async () => {
    const api = window.memorybook,
      assets = (await api.importPhotos()).assets;
    let album = await api.create({
      name: "Resilience test",
      city: "",
      theme: "paper",
      pageSize: "a5",
      assets,
      options: {
        density: "standard",
        coverMode: "photo",
        layout: "random",
        usePhrases: false,
        randomSeed: 42,
      },
    });
    const page = album.pages[1];
    const elements = assets.map((a, i) => ({
      id: crypto.randomUUID(),
      name: a.name,
      type: "image",
      role: "photo",
      assetId: a.id,
      frame: {
        x: 30 + (i % 2) * 170,
        y: 50 + Math.floor(i / 2) * 140,
        width: 150,
        height: 100,
      },
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      fit: "cover",
      crop: { x: 0, y: 0, w: 1, h: 1 },
    }));
    album = (
      await api.edit(album.id, album.revision, {
        type: "replacePage",
        page: { ...page, elements },
      })
    ).album;
    album = (
      await api.edit(album.id, album.revision, {
        type: "addPage",
        page: {
          id: crypto.randomUUID(),
          role: "content",
          background: "#faf5ed",
          elements: [],
        },
      })
    ).album;
    return { id: album.id, target: album.pages.at(-1).id, assets };
  });
  await page.reload();
  await page.locator(".album-cover").first().click();
  await page.locator(".page-thumb").nth(1).click();
  await page.locator(".interactive-canvas").click({ position: { x: 6, y: 6 } });
  await page.keyboard.press("Control+a");
  await expect(page.locator(".selection-tools")).toContainText("已选 6 项");
  await page.keyboard.press("Control+c");
  await page.locator(".page-thumb").last().click();
  await page.keyboard.press("Control+v");
  await expect
    .poll(() =>
      page.evaluate(
        async ({ id, target }) =>
          (await window.memorybook.open(id)).pages.find((p) => p.id === target)
            .elements.length,
        setup,
      ),
    )
    .toBe(6);
  await page.keyboard.press("Control+g");
  await expect
    .poll(() =>
      page.evaluate(async ({ id, target }) => {
        const elements = (await window.memorybook.open(id)).pages.find(
          (p) => p.id === target,
        ).elements;
        return (
          elements.every((e) => e.groupId) &&
          new Set(elements.map((e) => e.groupId)).size === 1
        );
      }, setup),
    )
    .toBe(true);
  await page.keyboard.press("Delete");
  await expect
    .poll(() =>
      page.evaluate(
        async ({ id, target }) =>
          (await window.memorybook.open(id)).pages.find((p) => p.id === target)
            .elements.length,
        setup,
      ),
    )
    .toBe(0);
  await page.keyboard.press("Control+z");
  await expect
    .poll(() =>
      page.evaluate(
        async ({ id, target }) =>
          (await window.memorybook.open(id)).pages.find((p) => p.id === target)
            .elements.length,
        setup,
      ),
    )
    .toBe(6);
  await page.getByLabel("对齐多个元素").selectOption("x:start");
  await expect
    .poll(() =>
      page.evaluate(
        async ({ id, target }) =>
          new Set(
            (await window.memorybook.open(id)).pages
              .find((p) => p.id === target)
              .elements.map((e) => e.frame.x),
          ).size,
        setup,
      ),
    )
    .toBe(1);
  result.checks.push(
    "multi-select, group, cross-page paste, alignment, delete and atomic undo",
  );
  const canvas = page.locator(".interactive-canvas"),
    box = await canvas.boundingBox();
  await canvas.dblclick({
    position: { x: (70 * box.width) / 419.528, y: (90 * box.height) / 595.276 },
  });
  await page.getByRole("dialog", { name: "照片取景" }).waitFor();
  await page.getByLabel("取景缩放").focus();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "应用取景" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        async ({ id, target }) =>
          (await window.memorybook.open(id)).pages
            .find((p) => p.id === target)
            .elements.some((e) => e.crop.w < 1),
        setup,
      ),
    )
    .toBe(true);
  result.checks.push("direct photo cropping");
  const before = await page.evaluate(
    (id) => window.memorybook.open(id),
    setup.id,
  );
  await page.getByRole("button", { name: "＋ 添加页面", exact: true }).click();
  await page.getByLabel("套用到当前页（替换当前元素）").check();
  await page.getByRole("button", { name: "单张主图", exact: true }).click();
  await page.getByRole("dialog", { name: "套用排版预览" }).waitFor();
  assert.equal(
    (await page.evaluate((id) => window.memorybook.open(id), setup.id)).pages
      .length,
    before.pages.length,
  );
  await page.getByRole("button", { name: "确认套用" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        async (id) => (await window.memorybook.open(id)).pages.length,
        setup.id,
      ),
    )
    .toBe(before.pages.length + 5);
  result.checks.push("layout preview and lossless overflow pages");
  await page.evaluate(async (id) => {
    await window.memorybook.deleteAlbum(id);
    await window.memorybook.recover(id, "trash");
  }, setup.id);
  result.checks.push("trash recovery");
  await unlink(join(directory, "assets", setup.assets[0].id));
  await page.reload();
  await page.locator(".album-cover").first().click();
  await expect(page.locator(".interactive-canvas")).toContainText("素材失效");
  await page.getByRole("button", { name: "导出 PDF ↗" }).click();
  await page.getByRole("dialog", { name: "导出检查" }).waitFor();
  await expect(
    page.getByRole("button", { name: "检查后继续导出" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const salvagePath = join(output, "salvage.memorybook");
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, salvagePath);
  await page.evaluate((id) => window.memorybook.backup(id), setup.id);
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, salvagePath);
  const salvage = await page.evaluate(() => window.memorybook.restore());
  assert(salvage);
  assert(salvage.assets.some((a) => a.id === setup.assets[0].id));
  result.checks.push(
    "a missing image still permits recoverable project backup and restore",
  );
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, fixtures[0]);
  await page.evaluate(async () => {
    await window.memorybook.importPhotos();
    window.dispatchEvent(new Event("memorybook-assets-changed"));
  });
  await expect(page.locator(".interactive-canvas")).not.toContainText(
    "素材失效",
  );
  result.checks.push(
    "missing-image placeholder, export block, exact-original repair",
  );
  const cache = join(directory, "previews"),
    savedCache = join(directory, "previews-saved");
  await rename(cache, savedCache);
  await writeFile(cache, "broken cache directory");
  try {
    assert.equal(
      await page.evaluate(
        async (id) =>
          (await fetch(`memory://asset/${id}?variant=preview`)).status,
        setup.assets[0].id,
      ),
      200,
    );
  } finally {
    await unlink(cache);
    await rename(savedCache, cache);
  }
  result.checks.push("unwritable preview cache does not block image rendering");
  const printPath = join(output, "print-range.pdf");
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, printPath);
  await page.evaluate(async (id) => {
    const a = await window.memorybook.open(id);
    await window.memorybook.exportPdf({
      albumId: id,
      revision: a.revision,
      quality: "high",
      fromPage: 2,
      toPage: 3,
      bleedMm: 3,
    });
  }, setup.id);
  const printed = await PDFDocument.load(await readFile(printPath));
  assert.equal(printed.getPageCount(), 2);
  assert(Math.abs(printed.getPage(0).getTrimBox().width - 419.528) < 0.02);
  assert(
    Math.abs(printed.getPage(0).getWidth() - 419.528 - (6 * 72) / 25.4) < 0.02,
  );
  result.checks.push("partial PDF export with physical bleed and trim boxes");
  const cancelPath = join(output, "cancel-preserve.pdf");
  await writeFile(cancelPath, "preserve existing file");
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, cancelPath);
  await page.evaluate(async (id) => {
    const a = await window.memorybook.open(id);
    window.pendingExport = window.memorybook
      .exportPdf({ albumId: id, revision: a.revision, quality: "high" })
      .then(
        () => "completed",
        (e) => e.message,
      );
  }, setup.id);
  await page.waitForFunction(
    async (id) => (await window.memorybook.task(id)).status === "exporting",
    setup.id,
  );
  await page.evaluate((id) => window.memorybook.cancelExport(id), setup.id);
  assert.match(await page.evaluate(() => window.pendingExport), /取消/);
  assert.equal(await readFile(cancelPath, "utf8"), "preserve existing file");
  result.checks.push("cancel export preserves an existing destination file");
  const paths = await page.evaluate(() => window.memorybook.storageInfo()),
    initialFonts = (await page.evaluate(() => window.memorybook.fonts()))
      .length;
  badFont = join(
    paths.fonts,
    createHash("sha256").update(directory).digest("hex"),
  );
  await writeFile(badFont, "invalid font");
  assert.equal(
    (await page.evaluate(() => window.memorybook.bootstrap())).fonts.length,
    initialFonts,
  );
  await unlink(badFont);
  badFont = undefined;
  result.checks.push("corrupt font isolation");
  const bad = await page.evaluate(() =>
    window.memorybook.create({
      name: "damaged fixture",
      city: "",
      theme: "paper",
      pageSize: "a5",
      assets: [],
    }),
  );
  const db = new DatabaseSync(join(directory, "memorybook.sqlite"));
  db.prepare("UPDATE albums SET document=? WHERE id=?").run("{broken", bad.id);
  db.prepare("INSERT OR REPLACE INTO preferences VALUES(?,?)").run(
    "settings",
    "{broken",
  );
  db.close();
  const boot = await page.evaluate(() => window.memorybook.bootstrap());
  assert(boot.albums.some((a) => a.id === setup.id));
  assert(!boot.albums.some((a) => a.id === bad.id));
  assert(
    (await page.evaluate(() => window.memorybook.recovery())).some(
      (i) => i.kind === "damaged",
    ),
  );
  result.checks.push("damaged project and settings do not block bootstrap");
  await page.evaluate(() =>
    window.memorybook.saveLayout({
      id: crypto.randomUUID(),
      name: "Recovery custom layout",
      size: { width: 419.528, height: 595.276 },
      phraseIds: [],
      page: {
        id: crypto.randomUUID(),
        role: "content",
        background: "#ffffff",
        elements: [
          {
            id: crypto.randomUUID(),
            type: "photoSlot",
            role: "photo",
            name: "Photo",
            frame: { x: 30, y: 40, width: 300, height: 400 },
            rotation: 0,
            opacity: 1,
            locked: false,
            visible: true,
          },
        ],
      },
    }),
  );
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, output);
  const backup = await page.evaluate(() => window.memorybook.backupWorkspace());
  assert(backup);
  const count = boot.albums.length;
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, backup);
  const restored = await page.evaluate(() =>
    window.memorybook.restoreWorkspace(),
  );
  assert(restored.includes("已合并恢复"));
  assert.equal(
    (await page.evaluate(() => window.memorybook.bootstrap())).albums.length,
    count * 2,
  );
  assert.equal(
    (await readdir(directory)).filter((n) => n.startsWith("workspace-import-"))
      .length,
    0,
  );
  result.checks.push("full workspace folder backup and merge restore");
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "备份与恢复", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "备份全部资料" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(".local/resilience-storage.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  result.passed = true;
  console.log(
    "Resilience desktop smoke passed:",
    result.checks.length,
    "checks",
  );
} catch (error) {
  result.error = error.stack;
  console.error(error);
  try {
    await (
      await application.firstWindow()
    ).screenshot({
      path: resolve(".local/resilience-failure.png"),
      fullPage: true,
    });
  } catch {}
  process.exitCode = 1;
} finally {
  if (badFont) await unlink(badFont).catch(() => {});
  await writeFile(
    resolve(".local/resilience-result.json"),
    JSON.stringify({ ...result, errors }, null, 2),
  );
  await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await application.close().catch(() => {});
}
