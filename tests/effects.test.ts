import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createAlbum, layoutCatalog } from "../src/domain/templates";
import {
  defaultImageEffects,
  textElement,
  elementPatch,
  type ImageEffects,
} from "../src/domain/model";
import { assertAlbum, assertElement } from "../src/domain/validation";
import { applyEdit } from "../src/domain/edit";
import { instantiateLayout } from "../src/domain/layouts";
import {
  imageShapePath,
  imageContentFrame,
  imageShapeLabels,
} from "../src/domain/image-effects";
import { textLines, textOverflows } from "../src/domain/text";
const asset = {
  id: "a".repeat(64),
  name: "photo",
  mime: "image/png" as const,
  width: 400,
  height: 300,
  bytes: 100,
};
test("旧工程描边默认关闭；描边计入换行与溢出检查，非法宽度被拒绝", () => {
  const text = textElement("abcdef", { x: 0, y: 0, width: 30, height: 20 }, 10);
  assert.equal(text.style.outline?.enabled ?? false, false);
  assert.deepEqual(
    textLines(text, (t) => t.length * 5),
    ["abcdef"],
  );
  const after = structuredClone(text);
  after.style.outline = { enabled: true, width: 2, color: "#ffffff" };
  assert.deepEqual(
    textLines(after, (t) => t.length * 5),
    ["abcde", "f"],
  );
  assert(textOverflows(after, (t) => t.length * 5));
  assert.deepEqual(
    elementPatch(text, after).style?.outline,
    after.style.outline,
  );
  assertElement(text);
  assertElement(after);
  after.style.outline.width = -1;
  assert.throws(() => assertElement(after));
});
test("模板占位填充与缩放保留图片效果和文字描边，编辑可独立撤销", () => {
  const template = layoutCatalog()[0]!;
  const slot = template.page.elements.find(
    (e) => e.type === "photoSlot" && e.role !== "sticker",
  )!;
  assert(slot.type === "photoSlot");
  slot.effects = { ...defaultImageEffects, shape: "torn", border: "double" };
  const text = template.page.elements.find((e) => e.type === "text")!;
  assert(text.type === "text");
  text.style.outline = { enabled: true, width: 1, color: "#ffffff" };
  const page = instantiateLayout(template, template.size, [asset], [], [], 0);
  const image = page.elements.find((e) => e.type === "image")!;
  assert(image.type === "image");
  assert.deepEqual(image.effects, slot.effects);
  const halfSize = {
    width: template.size.width / 2,
    height: template.size.height / 2,
  };
  const scaledSlot = instantiateLayout(
    template,
    halfSize,
    [],
    [],
    [],
    0,
    true,
  ).elements.find((e) => e.type === "photoSlot")!;
  assert(scaledSlot.type === "photoSlot");
  assert.equal(scaledSlot.effects!.borderWidth, slot.effects.borderWidth / 2);
  const scaledImage = instantiateLayout(
    template,
    halfSize,
    [asset],
    [],
    [],
  ).elements.find((e) => e.type === "image")!;
  assert(scaledImage.type === "image");
  assert.deepEqual(scaledImage.effects, scaledSlot.effects);
  assert.equal(
    page.elements.find((e) => e.id === text.id),
    undefined,
  );
  const album = createAlbum("effects", "", "paper", "a5", []);
  album.assets = [asset];
  album.pages.push(page);
  assertAlbum(album);
  const changed = applyEdit(album, {
    type: "patchElement",
    pageId: page.id,
    elementId: image.id,
    patch: { effects: { ...image.effects!, shape: "ellipse" } },
  });
  assert.equal(
    (
      changed.pages
        .at(-1)!
        .elements.find((e) => e.id === image.id) as typeof image
    ).effects!.shape,
    "ellipse",
  );
  assert.equal(image.effects!.shape, "torn");
  assert.deepEqual(image.crop, { x: 0, y: 0, w: 1, h: 1 });
  const empty = createAlbum("slot", "", "paper", "a5", []);
  empty.assets = [asset];
  empty.pages.push(template.page);
  const filled = applyEdit(empty, {
    type: "fillSlot",
    pageId: template.page.id,
    elementId: slot.id,
    assetId: asset.id,
  });
  assert.deepEqual(
    (
      filled.pages
        .at(-1)!
        .elements.find((e) => e.id === slot.id) as typeof image
    ).effects,
    slot.effects,
  );
  const bad = {
    ...image,
    effects: {
      ...defaultImageEffects,
      borderColor: "url(https://example.com)",
    },
  };
  assert.throws(() => assertElement(bad));
});
test("图片形状在小尺寸和旋转前均保持有界，波浪使用曲线；全部排版默认不启用文字描边", () => {
  for (const shape of Object.keys(
    imageShapeLabels,
  ) as ImageEffects["shape"][]) {
    const f = { x: 10, y: 20, width: 6, height: 4 },
      effects = {
        ...defaultImageEffects,
        shape,
        edgeSize: 24,
        border: "polaroid" as const,
        borderWidth: 16,
      };
    const path = imageShapePath(f, effects, 99);
    assert(!/NaN|Infinity/.test(path));
    assert.equal(path, imageShapePath(f, effects, 99));
    const content = imageContentFrame(f, effects);
    assert(content.width > 0 && content.height > 0);
    assert(content.y + content.height <= 24);
  }
  assert(
    imageShapePath(
      { x: 0, y: 0, width: 100, height: 80 },
      { ...defaultImageEffects, shape: "scallop" },
    ).includes("Q"),
  );
  for (const t of layoutCatalog())
    for (const e of t.page.elements)
      if (e.type === "text") assert(!e.style.outline?.enabled);
});
test("固定目录重复打包覆盖程序、清除过期程序文件，保留用户数据和自编短语", (t) => {
  const root = resolve("out");
  mkdirSync(root, { recursive: true });
  const temp = mkdtempSync(join(root, "package-test-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = join(temp, "stage"),
    target = join(temp, "fixed");
  mkdirSync(source);
  writeFileSync(join(source, "app.txt"), "v1");
  writeFileSync(join(source, "old.dll"), "old");
  writeFileSync(join(source, "phrases.txt"), "default");
  const { publishProgram } = createRequire(import.meta.url)(
    "../scripts/package-output.cjs",
  );
  publishProgram(source, target);
  mkdirSync(join(target, "data"));
  writeFileSync(join(target, "data", "book.txt"), "personal");
  writeFileSync(join(target, "phrases.txt"), "my words");
  rmSync(join(source, "old.dll"));
  writeFileSync(join(source, "app.txt"), "v2");
  publishProgram(source, target);
  assert.equal(readFileSync(join(target, "app.txt"), "utf8"), "v2");
  assert(!existsSync(join(target, "old.dll")));
  assert.equal(
    readFileSync(join(target, "data", "book.txt"), "utf8"),
    "personal",
  );
  assert.equal(readFileSync(join(target, "phrases.txt"), "utf8"), "my words");
  writeFileSync(
    join(source, "program-files.json"),
    JSON.stringify(["../escape"]),
  );
  assert.throws(() => publishProgram(source, target));
});
