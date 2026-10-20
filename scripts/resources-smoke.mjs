import { _electron as electron } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import assert from "node:assert/strict";

const folder = resolve(".local/resources-smoke-" + Date.now());
await mkdir(folder, { recursive: true });
const app = await electron.launch({
  args: ["."],
  env: { ...process.env, MEMORY_USER_DATA: folder },
  timeout: 60000,
});
let originalPhrases, phrasePath;
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByPlaceholder("在这里粘贴完整卡密")
    .fill(await readFile(".local/development.license", "utf8"));
  await page.getByRole("button", { name: "验证并开始" }).click();
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  let resources = await page.evaluate(() => window.memorybook.resources());
  assert(!resources.phraseError && resources.phrases.length > 0);
  phrasePath = resources.phrasePath;
  originalPhrases = await readFile(phrasePath);
  const fixture = resolve(folder, "原创透明圆点.png");
  const data = await app.evaluate(({ nativeImage }) => {
    const width = 600,
      height = 450,
      bitmap = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const circle = (x - 300) ** 2 + (y - 225) ** 2 < 190 ** 2;
        bitmap[offset] = Math.round(80 + x / 5);
        bitmap[offset + 1] = Math.round(110 + y / 6);
        bitmap[offset + 2] = 210;
        bitmap[offset + 3] = circle ? 255 : 0;
      }
    return nativeImage
      .createFromBitmap(bitmap, { width, height })
      .toPNG()
      .toString("base64");
  });
  await writeFile(fixture, Buffer.from(data, "base64"));
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, fixture);
  await page.getByRole("button", { name: "＋ 上传贴纸" }).click();
  await page
    .getByRole("tabpanel", { name: "贴纸库", exact: true })
    .getByText("原创透明圆点.png", { exact: true })
    .waitFor();
  resources = await page.evaluate(() => window.memorybook.resources());
  assert.equal(resources.stickers.length, 1);
  await page.getByRole("tab", { name: /短语库/ }).click();
  await writeFile(
    phrasePath,
    "# 测试独立短语\r\n把这一刻，留在纸页之间。\r\n我们把晚风带回了家。\r\n" +
      "长句排版需要认真留白".repeat(7),
  );
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await page
    .locator(".phrase-shelf p")
    .filter({ hasText: "我们把晚风带回了家。" })
    .waitFor();
  await page.screenshot({
    path: resolve(".local/phrase-library.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "＋ 新建纪念册" }).click();
  await page.getByPlaceholder("例如：明日世界").fill("新建贴纸测试");
  await page.getByRole("button", { name: /原创透明圆点.png.*选择/ }).click();
  await page.screenshot({
    path: resolve(".local/composition-wizard.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "生成纪念册 →" }).click();
  await page.getByText("已保存在本机", { exact: true }).waitFor();
  const created = await page.evaluate(async () => {
    const b = await window.memorybook.bootstrap();
    return window.memorybook.open(b.albums[0].id);
  });
  assert(
    created.pages[1].elements.some(
      (e) => e.type === "photoSlot" && e.role !== "sticker",
    ),
  );
  assert(
    created.pages[1].elements.some(
      (e) => e.type === "image" && e.role === "sticker",
    ),
  );
  assert(
    created.pages[1].elements.some(
      (e) => e.text === "把这一刻，留在纸页之间。",
    ),
  );
  const composed = await page.evaluate(async (stickerId) => {
    const imported = await window.memorybook.importPhotos();
    return window.memorybook.create({
      name: "四套排版验收",
      city: "北京",
      theme: "paper",
      pageSize: "a5",
      assets: Array.from({ length: 9 }, () => imported.assets[0]),
      stickerIds: [stickerId],
      options: {
        density: "standard",
        coverMode: "photo",
        layout: "collection",
        usePhrases: true,
      },
    });
  }, resources.stickers[0].id);
  assert.equal(composed.pages.length, 5);
  assert(
    !composed.pages
      .flatMap((p) => p.elements)
      .some((e) => e.type === "photoSlot"),
  );
  const pdfPath = resolve(folder, "四套排版.pdf");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, pdfPath);
  assert.equal(
    await page.evaluate(
      (album) =>
        window.memorybook.exportPdf({
          albumId: album.id,
          revision: album.revision,
          quality: "high",
        }),
      composed,
    ),
    pdfPath,
  );
  assert.equal(
    (await PDFDocument.load(await readFile(pdfPath))).getPageCount(),
    5,
  );
  const backupPath = resolve(folder, "贴纸工程.memorybook");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, backupPath);
  assert.equal(
    await page.evaluate((id) => window.memorybook.backup(id), composed.id),
    backupPath,
  );
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, backupPath);
  const restored = await page.evaluate(() => window.memorybook.restore());
  assert(restored && restored.id !== composed.id);
  assert.deepEqual(restored.pages, composed.pages);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, fixture);
  await writeFile(phrasePath, "# 用户已更新\n这是新的内容");
  const afterFileEdit = await page.evaluate(
    (id) => window.memorybook.open(id),
    composed.id,
  );
  assert.deepEqual(afterFileEdit, composed, "外部短语修改不能影响已生成文字");
  await writeFile(phrasePath, Buffer.from([0xff, 0xfe]));
  const invalid = await page.evaluate(() => window.memorybook.resources());
  assert.match(invalid.phraseError, /UTF-8/);
  assert.equal(invalid.stickers.length, 1, "短语错误不能阻止贴纸库使用");
  await writeFile(phrasePath, originalPhrases);
  const previewAlbum = await page.evaluate(async (stickerId) => {
    const imported = await window.memorybook.importPhotos();
    return window.memorybook.create({
      name: "模板空位预览",
      city: "",
      theme: "paper",
      pageSize: "a5",
      assets: Array.from({ length: 9 }, () => imported.assets[0]),
      stickerIds: [stickerId],
      options: {
        density: "standard",
        coverMode: "photo",
        layout: "collection",
        usePhrases: true,
      },
    });
  }, resources.stickers[0].id);
  previewAlbum.pages.forEach((p) => {
    p.elements = p.elements.map((el) =>
      el.type === "image" && el.role === "photo"
        ? {
            id: el.id,
            name: "照片位置",
            type: "photoSlot",
            role: "photo",
            frame: el.frame,
            rotation: el.rotation,
            opacity: el.opacity,
            locked: el.locked,
            visible: el.visible,
          }
        : el,
    );
  });
  const svgs = await app.evaluate(
    async ({ BrowserWindow }, { album, check }) => {
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      try {
        await window.loadURL("memory://app/export.html");
        const overflow = await window.webContents.executeJavaScript(
          `window.memorybookExport.preflight(${JSON.stringify({ ...check, pages: [] })},${JSON.stringify(check)})`,
        );
        if (overflow) throw new Error("Composition text overflow");
        return await window.webContents.executeJavaScript(
          `window.memorybookExport.render(${JSON.stringify(album)},"high")`,
        );
      } finally {
        window.destroy();
      }
    },
    { album: previewAlbum, check: composed },
  );
  await page.setViewportSize({ width: 1320, height: 620 });
  await page.evaluate(async (svgs) => {
    document.body.innerHTML = "";
    const style = document.createElement("style");
    style.textContent =
      'body{margin:0;background:#e9ede2;color:#33443b;padding:35px;font-family:"Noto Sans SC"}h1{font-size:22px;font-weight:500;margin:0 0 8px}p{font-size:12px;margin:0 0 24px;color:#6d7964}main{display:grid;grid-template-columns:repeat(4,1fr);gap:24px}section{min-width:0}section>svg{width:100%;height:auto;box-shadow:0 6px 18px #24351c18}h2{font-size:15px;margin:15px 0 5px}';
    document.head.append(style);
    const h1 = document.createElement("h1");
    h1.textContent = "拾页 · 四种叙事的节奏";
    document.body.append(h1);
    const p = document.createElement("p");
    p.textContent = "固定构图 / 照片、短语与贴纸 / 所有元素均可继续编辑";
    document.body.append(p);
    const main = document.createElement("main");
    document.body.append(main);
    ["留白独白", "双帧对话", "现场手记", "拼贴来信"].forEach((name, i) => {
      const section = document.createElement("section");
      section.innerHTML = svgs[i + 1];
      const h2 = document.createElement("h2");
      h2.textContent = name;
      section.append(h2);
      main.append(section);
    });
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode()));
  }, svgs);
  await page.screenshot({
    path: resolve("docs/四套排版预览.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(folder, "result.json"),
    JSON.stringify(
      {
        passed: true,
        albumId: composed.id,
        pdfPath,
        pages: 5,
        phraseReload: true,
        invalidEncodingReported: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Composition and resource integration passed:", folder);
} finally {
  if (originalPhrases && phrasePath)
    await writeFile(phrasePath, originalPhrases);
  await app.close();
}
const reopened = await electron.launch({
  args: ["."],
  env: { ...process.env, MEMORY_USER_DATA: folder },
  timeout: 60000,
});
try {
  const page = await reopened.firstWindow();
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  const resources = await page.evaluate(() => window.memorybook.resources());
  assert.equal(resources.stickers.length, 1);
  await page.evaluate(
    (id) => window.memorybook.removeSticker(id),
    resources.stickers[0].id,
  );
  const persisted = await page.evaluate(async () => {
    const boot = await window.memorybook.bootstrap();
    return window.memorybook.open(
      boot.albums.find((a) => a.name === "四套排版验收").id,
    );
  });
  assert(persisted.assets.some((a) => a.id === resources.stickers[0].id));
  assert(
    persisted.pages.some((p) =>
      p.elements.some((e) => e.type === "image" && e.role === "sticker"),
    ),
  );
  console.log("Sticker persistence and removal isolation verified.");
} finally {
  await reopened.close();
}
