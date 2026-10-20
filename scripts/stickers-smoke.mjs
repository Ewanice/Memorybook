import { _electron as electron, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const folder = resolve(`.local/stickers-smoke-${Date.now()}`);
await mkdir(folder, { recursive: true });
const app = await electron.launch({
  args: ["."],
  env: { ...process.env, MEMORY_USER_DATA: folder },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByPlaceholder("在这里粘贴完整卡密")
    .fill(await readFile(".local/development.license", "utf8"));
  await page.getByRole("button", { name: "验证并开始" }).click();
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  const image = await app.evaluate(({ nativeImage }) => {
    const make = (color, transparent) => {
      const b = Buffer.alloc(400 * 400 * 4);
      for (let y = 0; y < 400; y++)
        for (let x = 0; x < 400; x++) {
          const i = (y * 400 + x) * 4;
          b[i] = color;
          b[i + 1] = 160;
          b[i + 2] = 210;
          b[i + 3] =
            transparent && Math.hypot(x - 200, y - 200) > 150 ? 0 : 255;
        }
      return nativeImage
        .createFromBitmap(b, { width: 400, height: 400 })
        .toPNG()
        .toString("base64");
    };
    return {
      photo: make(50, false),
      sticker: make(190, true),
      second: make(240, true),
    };
  });
  const photo = join(folder, "photo.png"),
    sticker = join(folder, "sticker.png"),
    second = join(folder, "sticker-two.png");
  for (const [path, key] of [
    [photo, "photo"],
    [sticker, "sticker"],
    [second, "second"],
  ])
    await writeFile(path, Buffer.from(image[key], "base64"));
  const choose = (path) =>
    app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, path);
  await choose(sticker);
  await page.getByRole("button", { name: "＋ 上传贴纸", exact: true }).click();
  await expect(page.locator(".sticker-shelf img")).toHaveCount(1);
  const global = await page.evaluate(() => window.memorybook.resources());
  const firstId = global.stickers[0].id;
  await page
    .getByRole("button", { name: "＋ 新建纪念册", exact: true })
    .click();
  await page.getByPlaceholder("例如：明日世界").fill("贴纸回归");
  await choose(photo);
  await page.getByRole("button", { name: "选择你的照片" }).click();
  await expect(
    page.getByText("尚未选择贴纸，本次自动生成不会排入贴纸。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "生成纪念册 →", exact: true }).click();
  await page.getByText("已保存在本机", { exact: true }).waitFor();
  const albumId = (await page.evaluate(() => window.memorybook.bootstrap()))
    .albums[0].id;
  // The global sticker wasn't selected at creation and isn't in album.assets yet.
  assert(
    !(
      await page.evaluate((id) => window.memorybook.open(id), albumId)
    ).assets.some((a) => a.id === firstId),
  );
  await page.getByRole("button", { name: "＋ 贴纸", exact: true }).click();
  const drawer = page.locator(".drawer");
  await expect(
    drawer.locator(".asset-grid img[alt='sticker.png']"),
  ).toHaveCount(1);
  await expect(drawer.locator(".asset-grid img[alt='photo.png']")).toHaveCount(
    0,
  );
  await drawer.getByTitle("sticker.png", { exact: true }).click();
  await expect
    .poll(async () => {
      const a = await page.evaluate(
        (id) => window.memorybook.open(id),
        albumId,
      );
      return a.pages
        .flatMap((p) => p.elements)
        .filter(
          (e) =>
            e.type === "image" && e.role === "sticker" && e.assetId === firstId,
        ).length;
    })
    .toBe(1);
  const book = await page.evaluate((id) => window.memorybook.open(id), albumId);
  assert(book.assetLibrary.stickers.includes(firstId));
  await page.getByRole("button", { name: "＋ 照片", exact: true }).click();
  await expect(drawer.locator(".asset-grid img[alt='photo.png']")).toHaveCount(
    1,
  );
  await expect(
    drawer.locator(".asset-grid img[alt='sticker.png']"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "＋ 贴纸", exact: true }).click();
  await choose(second);
  await drawer.getByRole("button", { name: "上传贴纸", exact: true }).click();
  await expect(drawer.locator(".asset-grid img")).toHaveCount(2);
  await drawer.getByTitle("sticker-two.png", { exact: true }).click();
  await expect
    .poll(async () => {
      const a = await page.evaluate(
        (id) => window.memorybook.open(id),
        albumId,
      );
      return a.pages
        .flatMap((p) => p.elements)
        .filter((e) => e.type === "image" && e.role === "sticker").length;
    })
    .toBe(2);
  await page.screenshot({ path: resolve(".local/sticker-drawer.png") });
  // Remove the first item from global library; the current book keeps its copied reference.
  await page.evaluate((id) => window.memorybook.removeSticker(id), firstId);
  await page.reload();
  await page.locator(".album-cover").first().click();
  await page.getByRole("button", { name: "＋ 贴纸", exact: true }).click();
  await expect(
    page.locator(".drawer .asset-grid img[alt='sticker.png']"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "＋ 照片", exact: true }).click();
  await expect(page.locator(".drawer .asset-grid img")).toHaveCount(1);
  assert.deepEqual(errors, []);
  await writeFile(
    ".local/stickers-result.json",
    JSON.stringify(
      {
        passed: true,
        folder,
        globalStickerAvailableWithoutInitialSelection: true,
        photoStickerListsSeparated: true,
        editorUploadSavedToLibrary: true,
        projectStickerSurvivesGlobalRemoval: true,
        reloadClassificationPreserved: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "贴纸上传、未选入工程时可添加、照片贴纸分类、编辑器上传与重启持久化验收通过。",
  );
} finally {
  await app.close();
}
