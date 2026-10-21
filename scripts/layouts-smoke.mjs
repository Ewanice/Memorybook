import { _electron as electron, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
const folder = resolve(`.local/layouts-smoke-${Date.now()}`);
await mkdir(folder, { recursive: true });
const app = await electron.launch({
  args: ["."],
  env: { ...process.env, MEMORY_USER_DATA: folder },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  const images = await page.evaluate(() => {
    const values = [];
    for (let n = 0; n < 6; n++) {
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 1100;
      const c = canvas.getContext("2d");
      const colors = [
        ["#cbd9d1", "#6b8877", "#263d36"],
        ["#eed7c4", "#b78b72", "#594e46"],
        ["#d1dbe2", "#7e96a9", "#344d63"],
        ["#ddd2ce", "#b58b87", "#674d56"],
        ["#d7dbca", "#9ba986", "#4c6153"],
        ["#eadac3", "#c6a874", "#6e6650"],
      ][n];
      const g = c.createLinearGradient(0, 0, 0, 1100);
      g.addColorStop(0, colors[0]);
      g.addColorStop(1, colors[1]);
      c.fillStyle = g;
      c.fillRect(0, 0, 900, 1100);
      c.fillStyle = "#fff7dc";
      c.beginPath();
      c.arc(620 - n * 25, 270 + n * 18, 90, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = colors[1];
      c.beginPath();
      c.moveTo(0, 690);
      c.lineTo(260, 380 + n * 35);
      c.lineTo(590, 760);
      c.lineTo(900, 520);
      c.lineTo(900, 1100);
      c.lineTo(0, 1100);
      c.closePath();
      c.fill();
      c.fillStyle = colors[2];
      c.beginPath();
      c.moveTo(0, 900);
      c.quadraticCurveTo(440, 600, 900, 880);
      c.lineTo(900, 1100);
      c.lineTo(0, 1100);
      c.closePath();
      c.fill();
      values.push(canvas.toDataURL("image/png").split(",")[1]);
    }
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 240;
    const c = canvas.getContext("2d");
    c.fillStyle = "#b17752";
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2,
        r = i % 2 ? 45 : 100;
      c.lineTo(120 + Math.cos(a) * r, 120 + Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
    return {
      photos: values,
      sticker: canvas.toDataURL("image/png").split(",")[1],
    };
  });
  const paths = [];
  for (const [n, data] of images.photos.entries()) {
    const path = join(folder, `photo-${n}.png`);
    await writeFile(path, Buffer.from(data, "base64"));
    paths.push(path);
  }
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, paths);
  const imported = await page.evaluate(() => window.memorybook.importPhotos());
  const stickerPath = join(folder, "sticker.png");
  await writeFile(stickerPath, Buffer.from(images.sticker, "base64"));
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, stickerPath);
  const stickers = await page.evaluate(() =>
    window.memorybook.importStickers(),
  );
  const books = [];
  for (const theme of ["paper", "live"]) {
    const book = await page.evaluate(
      ({ theme, assets, stickerId }) =>
        window.memorybook.create({
          name: `Layout study ${theme}`,
          city: "北京",
          theme,
          pageSize: "a5",
          assets: Array.from(
            { length: 28 },
            (_, i) => assets[i % assets.length],
          ),
          stickerIds: [stickerId],
          options: {
            density: "standard",
            coverMode: "photo",
            layout: "random",
            randomSeed: 41,
            usePhrases: true,
          },
        }),
      { theme, assets: imported.assets, stickerId: stickers.assets[0].id },
    );
    assert.equal(book.pages.length, 12);
    assert(new Set(book.pages.map((p) => p.backgroundStyle)).size >= 6);
    const svg = await app.evaluate(async ({ BrowserWindow }, book) => {
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
          `window.memorybookExport.preflight(${JSON.stringify({ ...book, pages: [] })},${JSON.stringify(book)})`,
        );
        if (overflow) throw Error("Template typography overflow");
        return await window.webContents.executeJavaScript(
          `window.memorybookExport.render(${JSON.stringify(book)},"high")`,
        );
      } finally {
        window.destroy();
      }
    }, book);
    books.push({ theme, book, svg });
    const pdfPath = join(folder, `layouts-${theme}.pdf`);
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, pdfPath);
    await page.evaluate(
      (a) =>
        window.memorybook.exportPdf({
          albumId: a.id,
          revision: a.revision,
          quality: "high",
        }),
      book,
    );
    assert.equal(
      (await PDFDocument.load(await readFile(pdfPath))).getPageCount(),
      12,
    );
  }
  await page.reload();
  await page
    .locator(".album-card")
    .filter({ hasText: "Layout study live" })
    .locator(".album-cover")
    .click();
  await page.locator(".background-picker summary").click();
  await expect(page.getByLabel("同步搭配文字颜色")).toBeChecked();
  const book = books[1].book;
  await page.getByRole("button", { name: "棉纸", exact: true }).click();
  await expect
    .poll(async () => {
      const a = await page.evaluate(
        (id) => window.memorybook.open(id),
        book.id,
      );
      const text = a.pages[0].elements.find((e) => e.type === "text");
      return text.style.color;
    })
    .not.toBe(
      book.pages[0].elements.find((e) => e.type === "text").style.color,
    );
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect
    .poll(async () => {
      const a = await page.evaluate(
        (id) => window.memorybook.open(id),
        book.id,
      );
      return a.pages[0].background;
    })
    .toBe(book.pages[0].background);
  // Material changes must never overwrite an existing saved design unless the user applies them.
  assert.deepEqual(
    (await page.evaluate((id) => window.memorybook.open(id), books[0].book.id))
      .pages,
    books[0].book.pages,
  );
  await page.setViewportSize({ width: 1540, height: 1850 });
  for (const { theme, svg } of books) {
    await page.evaluate(
      async ({ theme, svg }) => {
        document.body.innerHTML = "";
        const style = document.createElement("style");
        style.textContent = `body{margin:0;padding:48px;background:${theme === "live" ? "#181f20" : "#edece7"};color:${theme === "live" ? "#d5ddd2" : "#465548"};font-family:'Noto Sans SC'}h1{font-family:'Noto Serif SC';font-size:26px;font-weight:400;margin:0 0 12px}.note{font-size:12px;opacity:.7;margin-bottom:30px}.sheet{display:grid;grid-template-columns:repeat(4,1fr);gap:28px}figure{margin:0}figure>svg{width:100%;height:auto;display:block;box-shadow:0 6px 16px #00000012}figcaption{font-size:11px;margin:9px 0 0;letter-spacing:.03em}`;
        document.head.append(style);
        const title = document.createElement("h1");
        title.textContent =
          theme === "live" ? "夜色、纸张与回忆" : "让纸张成为故事的一部分";
        document.body.append(title);
        const note = document.createElement("div");
        note.className = "note";
        note.textContent =
          "11 compositions · editable photos, stickers & phrases · 原创色块示意素材";
        document.body.append(note);
        const main = document.createElement("div");
        main.className = "sheet";
        document.body.append(main);
        for (const [n, s] of svg.slice(1).entries()) {
          const fig = document.createElement("figure");
          fig.innerHTML =
            s +
            `<figcaption>${String(n + 1).padStart(2, "0")} / ${theme === "live" ? "深色纸张" : "浅色纸张"}</figcaption>`;
          main.append(fig);
        }
        await document.fonts.ready;
        await Promise.all(
          [...document.querySelectorAll("image")].map(
            (el) =>
              new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = resolve;
                image.onerror = reject;
                image.src = el.getAttribute("href");
              }),
          ),
        );
      },
      { theme, svg },
    );
    await page.screenshot({
      path: resolve(`docs/layouts-${theme}.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    folder,
    themes: 2,
    pagesPerTheme: 12,
    allTemplatesRendered: true,
    overflow: false,
    automaticTextColorsVerified: true,
    undoVerified: true,
    existingPagesPreserved: true,
  };
  await writeFile(
    ".local/layouts-result.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app.close();
}
