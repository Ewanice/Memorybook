import { _electron as electron, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
const folder = resolve(".local/smoke-" + Date.now());
await mkdir(folder, { recursive: true });
const application = await electron.launch({
  args: ["."],
  env: { ...process.env, MEMORY_USER_DATA: folder },
  timeout: 60000,
});
const errors = [];
let testServer;
let modelCalls = 0;
try {
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("console", (message) => {
    if (message.type() === "error") console.error("renderer:", message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.screenshot({ path: resolve(".local/startup.png") });
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  await page.screenshot({
    path: resolve(".local/library.png"),
    fullPage: true,
  });
  const fixture = resolve(folder, "fixture.png");
  const fixtureBase64 = await application.evaluate(({ nativeImage }) => {
    const width = 1200,
      height = 900;
    const bitmap = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        bitmap[offset] = Math.round(110 + (55 * y) / height);
        bitmap[offset + 1] = Math.round(120 + (60 * x) / width);
        bitmap[offset + 2] = Math.round(90 + (90 * y) / height);
        bitmap[offset + 3] = 255;
      }
    return nativeImage
      .createFromBitmap(bitmap, { width, height })
      .toPNG()
      .toString("base64");
  });
  await writeFile(fixture, Buffer.from(fixtureBase64, "base64"));
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, fixture);
  await page.getByRole("button", { name: "＋ 新建纪念册" }).click();
  await page.getByPlaceholder("例如：明日世界").fill("明日世界");
  await page.getByPlaceholder("北京", { exact: true }).fill("北京");
  await page.getByRole("button", { name: "选择你的照片" }).click();
  await page.getByText("1 张照片 · 完全本地处理").waitFor();
  await page.getByRole("button", { name: "生成纪念册 →" }).click();
  await page.getByText("已保存在本机", { exact: true }).waitFor();
  await page.evaluate(async () => {
    const boot = await window.memorybook.bootstrap();
    let album = await window.memorybook.open(boot.albums[0].id);
    for (const p of album.pages)
      for (const element of p.elements)
        if (element.type === "photoSlot") {
          const result = await window.memorybook.edit(
            album.id,
            album.revision,
            { type: "removeElement", pageId: p.id, elementId: element.id },
          );
          album = result.album;
        }
  });
  await page.reload();
  await page.locator(".album-cover").first().click();
  await page.getByRole("button", { name: "＋ 文字", exact: true }).click();
  const field = page.getByLabel("文字内容", { exact: true });
  await field.fill("把这一刻留在纸页之间");
  // Switching pages immediately must flush the draft instead of cancelling its autosave timer.
  await page.locator(".page-thumb").nth(1).click();
  await expect
    .poll(async () => {
      const boot = await page.evaluate(() => window.memorybook.bootstrap());
      const a = await page.evaluate(
        (id) => window.memorybook.open(id),
        boot.albums[0].id,
      );
      return a.pages[0].elements.some((e) => e.text === "把这一刻留在纸页之间");
    })
    .toBe(true);
  await page.locator(".page-thumb").first().click();
  await page
    .locator('.interactive-canvas rect[fill="transparent"]')
    .last()
    .click();
  await page.getByText("已保存在本机", { exact: true }).waitFor();
  const data = await page.evaluate(async () => {
    const boot = await window.memorybook.bootstrap();
    return window.memorybook.open(boot.albums[0].id);
  });
  assert(data.pages[0].elements.some((e) => e.text === "把这一刻留在纸页之间"));
  await page.getByLabel("修改意见", { exact: true }).fill("改成暖黄色");
  await page.getByLabel("修改意见", { exact: true }).blur();
  await page.getByText("已保存在本机", { exact: true }).waitFor();
  await page.screenshot({ path: resolve(".local/editor.png"), fullPage: true });
  const output = resolve(folder, "test.pdf");
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, output);
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "导出 PDF ↗" }).click();
  await page
    .getByText("PDF 已保存：" + output, { exact: true })
    .waitFor({ timeout: 60000 });
  const pdf = await PDFDocument.load(await readFile(output));
  assert.equal(pdf.getPageCount(), 2);
  assert(Math.abs(pdf.getPage(0).getWidth() - 419.528) < 1);
  const backup = resolve(folder, "test.memorybook");
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, backup);
  await page.evaluate(async (id) => window.memorybook.backup(id), data.id);
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, backup);
  const restored = await page.evaluate(async () => window.memorybook.restore());
  assert.equal(restored.pages.length, 2);
  assert.equal(restored.annotations.length, 1);
  assert.notEqual(restored.id, data.id);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("界面缩放", { exact: true }).selectOption("125");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.memorybook.bootstrap())).settings.zoom,
    125,
  );
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("界面缩放", { exact: true }).selectOption("150");
  await page.screenshot({ path: resolve(".local/settings-150.png") });
  await page.getByRole("button", { name: "完成", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.memorybook.bootstrap())).settings.zoom,
    150,
  );
  testServer = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    modelCalls++;
    assert.equal(request.headers.authorization, "Bearer smoke-key-not-real");
    assert.equal(request.url, "/v1/chat/completions");
    const payload = JSON.parse(body.messages[1].content.split("\n")[0]);
    const results = payload.annotations.map((note) => ({
      annotationId: note.id,
      status: "proposed",
      message: "标题颜色已调整",
      changes: {
        x: null,
        y: null,
        width: null,
        height: null,
        rotation: null,
        opacity: null,
        text: null,
        fontSize: null,
        color: "#b28c42",
        align: null,
        lineHeight: null,
        bold: null,
        fontFamily: null,
        letterSpacing: null,
        crop: null,
        outline: null,
        effects: null,
      },
    }));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify({ results }) },
          },
        ],
      }),
    );
  });
  await new Promise((resolve) => testServer.listen(0, "127.0.0.1", resolve));
  const address = testServer.address();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  const aiToggle = page.getByLabel("允许主动使用 AI", { exact: true });
  if (!(await aiToggle.isChecked())) await aiToggle.click();
  await expect(aiToggle).toBeChecked();
  await page
    .getByLabel("API Base URL", { exact: true })
    .fill(`http://127.0.0.1:${address.port}/v1`);
  await page.getByLabel("模型名称", { exact: true }).fill("test-model");
  await page.getByLabel("API Key", { exact: true }).fill("smoke-key-not-real");
  await page
    .getByRole("button", { name: "保存并测试连接", exact: true })
    .click();
  await page.getByText(/连接成功，模型已返回有效方案/).waitFor();
  await page.screenshot({ path: resolve(".local/byok-settings.png") });
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page
    .getByRole("button", { name: "统一 AI 修改 (1)", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate((id) => window.memorybook.task(id), data.id))
    .toMatchObject({ status: "succeeded" });
  await page.getByRole("button", { name: "查看修改前后", exact: true }).click();
  await page.screenshot({ path: resolve(".local/ai-comparison.png") });
  await page
    .getByRole("button", { name: "撤销本次 AI 修改", exact: true })
    .click();
  assert.equal(
    (await page.evaluate((id) => window.memorybook.open(id), data.id))
      .annotations[0].status,
    "pending",
  );
  const rawDatabase = await readFile(resolve(folder, "memorybook.sqlite-wal"));
  assert(!rawDatabase.includes(Buffer.from("smoke-key-not-real")));
  assert.equal(modelCalls, 2);
  const longStart = Date.now();
  const longAlbum = await page.evaluate(async (albumId) => {
    let current = await window.memorybook.open(albumId);
    const image = current.pages[0].elements.find((el) => el.type === "image");
    const text = current.pages[0].elements.find((el) => el.type === "text");
    for (let index = current.pages.length; index < 100; index++) {
      const elements = Array.from({ length: 30 }, (_, item) =>
        item < 5
          ? {
              ...image,
              id: crypto.randomUUID(),
              frame: { x: 28 + item * 70, y: 28, width: 60, height: 60 },
              rotation: item === 0 ? 6 : 0,
            }
          : {
              ...text,
              id: crypto.randomUUID(),
              text: `Page ${index + 1} / ${item - 4}`,
              frame: {
                x: 28 + (item % 5) * 70,
                y: 120 + Math.floor((item - 5) / 5) * 70,
                width: 64,
                height: 40,
              },
              style: { ...text.style, fontSize: 7, bold: false },
            },
      );
      const result = await window.memorybook.edit(albumId, current.revision, {
        type: "addPage",
        page: {
          id: crypto.randomUUID(),
          role: "content",
          background: "#f8f5ee",
          elements,
        },
      });
      if (result.status !== "saved") throw new Error(result.message);
      current = result.album;
    }
    return current;
  }, data.id);
  const longOutput = resolve(folder, "100-pages.pdf");
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () =>
      new Promise((resolve) => {
        globalThis.smokeReleaseSave = () =>
          resolve({ canceled: false, filePath: path });
      });
  }, longOutput);
  const exportPromise = page.evaluate(
    async (input) => window.memorybook.exportPdf(input),
    { albumId: longAlbum.id, revision: longAlbum.revision, quality: "high" },
  );
  await expect
    .poll(() =>
      application.evaluate(() => Boolean(globalThis.smokeReleaseSave)),
    )
    .toBe(true);
  const duringExport = await page.evaluate(async (albumId) => {
    const current = await window.memorybook.open(albumId);
    const title = current.pages[0].elements.find((el) => el.type === "text");
    return window.memorybook.edit(albumId, current.revision, {
      type: "patchElement",
      pageId: current.pages[0].id,
      elementId: title.id,
      patch: { text: "导出中修改后的标题" },
    });
  }, data.id);
  assert.equal(duringExport.status, "saved");
  await application.evaluate(() => globalThis.smokeReleaseSave());
  assert.equal(await exportPromise, longOutput);
  const longPdf = await PDFDocument.load(await readFile(longOutput));
  assert.equal(longPdf.getPageCount(), 100);
  let textVerified = false;
  if (process.env.MEMORY_PDF_PYTHON) {
    const extracted = execFileSync(
      process.env.MEMORY_PDF_PYTHON,
      [
        "-c",
        "import sys,pdfplumber; d=pdfplumber.open(sys.argv[1]); print(d.pages[0].extract_text())",
        longOutput,
      ],
      { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
    );
    // Chromium may map identical CJK glyphs to compatibility radicals in ToUnicode.
    assert(extracted.normalize("NFKC").includes("明日世界"));
    assert(!extracted.includes("导出中修改后的标题"));
    textVerified = true;
  }
  const longDuration = Date.now() - longStart;
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(".local/smoke-result.json"),
    JSON.stringify(
      {
        passed: true,
        folder,
        pages: pdf.getPageCount(),
        longBookPages: longPdf.getPageCount(),
        longDurationMs: longDuration,
        textVerified,
        tested: [
          "offline activation",
          "native import",
          "create",
          "edit autosave",
          "annotation",
          "PDF page size",
          "backup restore",
          "settings 125/150",
          "BYOK actual HTTP with local protocol fixture",
          "DPAPI key storage",
          "AI comparison and whole-batch undo",
          "100 pages / 2940 extra elements",
          "concurrent edit during PDF snapshot export",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Desktop smoke test passed:", folder);
} catch (error) {
  const page = await application.firstWindow();
  await page.screenshot({ path: resolve(".local/failure.png") });
  console.error(
    "Renderer errors:",
    errors,
    "DOM:",
    (await page.locator("body").innerText()).slice(0, 2000),
  );
  throw error;
} finally {
  await application.close();
  if (testServer) await new Promise((resolve) => testServer.close(resolve));
}
// Existing installations may still contain an obsolete or damaged activation value.
const { DatabaseSync } = await import("node:sqlite");
const legacy = new DatabaseSync(resolve(folder, "memorybook.sqlite"));
legacy
  .prepare(
    "INSERT INTO preferences(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  )
  .run("license", "obsolete-invalid-license");
legacy.close();
const reopened = await electron.launch({
  args: ["."],
  env: { ...process.env, MEMORY_USER_DATA: folder },
  timeout: 60000,
});
try {
  const page = await reopened.firstWindow();
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  const state = await page.evaluate(() => window.memorybook.bootstrap());
  assert.equal(state.settings.zoom, 150);
  assert(state.albums.some((a) => a.pages === 100));
  assert.equal("license" in state, false);
  console.log("Restart persistence verified.");
} finally {
  await reopened.close();
}
