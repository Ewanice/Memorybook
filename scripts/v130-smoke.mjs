import { _electron as electron, expect } from "@playwright/test";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  stat,
  open,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
const folder = resolve(`.local/v130-smoke-${Date.now()}`);
await mkdir(folder, { recursive: true });
const app = await electron.launch({
  args: ["."],
  env: { ...process.env, MEMORY_USER_DATA: folder },
  timeout: 60000,
});
const errors = [];
app.process().stderr.on("data", (b) => process.stderr.write(b));
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.error(m.text());
  });
  await page
    .getByPlaceholder("在这里粘贴完整卡密")
    .fill(await readFile(".local/development.license", "utf8"));
  await page.getByRole("button", { name: "验证并开始" }).click();
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  await expect(page.locator(".codex-badge")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "贴纸 · 短语 · 排版 ↓" }),
  ).toBeVisible();
  await expect(page.locator(".codex-badge")).not.toContainText("检测中", {
    timeout: 30000,
  });
  await page.screenshot({ path: resolve(".local/home-v130.png") });
  const paths = await app.evaluate(({ app }) => ({
    data: app.getPath("userData"),
    session: app.getPath("sessionData"),
  }));
  assert.equal(resolve(paths.data), folder);
  assert(paths.session.startsWith(folder));
  const fixture = join(folder, "photo.png"),
    transparent = join(folder, "sticker.png");
  const images = await app.evaluate(({ nativeImage }) => {
    const width = 1800,
      height = 1400,
      b = Buffer.alloc(width * height * 4);
    let seed = 9;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const n = (seed >>> 24) % 20;
        b[i] = Math.min(255, 95 + y / 16 + n);
        b[i + 1] = Math.min(255, 100 + x / 20 + n);
        b[i + 2] = 130 + n;
        b[i + 3] = 255;
      }
    const photo = nativeImage.createFromBitmap(b, { width, height }).toPNG();
    const t = Buffer.alloc(200 * 200 * 4);
    for (let y = 30; y < 170; y++)
      for (let x = 30; x < 170; x++) {
        const i = (y * 200 + x) * 4;
        t[i] = 110;
        t[i + 1] = 180;
        t[i + 2] = 170;
        t[i + 3] = 180;
      }
    return {
      photo: photo.toString("base64"),
      sticker: nativeImage
        .createFromBitmap(t, { width: 200, height: 200 })
        .toPNG()
        .toString("base64"),
    };
  });
  await writeFile(fixture, Buffer.from(images.photo, "base64"));
  await writeFile(transparent, Buffer.from(images.sticker, "base64"));
  const choose = (path) =>
    app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, path);
  await choose(fixture);
  const imported = await page.evaluate(() => window.memorybook.importPhotos());
  assert.equal(imported.assets.length, 1);
  await choose(transparent);
  const stickers = await page.evaluate(() =>
    window.memorybook.importStickers(),
  );
  assert.equal(stickers.assets.length, 1);
  for (const a of [...imported.assets, ...stickers.assets])
    assert((await stat(join(folder, "assets", a.id))).size === a.bytes);
  const response = await page.evaluate(
    async (ids) =>
      Promise.all(
        ids.map(async (id) => {
          const r = await fetch(`memory://asset/${id}?variant=preview`);
          return {
            type: r.headers.get("content-type"),
            bytes: (await r.arrayBuffer()).byteLength,
          };
        }),
      ),
    [imported.assets[0].id, stickers.assets[0].id],
  );
  assert.equal(response[0].type, "image/jpeg");
  assert.equal(response[1].type, "image/png");
  assert(response[0].bytes < imported.assets[0].bytes / 3);
  const transparentPixel = await app.evaluate(
    ({ nativeImage }, path) => nativeImage.createFromPath(path).toBitmap()[3],
    join(folder, "previews", stickers.assets[0].id + "-preview-v2.png"),
  );
  assert.equal(transparentPixel, 0);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "字体库", exact: true }).click();
  await choose("C:/Windows/Fonts/arial.ttf");
  await page.getByRole("button", { name: "＋ 导入字体", exact: true }).click();
  await expect(
    page.locator(".font-card").filter({ hasText: "Arial" }).first(),
  ).toBeVisible();
  const fonts = await page.evaluate(() => window.memorybook.fonts());
  const font = fonts.find((f) => f.name === "Arial");
  assert(font);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  let album = await page.evaluate(
    async ({ assets, stickerIds, font }) => {
      const api = window.memorybook;
      let a = await api.create({
        name: "背景字体验收",
        city: "北京",
        theme: "paper",
        pageSize: "a5",
        assets,
        stickerIds,
        options: {
          density: "standard",
          coverMode: "photo",
          layout: "random",
          usePhrases: true,
          randomSeed: 7,
        },
      });
      const styles = [
        "fiber",
        "rice",
        "kraft",
        "linen",
        "grid",
        "dots",
        "wash",
      ];
      for (let i = 0; i < styles.length; i++) {
        const p = {
          id: crypto.randomUUID(),
          role: "content",
          background: i === 2 ? "#d7b991" : "#f4f0e6",
          backgroundStyle: styles[i],
          elements: [
            {
              id: crypto.randomUUID(),
              type: "text",
              name: "字体预览",
              text: `Memory / 2026 — ${styles[i]}`,
              frame: { x: 36, y: 50, width: 350, height: 60 },
              rotation: 0,
              opacity: 1,
              visible: true,
              locked: false,
              style: {
                fontSize: 20,
                color: "#364638",
                align: "left",
                lineHeight: 1.4,
                bold: false,
                fontFamily: font.family,
              },
            },
          ],
        };
        const r = await api.edit(a.id, a.revision, {
          type: "addPage",
          page: p,
        });
        if (r.status !== "saved") throw Error(r.message);
        a = r.album;
      }
      // Empty placeholders must be removed before PDF export.
      for (const p of [...a.pages])
        for (const e of p.elements.filter((e) => e.type === "photoSlot")) {
          const r = await api.edit(a.id, a.revision, {
            type: "removeElement",
            pageId: p.id,
            elementId: e.id,
          });
          if (r.status !== "saved") throw Error(r.message);
          a = r.album;
        }
      return a;
    },
    {
      assets: imported.assets,
      stickerIds: stickers.assets.map((s) => s.id),
      font,
    },
  );
  await page.reload();
  await page.locator(".album-cover").first().click();
  await page.getByText("已保存在本机", { exact: true }).waitFor();
  await page.locator(".page-thumb").nth(2).click();
  const text = album.pages[2].elements[0];
  await page.locator(".layers summary").filter({ hasText: /图层/ }).click();

  // Select using the layer list, then verify shortcuts against persisted data.
  const layer = page.getByRole("button", { name: /字体预览/ }).first();
  await layer.click();
  await page.keyboard.press("Control+d");
  await expect
    .poll(async () => {
      const a = await page.evaluate(
        (id) => window.memorybook.open(id),
        album.id,
      );
      return a.pages[2].elements.length;
    })
    .toBe(2);
  await page.keyboard.press("Delete");
  await expect
    .poll(async () => {
      const a = await page.evaluate(
        (id) => window.memorybook.open(id),
        album.id,
      );
      return a.pages[2].elements.length;
    })
    .toBe(1);
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => {
      const a = await page.evaluate(
        (id) => window.memorybook.open(id),
        album.id,
      );
      return a.pages[2].elements.length;
    })
    .toBe(2);
  await page.keyboard.press("Control+y");
  await expect
    .poll(async () => {
      const a = await page.evaluate(
        (id) => window.memorybook.open(id),
        album.id,
      );
      return a.pages[2].elements.length;
    })
    .toBe(1);
  await page.locator(".background-picker summary").click();
  await page.getByRole("button", { name: "暖调牛皮纸", exact: true }).click();
  await expect
    .poll(async () => {
      const a = await page.evaluate(
        (id) => window.memorybook.open(id),
        album.id,
      );
      return a.pages[2].backgroundStyle;
    })
    .toBe("kraft");
  await page.screenshot({ path: resolve(".local/background-editor-v130.png") });
  await page.getByRole("button", { name: "棉纸", exact: true }).click();
  await expect
    .poll(async () => {
      const a = await page.evaluate(
        (id) => window.memorybook.open(id),
        album.id,
      );
      return a.pages[2].backgroundStyle;
    })
    .toBe("fiber");
  const pdfPath = join(folder, "背景字体.pdf"),
    backupPath = join(folder, "字体工程.memorybook");
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, pdfPath);
  album = await page.evaluate((id) => window.memorybook.open(id), album.id);
  await page.evaluate(
    (a) =>
      window.memorybook.exportPdf({
        albumId: a.id,
        revision: a.revision,
        quality: "high",
      }),
    album,
  );
  const pdf = await PDFDocument.load(await readFile(pdfPath));
  assert.equal(pdf.getPageCount(), album.pages.length);
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, backupPath);
  await page.evaluate((id) => window.memorybook.backup(id), album.id);
  const files = unzipSync(await readFile(backupPath));
  assert(files[`fonts/${font.id}`]);
  await choose(backupPath);
  const restored = await page.evaluate(() => window.memorybook.restore());
  assert(restored);
  assert.equal(restored.pages[2].elements[0].style.fontFamily, font.family);
  const before = await page.evaluate(() => window.memorybook.cacheInfo());
  assert(before.files >= 2);
  await page.evaluate(() => window.memorybook.clearCache());
  const after = await page.evaluate(() => window.memorybook.cacheInfo());
  assert.equal(after.bytes, 0);
  // A sparse stand-in for old cached data tests disk eviction without allocating 256 MB of RAM.
  const old = join(folder, "previews", `${"a".repeat(64)}-preview-v2.png`);
  const cacheFile = await open(old, "w");
  await cacheFile.truncate(257 * 1024 * 1024);
  await cacheFile.close();
  await page.evaluate(async (id) => {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = `memory://asset/${id}?variant=preview&eviction=1`;
    });
  }, imported.assets[0].id);
  assert(
    (await page.evaluate(() => window.memorybook.cacheInfo())).bytes <
      256 * 1024 * 1024,
  );
  await stat(join(folder, "assets", imported.assets[0].id));
  await page.getByRole("button", { name: "‹ 我的纪念册", exact: true }).click();
  await page.getByRole("tab", { name: /排版库/ }).click();
  await page.getByRole("button", { name: "＋ 新建排版", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "排版编辑器", exact: true });
  await editor
    .getByRole("button", { name: "＋ 固定文字", exact: true })
    .click();
  const layers = editor.locator(".template-palette > button"),
    count = await layers.count();
  await page.keyboard.press("Control+d");
  await expect(layers).toHaveCount(count + 1);
  await page.keyboard.press("Delete");
  await expect(layers).toHaveCount(count);
  await page.keyboard.press("Control+z");
  await expect(layers).toHaveCount(count + 1);
  await page.keyboard.press("Control+y");
  await expect(layers).toHaveCount(count);
  page.once("dialog", (dialog) => dialog.accept());
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(editor).toHaveCount(0);
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    folder,
    storage: paths,
    photoOriginal: imported.assets[0].bytes,
    photoPreview: response[0].bytes,
    reductionPercent: Math.round(
      (1 - response[0].bytes / imported.assets[0].bytes) * 100,
    ),
    transparentPreserved: true,
    font: font.name,
    pdfPath,
    pdfPages: pdf.getPageCount(),
    backupFontEmbedded: true,
    mainAndTemplateShortcuts: true,
    cacheEvictionVerified: true,
    before,
    after,
  };
  await writeFile(".local/v130-result.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app.close();
}
