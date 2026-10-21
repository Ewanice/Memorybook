import { _electron as electron, expect } from "@playwright/test";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { packageRoot } from "./release-paths.mjs";
const folder = resolve(".local/effects-smoke");
await mkdir(folder, { recursive: true });
const app = await electron.launch({
  args: [
    process.argv.includes("--packaged")
      ? join(packageRoot, "resources/app.asar")
      : ".",
    "--user-data-dir=" + folder,
  ],
  env: { ...process.env, MEMORY_USER_DATA: folder },
  timeout: 60000,
});
let newFont;
let fontDirectory;
const errors = [];
app.process().stderr.on("data", (chunk) => {
  for (const line of chunk.toString().split(/\r?\n/))
    if (line.startsWith("[exportPdf]")) console.error(line);
});
try {
  const page = await app.firstWindow();
  fontDirectory = (await page.evaluate(() => window.memorybook.storageInfo()))
    .fonts;
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  const existing = await page.evaluate(() => window.memorybook.fonts());
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: ["C:/Windows/Fonts/arial.ttf"],
    });
  });
  const imported = await page.evaluate(() => window.memorybook.importFonts());
  assert.deepEqual(imported.failures, []);
  const font = imported.fonts.find((f) =>
    f.name.toLowerCase().includes("arial"),
  );
  assert(font);
  if (!existing.some((f) => f.id === font.id)) newFont = font.id;
  const photoPath = join(folder, "photo.png");
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 900;
    const x = c.getContext("2d");
    x.fillStyle = "#c9d6cb";
    x.fillRect(0, 0, 1200, 900);
    x.fillStyle = "#f9efcd";
    x.beginPath();
    x.arc(860, 220, 100, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "#72907e";
    x.beginPath();
    x.moveTo(0, 700);
    x.lineTo(320, 270);
    x.lineTo(760, 750);
    x.lineTo(1200, 420);
    x.lineTo(1200, 900);
    x.lineTo(0, 900);
    x.fill();
    x.fillStyle = "#344f46";
    x.beginPath();
    x.moveTo(0, 850);
    x.quadraticCurveTo(620, 480, 1200, 800);
    x.lineTo(1200, 900);
    x.lineTo(0, 900);
    x.fill();
    return c.toDataURL("image/png").split(",")[1];
  });
  await writeFile(photoPath, Buffer.from(data, "base64"));
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, photoPath);
  const album = await page.evaluate(async (family) => {
    const api = window.memorybook;
    const assets = (await api.importPhotos()).assets;
    let a = await api.create({
      name: "Effects QA " + Date.now(),
      city: "",
      theme: "paper",
      pageSize: "a5",
      assets,
      options: { density: "standard", coverMode: "photo" },
    });
    const shapes = [
      "rectangle",
      "rounded",
      "ellipse",
      "arch",
      "ticket",
      "torn",
      "scallop",
    ];
    const text = (name, y, fontFamily, size = 23) => ({
      id: crypto.randomUUID(),
      type: "text",
      name,
      text: name,
      frame: { x: 24, y, width: 370, height: 43 },
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: {
        fontSize: size,
        color: "#315647",
        align: "left",
        lineHeight: 1.45,
        bold: false,
        fontFamily,
        outline: { enabled: true, width: 1, color: "#ffffff" },
      },
    });
    const elements = [
      text("拾页 · 文字描边", 15, "Noto Sans SC"),
      text("宋体与文字轮廓", 55, "Noto Serif SC", 18),
      text("Imported font outline", 92, family, 18),
    ];
    shapes.forEach((shape, i) =>
      elements.push({
        id: crypto.randomUUID(),
        type: "image",
        name: shape,
        assetId: assets[0].id,
        role: "photo",
        frame: {
          x: 24 + (i % 2) * 190,
          y: 140 + Math.floor(i / 2) * 105,
          width: 172,
          height: 88,
        },
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        fit: "cover",
        crop: { x: 0, y: 0, w: 1, h: 1 },
        effects: {
          shape,
          edgeSize: shape === "rounded" ? 12 : 5,
          border: ["solid", "polaroid", "dashed", "double"][i % 4],
          borderWidth: i % 4 === 1 ? 3 : 1.2,
          borderColor: "#fff9ed",
        },
      }),
    );
    a = (
      await api.edit(a.id, a.revision, {
        type: "replacePage",
        page: { ...a.pages[0], background: "#e5dfd1", elements },
      })
    ).album;
    return a;
  }, font.family);
  await page.reload();
  await page
    .locator(".album-card")
    .filter({ hasText: album.name })
    .locator(".album-cover")
    .click();
  const titleBox = await page
    .locator(".interactive-canvas text")
    .filter({ hasText: "拾页 · 文字描边" })
    .boundingBox();
  assert(titleBox);
  await page.mouse.click(
    titleBox.x + titleBox.width / 2,
    titleBox.y + titleBox.height / 2,
  );
  const outlineDetails = page
    .locator(".inspector details")
    .filter({ has: page.locator("summary").filter({ hasText: "文字描边" }) });
  if (!(await outlineDetails.evaluate((e) => e.open)))
    await outlineDetails.locator("summary").click();
  await expect(page.getByLabel("启用文字描边")).toBeChecked();
  await page.getByLabel("启用文字描边").uncheck();
  await expect
    .poll(async () => {
      const a = await page.evaluate(
        (id) => window.memorybook.open(id),
        album.id,
      );
      return a.pages[0].elements[0].style.outline.enabled;
    })
    .toBe(false);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByLabel("启用文字描边")).toBeChecked();
  await page.screenshot({ path: join(folder, "outline-controls.png") });
  const svg = page.locator(".interactive-canvas");
  const box = await svg.boundingBox();
  assert(box);
  await svg.click({
    position: {
      x: (110 * box.width) / album.size.width,
      y: (180 * box.height) / album.size.height,
    },
  });
  const imageDetails = page
    .locator(".inspector details")
    .filter({ has: page.locator("summary").filter({ hasText: "边缘与边框" }) });
  if (!(await imageDetails.evaluate((e) => e.open)))
    await imageDetails.locator("summary").click();
  await page.getByLabel("裁切形状").selectOption("scallop");
  await page.getByLabel("边框样式").selectOption("double");
  await expect
    .poll(async () => {
      const a = await page.evaluate(
        (id) => window.memorybook.open(id),
        album.id,
      );
      return a.pages[0].elements.find((e) => e.type === "image").effects.shape;
    })
    .toBe("scallop");
  const final = await page.evaluate(
    (id) => window.memorybook.open(id),
    album.id,
  );
  const exportPath = join(folder, "effects.pdf");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  await page.evaluate(
    (a) =>
      window.memorybook.exportPdf({
        albumId: a.id,
        revision: a.revision,
        quality: "high",
      }),
    final,
  );
  assert.equal(
    (await PDFDocument.load(await readFile(exportPath))).getPageCount(),
    final.pages.length,
  );
  const svgs = await app.evaluate(async ({ BrowserWindow }, album) => {
    const w = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    try {
      await w.loadURL("memory://app/export.html");
      return await w.webContents.executeJavaScript(
        `window.memorybookExport.render(${JSON.stringify(album)},"high")`,
      );
    } finally {
      w.destroy();
    }
  }, final);
  const ids = svgs.join("").match(/id="image-edge-[^"]+/g) ?? [];
  assert.equal(
    new Set(ids).size,
    ids.length,
    "SVG clipping IDs must not collide between PDF pages",
  );
  assert(svgs[0].includes('paint-order="stroke fill"'));
  assert(svgs[0].includes("clipPath"));
  await writeFile(join(folder, "cover.svg"), svgs[0]);
  await page.screenshot({ path: join(folder, "image-controls.png") });
  assert.deepEqual(errors, []);
  await writeFile(
    ".local/effects-result.json",
    JSON.stringify(
      {
        passed: true,
        fontFamilies: ["Noto Sans SC", "Noto Serif SC", font.family],
        shapes: 7,
        borders: 4,
        outlineToggleAndUndo: true,
        svgClipIdsUnique: true,
        pdf: exportPath,
        folder,
      },
      null,
      2,
    ),
  );
  console.log("Effects UI, fonts, undo and PDF verified.");
} finally {
  await app.close();
  if (newFont) await unlink(join(fontDirectory, newFont));
}
