import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { packageRoot } from "./release-paths.mjs";
const folder = await mkdtemp(resolve(".local/background-smoke-"));
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
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  return page;
}
async function settings(page) {
  return page.evaluate(
    async () => (await window.memorybook.bootstrap()).settings,
  );
}
try {
  const page = await launch();
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 900;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 1600, 900);
    g.addColorStop(0, "#8ba9a5");
    g.addColorStop(0.5, "#ded3b5");
    g.addColorStop(1, "#87657d");
    x.fillStyle = g;
    x.fillRect(0, 0, 1600, 900);
    x.fillStyle = "#f8edbe";
    x.beginPath();
    x.arc(1100, 200, 90, 0, Math.PI * 2);
    x.fill();
    return c.toDataURL("image/png").split(",")[1];
  });
  const photo = join(folder, "background.png");
  await writeFile(photo, Buffer.from(data, "base64"));
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, photo);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "外观", exact: true }).click();
  await page.getByRole("button", { name: "选择背景图片" }).click();
  const slider = page.getByLabel("背景缩放", { exact: true });
  await expect(slider).toBeEnabled();
  await slider.focus();
  await slider.press("End");
  await expect
    .poll(async () => (await settings(page)).homeBackgroundScale)
    .toBe(4);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("tab", { name: /排版库/ }).click();
  const before = await page.locator(".home-background").boundingBox();
  assert(before);
  assert.equal(before.y, 0);
  const appearance = await page.locator(".home-background").evaluate((e) => ({
    position: getComputedStyle(e).position,
    size: getComputedStyle(e, "::before").backgroundSize,
    scale: getComputedStyle(e, "::before").transform,
  }));
  assert.equal(appearance.position, "fixed");
  assert.equal(appearance.size, "cover");
  assert(appearance.scale.startsWith("matrix(4,"));
  await page.screenshot({ path: join(folder, "before-scroll.png") });
  await page.mouse.move(15, 400);
  await page.mouse.wheel(0, 650);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  const after = await page.locator(".home-background").boundingBox();
  assert.deepEqual(after, before);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Zooming must not create a horizontal scrollbar",
  );
  await page.screenshot({ path: join(folder, "after-scroll.png") });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 900),
  );
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => innerWidth)) - 1280))
    .toBeLessThanOrEqual(2);
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  assert(
    Math.abs(
      (await page.locator(".home-background").boundingBox()).width - width,
    ) <= 1,
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "外观", exact: true }).click();
  await page.getByLabel("背景缩放", { exact: true }).press("Home");
  await expect
    .poll(async () => (await settings(page)).homeBackgroundScale)
    .toBe(1);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await app.close();
  app = null;
  const restarted = await launch();
  assert.equal((await settings(restarted)).homeBackgroundScale, 1);
  assert.equal(
    await restarted
      .locator(".home-background")
      .evaluate((e) => getComputedStyle(e).position),
    "fixed",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    ".local/background-result.json",
    JSON.stringify(
      {
        passed: true,
        folder,
        fixedDuringScroll: true,
        coverAtWindowResize: true,
        scaleRange: [1, 4],
        noHorizontalOverflow: true,
        restartPersistence: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Fixed background, scaling and restart verified: " + folder);
} finally {
  if (app) await app.close();
}
