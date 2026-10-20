import { build } from "esbuild";
import { _electron as electron } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const directory = resolve(".local/contact-smoke-" + Date.now());
await mkdir(directory, { recursive: true });
const module = resolve(directory, "contact-test.cjs");
await build({
  stdin: {
    contents:
      'export {makeContactSheets} from "./src/infrastructure/contact-sheets";export {AssetStore} from "./src/infrastructure/assets";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: module,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
const app = await electron.launch({
  args: ["."],
  env: { ...process.env, MEMORY_USER_DATA: directory },
  timeout: 60000,
});
try {
  const result = await app.evaluate(
    async ({ nativeImage }, { directory, module }) => {
      const { createRequire } = process.getBuiltinModule("module"),
        require = createRequire(process.cwd() + "/package.json");
      const { AssetStore, makeContactSheets } = require(module);
      const store = new AssetStore(directory + "/assets"),
        photos = [];
      for (let i = 0; i < 70; i++) {
        const bytes = Buffer.alloc(240 * 180 * 4, 255);
        for (let p = 0; p < bytes.length; p += 4) {
          bytes[p] = i * 3;
          bytes[p + 1] = 80;
          bytes[p + 2] = 180;
        }
        photos.push(
          await store.put(
            nativeImage
              .createFromBitmap(bytes, { width: 240, height: 180 })
              .toPNG(),
            `photo-${i}`,
          ),
        );
      }
      const alpha = nativeImage
        .createFromBitmap(Buffer.from([128, 0, 0, 128]), {
          width: 1,
          height: 1,
        })
        .toPNG();
      const transparent = await store.put(alpha, "transparent-sticker");
      const files = [],
        sheets = await makeContactSheets(
          photos,
          [...photos.slice(0, 7), transparent],
          store,
          directory + "/sheets",
          new AbortController().signal,
          files,
        );
      const bitmap = nativeImage.createFromPath(sheets.at(-1).path).toBitmap(),
        sample = (80 * 1280 + 7 * 160 + 80) * 4;
      return {
        alphaImage: alpha.toString("base64"),
        transparentPixel: [...bitmap.subarray(sample, sample + 3)],
        sheets: sheets.map((s) => ({
          ...s,
          size: nativeImage.createFromPath(s.path).getSize(),
        })),
        files: files.length,
      };
    },
    { directory, module },
  );
  assert.equal(result.sheets.length, 3);
  await writeFile(
    resolve(".local/contact-alpha.png"),
    Buffer.from(result.alphaImage, "base64"),
  );
  assert.equal(result.files, 3);
  assert(
    Math.max(...result.transparentPixel) > 240,
    "transparent sticker must composite over white without darkening its color",
  );
  assert.deepEqual(
    result.sheets.filter((s) => s.kind === "photo").flatMap((s) => s.indices),
    Array.from({ length: 70 }, (_, i) => i),
  );
  assert(
    result.sheets.every((s) => s.size.width === 1280 && s.size.height <= 1152),
  );
  await writeFile(
    resolve(".local/contact-sheet-result.json"),
    JSON.stringify(
      {
        passed: true,
        photos: 70,
        stickers: 8,
        transparentPixel: result.transparentPixel,
        sheets: result.sheets,
      },
      null,
      2,
    ),
  );
  console.log(
    "Contact sheets cover all 70 photos and 8 stickers, including transparency.",
  );
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
}
