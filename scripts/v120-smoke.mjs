import { _electron as electron, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

const folder = resolve(".local/v120-smoke-" + Date.now());
await mkdir(folder, { recursive: true });
const app = await electron.launch({
  args: ["."],
  env: { ...process.env, MEMORY_USER_DATA: folder },
  timeout: 60000,
});
let phrasePath, phraseOriginal;
const errors = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByPlaceholder("在这里粘贴完整卡密")
    .fill(await readFile(".local/development.license", "utf8"));
  await page.getByRole("button", { name: "验证并开始" }).click();
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  const library = await page.evaluate(() => window.memorybook.resources());
  phrasePath = library.phrasePath;
  phraseOriginal = await readFile(phrasePath);
  await page.getByRole("tab", { name: /短语库/ }).click();
  await page.getByRole("button", { name: "编辑短语库", exact: true }).click();
  const phraseField = page.getByLabel("短语库内容", { exact: true });
  await expect(phraseField).toBeEnabled();
  await phraseField.fill(
    "# 软件内编辑\n把精彩留在这里。\n一起走过的那一天。\n这一页属于我们。",
  );
  await page.getByRole("button", { name: "保存短语库", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.memorybook.resources())).phrases[0],
    )
    .toBe("把精彩留在这里。");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("tab", { name: /排版库/ }).click();
  await page.getByRole("button", { name: "＋ 新建排版", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "排版编辑器", exact: true });
  await editor.getByLabel("排版名称", { exact: true }).fill("演唱会自定义排版");
  await editor
    .getByRole("button", { name: "＋ 贴纸位置", exact: true })
    .click();
  await editor.getByText("更多调整", { exact: true }).click();
  await editor.getByLabel("横向位置 pt", { exact: true }).fill("322");
  await editor.getByLabel("横向位置 pt", { exact: true }).blur();
  await editor.getByLabel("纵向位置 pt", { exact: true }).fill("512");
  await editor.getByLabel("纵向位置 pt", { exact: true }).blur();
  await editor
    .getByRole("button", { name: "＋ 固定文字", exact: true })
    .click();
  const text = editor.getByLabel("文字内容", { exact: true });
  await text.fill("CUSTOM MEMORY");
  await text.blur();
  await editor.getByLabel("纵向位置 pt", { exact: true }).fill("535");
  await editor.getByLabel("纵向位置 pt", { exact: true }).blur();
  await editor.getByLabel("宽度 pt", { exact: true }).fill("240");
  await editor.getByLabel("宽度 pt", { exact: true }).blur();
  await editor.getByLabel("高度 pt", { exact: true }).fill("45");
  await editor.getByLabel("高度 pt", { exact: true }).blur();
  await page.screenshot({ path: resolve(".local/template-editor-v120.png") });
  await editor.getByRole("button", { name: "保存排版", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const custom = await page.evaluate(() => window.memorybook.resources());
  assert.equal(custom.layouts.length, 1);
  assert(
    custom.layouts[0].page.elements.some((e) => e.text === "CUSTOM MEMORY"),
  );
  const fixture = resolve(folder, "照片样例.png");
  const image = await app.evaluate(({ nativeImage }) => {
    const width = 900,
      height = 1200,
      bitmap = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        bitmap[i] = Math.round(100 + y / 15);
        bitmap[i + 1] = Math.round(130 + x / 12);
        bitmap[i + 2] = 140;
        bitmap[i + 3] = 255;
      }
    return nativeImage
      .createFromBitmap(bitmap, { width, height })
      .toPNG()
      .toString("base64");
  });
  await writeFile(fixture, Buffer.from(image, "base64"));
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, fixture);
  const imported = await page.evaluate(() => window.memorybook.importPhotos());
  const options = {
    density: "standard",
    coverMode: "photo",
    layout: "random",
    usePhrases: true,
    randomSeed: 42,
    pagination: { enabled: true, position: "bottom-right", start: 7 },
    generator: "local",
  };
  const album = await page.evaluate(
    ({ asset, options }) =>
      window.memorybook.create({
        name: "随机排版与页码",
        city: "北京",
        theme: "paper",
        pageSize: "a5",
        assets: Array.from({ length: 80 }, () => asset),
        options,
      }),
    { asset: imported.assets[0], options },
  );
  assert.equal(
    album.pages
      .flatMap((p) => p.elements)
      .filter((e) => e.type === "image" && e.role === "photo").length,
    80,
  );
  assert(
    album.pages
      .flatMap((p) => p.elements)
      .some((e) => e.text === "CUSTOM MEMORY"),
  );
  await page.reload();
  await page
    .locator(".album-card")
    .filter({ hasText: "随机排版与页码" })
    .locator(".album-cover")
    .click();
  await page.getByRole("button", { name: "页码", exact: true }).click();
  await page.getByLabel("页码位置", { exact: true }).selectOption("top-right");
  await page
    .getByRole("dialog", { name: "页码设置" })
    .getByRole("button", { name: "完成", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await page.evaluate((id) => window.memorybook.open(id), album.id))
          .pagination.position,
    )
    .toBe("top-right");
  const pdfPath = resolve(folder, "随机与页码.pdf");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, pdfPath);
  const latest = await page.evaluate(
    (id) => window.memorybook.open(id),
    album.id,
  );
  await page.evaluate(
    (a) =>
      window.memorybook.exportPdf({
        albumId: a.id,
        revision: a.revision,
        quality: "share",
      }),
    latest,
  );
  assert.equal(
    (await PDFDocument.load(await readFile(pdfPath))).getPageCount(),
    latest.pages.length,
  );
  console.log(
    "Phrase editor, template editor, random generation and pagination passed.",
  );
  const status = await page.evaluate(() => window.memorybook.codexStatus());
  assert(status.connected && status.ready, status.message);
  console.log(
    "Actual local Codex handshake passed; skills:",
    status.skills.length,
  );
  const codexResults = [];
  if (process.env.MEMORY_CODEX_GENERATE === "1") {
    for (const mode of ["templates", "creative"]) {
      const preferences = await page.evaluate(() =>
        window.memorybook.codexPreferences(),
      );
      if (mode === "creative") {
        preferences.prompt +=
          "\n这次验收请使用 custom 自由版面，一张内页照片配一句提供的短语，使用平直边框，文字与照片不重叠。";
        const skill = status.skills.find((s) => s.name === "canvas-design");
        if (skill) preferences.skillPaths = [skill.path];
        await page.evaluate(
          (p) => window.memorybook.saveCodexPreferences(p),
          preferences,
        );
      }
      const progress = setInterval(() => {
        void page
          .evaluate(() => window.memorybook.generationState())
          .then((s) => console.log("Codex:", mode, s.message));
      }, 20000);
      try {
        const result = await page.evaluate(
          ({ asset, mode, options }) =>
            window.memorybook.create({
              name: "Codex 生成验收 " + mode,
              city: "北京",
              theme: "paper",
              pageSize: "a5",
              assets: [asset, asset],
              options: { ...options, generator: "codex", codexMode: mode },
            }),
          { asset: imported.assets[0], mode, options },
        );
        assert.equal(
          result.pages
            .flatMap((p) => p.elements)
            .filter((e) => e.type === "image" && e.role === "photo").length,
          2,
        );
        assert(
          result.pages[1].elements.some((e) => e.type === "text" && e.text),
        );
        codexResults.push({
          mode,
          albumId: result.id,
          pages: result.pages.length,
          skill: preferences.skillPaths.length,
        });
        console.log(
          "Actual Codex generation passed:",
          mode,
          result.pages.length,
        );
      } finally {
        clearInterval(progress);
      }
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    ".local/v120-result.json",
    JSON.stringify(
      {
        passed: true,
        folder,
        pages: album.pages.length,
        customLayout: true,
        editablePhrases: true,
        pagination: true,
        actualCodexConnected: true,
        codexResults,
        errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({ path: resolve(".local/v120-failure.png") });
  console.error(
    "DOM:",
    (await page.locator("body").innerText()).slice(-2500),
    "errors:",
    errors,
  );
  throw error;
} finally {
  if (phrasePath && phraseOriginal) await writeFile(phrasePath, phraseOriginal);
  await app.close();
}
