import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { packageRoot } from "./release-paths.mjs";
const folder = await mkdtemp(resolve(".local/customization-smoke-"));
let app;
const errors = [];
async function launch() {
  app = await electron.launch({
    args: [
      process.argv.includes("--packaged")
        ? join(packageRoot, "resources/app.asar")
        : ".",
      "--user-data-dir=" + folder,
    ],
    env: { ...process.env, MEMORY_USER_DATA: folder },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  return page;
}
async function files(paths) {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, paths);
}
try {
  const page = await launch();
  const paths = [];
  for (let i = 0; i < 6; i++) {
    const data = await page.evaluate((i) => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 1000;
      const x = c.getContext("2d");
      x.fillStyle = [
        "#b4cbc0",
        "#c2d0d9",
        "#d6beb4",
        "#cfccb5",
        "#d7c0ce",
        "#c1c9d5",
      ][i];
      x.fillRect(0, 0, 800, 1000);
      x.fillStyle = "#fff8dd";
      x.beginPath();
      x.arc(550, 200, 100, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = "#44695b";
      x.beginPath();
      x.moveTo(0, 900);
      x.lineTo(350, 350);
      x.lineTo(800, 1000);
      x.fill();
      return c.toDataURL("image/png").split(",")[1];
    }, i);
    const path = join(folder, `photo-${i}.png`);
    await writeFile(path, Buffer.from(data, "base64"));
    paths.push(path);
  }
  await files([paths[0], paths[1]]);
  await page.getByRole("button", { name: "＋ 上传贴纸" }).click();
  await expect(page.locator(".sticker-item")).toHaveCount(2);
  await page.getByRole("tab", { name: /排版库/ }).click();
  await expect(page.locator(".layout-library-grid article")).toHaveCount(13);
  await expect(page.locator(".layout-kind.cover")).toHaveCount(2);
  const full = page
    .locator(".layout-library-grid article")
    .filter({ hasText: "完整图片封面" });
  await full.getByRole("button", { name: "编辑排版" }).click();
  await expect(page.getByRole("dialog", { name: "排版编辑器" })).toBeVisible();
  await page.getByLabel("排版名称").fill("我的顶格封面");
  await page.getByRole("button", { name: "保存排版", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "排版编辑器" })).toHaveCount(0);
  await expect(
    page
      .locator(".layout-library-grid article")
      .filter({ hasText: "我的顶格封面" }),
  ).toHaveCount(1);
  await page
    .locator(".layout-library-grid article")
    .filter({ hasText: "单张主图" })
    .getByRole("button", { name: "删除排版" })
    .click();
  await expect(page.locator(".layout-library-grid article")).toHaveCount(12);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "外观", exact: true }).click();
  await page.getByLabel("首页名称", { exact: true }).fill("回忆工作室");
  await expect
    .poll(async () =>
      page.evaluate(
        async () => (await window.memorybook.bootstrap()).settings.displayName,
      ),
    )
    .toBe("回忆工作室");
  await page.getByRole("button", { name: "玫瑰主题色" }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        async () => (await window.memorybook.bootstrap()).settings.accentColor,
      ),
    )
    .toBe("#96576b");
  await files([paths[2]]);
  await page.getByRole("button", { name: "选择背景图片" }).click();
  await expect(page.getByAltText("当前首页背景")).toBeVisible();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator(".home-header .brand")).toContainText("回忆工作室");
  assert(
    (await page.locator(".home-surface").getAttribute("style")).includes(
      "memory://asset/",
    ),
  );
  await page.screenshot({ path: join(folder, "home.png") });
  await page.getByRole("button", { name: "＋ 新建纪念册" }).click();
  await expect(
    page.locator('.sticker-selection [aria-pressed="true"]'),
  ).toHaveCount(2);
  await expect(
    page.locator(".composition-catalog .composition-card"),
  ).toHaveCount(10);
  await page
    .getByLabel("封面排版", { exact: true })
    .selectOption("builtin-cover-complete");
  await page.getByPlaceholder("例如：明日世界").fill("秋日的回忆");
  await files(paths);
  await page.getByRole("button", { name: /选择你的照片/ }).click();
  await expect(page.locator(".picked-photos img")).toHaveCount(6);
  await page.screenshot({ path: join(folder, "new-dialog.png") });
  await page.getByRole("button", { name: "生成纪念册 →" }).click();
  await page.getByText("已保存在本机", { exact: true }).waitFor();
  let album = await page.evaluate(async () => {
    const b = await window.memorybook.bootstrap();
    return window.memorybook.open(
      b.albums.find((a) => a.name === "秋日的回忆").id,
    );
  });
  const title = album.pages[0].elements.find((e) => e.name === "封面标题");
  assert.equal(title.frame.y, 0);
  assert.equal(title.style.align, "center");
  assert.equal(title.text, "秋日的回忆");
  const svg = page.locator(".interactive-canvas");
  const box = await svg.boundingBox();
  assert(box);
  await svg.click({ position: { x: box.width * 0.5, y: box.height * 0.06 } });
  await page.getByLabel("对齐多个元素").selectOption("y:center");
  await expect
    .poll(async () =>
      page.evaluate(
        async (id) =>
          (await window.memorybook.open(id)).pages[0].elements.find(
            (e) => e.name === "封面标题",
          ).frame.y,
        album.id,
      ),
    )
    .toBeGreaterThan(200);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        async (id) =>
          (await window.memorybook.open(id)).pages[0].elements.find(
            (e) => e.name === "封面标题",
          ).frame.y,
        album.id,
      ),
    )
    .toBe(0);
  await page.keyboard.press("Control+]");
  await expect
    .poll(async () =>
      page.evaluate(
        async (id) =>
          (await window.memorybook.open(id)).pages[0].elements.at(-1).name,
        album.id,
      ),
    )
    .toBe("封面标题");
  await page.keyboard.press("Control+[");
  await expect
    .poll(async () =>
      page.evaluate(
        async (id) =>
          (await window.memorybook.open(id)).pages[0].elements.at(-1).name,
        album.id,
      ),
    )
    .toBe("城市角标");
  await svg.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await page.getByRole("button", { name: "复制所选", exact: true }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        async (id) =>
          (await window.memorybook.open(id)).pages[0].elements.length,
        album.id,
      ),
    )
    .toBe(album.pages[0].elements.length + 1);
  await page.getByRole("button", { name: "锁定所选", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "解锁所选", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "解锁所选", exact: true }).click();
  await page.keyboard.press("Delete");
  await expect
    .poll(async () =>
      page.evaluate(
        async (id) =>
          (await window.memorybook.open(id)).pages[0].elements.length,
        album.id,
      ),
    )
    .toBe(album.pages[0].elements.length);
  await svg.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await page.getByRole("button", { name: "裁切取景", exact: true }).click();
  await page
    .getByRole("dialog", { name: "照片取景" })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.getByRole("button", { name: "封面排版", exact: true }).click();
  await page
    .locator(".drawer .template-grid button")
    .filter({ hasText: "照片与标题封面" })
    .click();
  await page.getByRole("button", { name: "确认套用", exact: true }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        async (id) =>
          (await window.memorybook.open(id)).pages[0].elements.find(
            (e) => e.name === "封面标题",
          ).frame.y,
        album.id,
      ),
    )
    .toBeGreaterThan(0);
  album = await page.evaluate((id) => window.memorybook.open(id), album.id);
  const pdf = join(folder, "customization.pdf");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, pdf);
  await page.evaluate(
    (a) =>
      window.memorybook.exportPdf({
        albumId: a.id,
        revision: a.revision,
        quality: "high",
      }),
    album,
  );
  assert.equal(
    (await PDFDocument.load(await readFile(pdf))).getPageCount(),
    album.pages.length,
  );
  await page.screenshot({ path: join(folder, "editor.png") });
  await app.close();
  app = null;
  const restored = await launch();
  await expect(restored.locator(".brand")).toContainText("回忆工作室");
  const resources = await restored.evaluate(() =>
    window.memorybook.resources(),
  );
  assert(resources.hiddenLayoutIds.includes("builtin-hero"));
  assert(
    resources.layouts.some(
      (t) => t.id === "builtin-cover-complete" && t.name === "我的顶格封面",
    ),
  );
  await restored.getByRole("tab", { name: /排版库/ }).click();
  await restored.getByRole("button", { name: "恢复默认排版" }).click();
  await expect(restored.locator(".layout-library-grid article")).toHaveCount(
    13,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    ".local/customization-result.json",
    JSON.stringify(
      {
        passed: true,
        folder,
        pages: album.pages.length,
        checks: [
          "delete and restore builtin layouts",
          "edit default cover",
          "top centered cover title",
          "all stickers selected",
          "name, theme and home background",
          "duplicate lock unlock crop",
          "single element page alignment and layer shortcuts",
          "apply cover preview and save",
          "PDF export",
          "restart persistence",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Customization UI, cover library, editor and PDF verified: " + folder,
  );
} finally {
  if (app) await app.close();
}
