import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ResourceLibrary,
  parsePhrases,
} from "../src/infrastructure/resource-library";
import {
  composePage,
  compositionLabels,
  type Composition,
} from "../src/domain/compositions";
import { createAlbum, suggestedPageCount } from "../src/domain/templates";
import { assertAlbum, assertElement } from "../src/domain/validation";
import { applyEdit } from "../src/domain/edit";
import { sizes, type Asset } from "../src/domain/model";

const asset = (n: number): Asset => ({
  id: n.toString(16).padStart(64, "0"),
  name: `素材${n}.png`,
  mime: "image/png",
  width: 800,
  height: 600,
  bytes: 1000,
});
test("四套构图都有独立照片、短语和贴纸区域，旋转后仍在页面内", () => {
  for (const size of Object.values(sizes))
    for (const theme of ["paper", "live"] as const)
      for (const layout of Object.keys(compositionLabels) as Composition[]) {
        const page = composePage(size, theme, layout, []);
        assert(
          page.elements.some((e) => e.type === "text" && e.name === "短语 1"),
        );
        assert(
          page.elements.some(
            (e) => e.type === "photoSlot" && e.role === "photo",
          ),
        );
        assert(
          page.elements.some(
            (e) => e.type === "photoSlot" && e.role === "sticker",
          ),
        );
        for (const el of page.elements) {
          assertElement(el);
          const r = (el.rotation * Math.PI) / 180,
            f = el.frame;
          const halfW =
            (Math.abs(Math.cos(r)) * f.width +
              Math.abs(Math.sin(r)) * f.height) /
            2;
          const halfH =
            (Math.abs(Math.sin(r)) * f.width +
              Math.abs(Math.cos(r)) * f.height) /
            2;
          assert(
            f.x + f.width / 2 - halfW >= 0 &&
              f.x + f.width / 2 + halfW <= size.width,
          );
          assert(
            f.y + f.height / 2 - halfH >= 0 &&
              f.y + f.height / 2 + halfH <= size.height,
          );
        }
      }
});

test("交替生成不丢照片，贴纸不占照片数量，预估页数与实际一致", () => {
  for (const layout of [
    "collection",
    ...Object.keys(compositionLabels),
  ] as const)
    for (const count of [0, 1, 2, 9, 30]) {
      const photos = Array.from({ length: count }, (_, i) => asset(i + 1));
      const sticker = asset(99);
      const a = createAlbum(
        "测试",
        "北京",
        "paper",
        "a5",
        photos,
        {
          density: "standard",
          coverMode: "photo",
          layout: layout as Composition | "collection",
          usePhrases: true,
        },
        { stickers: [sticker], phrases: ["原创示例短语"] },
      );
      assertAlbum(a);
      assert.equal(
        a.pages.length,
        suggestedPageCount(
          count,
          "standard",
          layout as Composition | "collection",
        ),
      );
      assert.equal(
        a.pages
          .flatMap((p) => p.elements)
          .filter((e) => e.type === "image" && e.role === "photo").length,
        count,
      );
      assert(
        a.pages[1]!.elements.some(
          (e) => e.type === "image" && e.role === "sticker",
        ),
      );
      if (count > 1)
        assert(
          !a.pages
            .flatMap((p) => p.elements)
            .some((e) => e.type === "photoSlot"),
        );
    }
  assert(suggestedPageCount(500, "standard", "monologue") > 100);
  assert.throws(() =>
    createAlbum(
      "超限",
      "",
      "paper",
      "a5",
      Array.from({ length: 102 }, (_, i) => asset(i + 1)),
      { density: "standard", coverMode: "photo", layout: "monologue" },
    ),
  );
});

test("贴纸占位填充保留 ID、几何与 contain 语义，旧照片占位仍兼容", () => {
  const a = createAlbum("测试", "", "paper", "a5", []);
  a.assets.push(asset(1));
  a.pages[1] = composePage(a.size, a.theme, "monologue", []);
  const slot = a.pages[1]!.elements.find(
    (e) => e.type === "photoSlot" && e.role === "sticker",
  )!;
  const b = applyEdit(a, {
    type: "fillSlot",
    pageId: a.pages[1]!.id,
    elementId: slot.id,
    assetId: asset(1).id,
  });
  const el = b.pages[1]!.elements.find((e) => e.id === slot.id)!;
  assert(el.type === "image" && el.role === "sticker" && el.fit === "contain");
  assert.deepEqual(el.frame, slot.frame);
  assert.equal(el.rotation, slot.rotation);
  assertAlbum(b);
});

test("短语解析支持 UTF-8 BOM、CRLF、注释、去重和空库，拒绝超限", () => {
  assert.deepEqual(
    parsePhrases("\uFEFF# 注释\r\n 第一行 \r\n\r\n第二行\r\n第一行"),
    ["第一行", "第二行"],
  );
  assert.deepEqual(parsePhrases("# 空库\n"), []);
  assert.throws(() => parsePhrases("长".repeat(81)));
  assert.throws(() =>
    parsePhrases(Array.from({ length: 1001 }, (_, i) => String(i)).join("\n")),
  );
});

test("贴纸库去重、移出只更新库索引，失效选择明确报错", () => {
  const map = new Map<string, string>();
  const lib = new ResourceLibrary(
    {
      getValue: (key) => map.get(key) ?? null,
      setValue: (key, value) => {
        map.set(key, value);
      },
    },
    "unused",
    "unused",
  );
  lib.addStickers([asset(1), asset(1), asset(2)]);
  assert.equal(lib.stickers().length, 2);
  assert.deepEqual(lib.selected([asset(2).id]), [asset(2)]);
  lib.removeSticker(asset(1).id);
  assert.throws(() => lib.selected([asset(1).id]));
  assert.throws(() => lib.selected([asset(2).id, asset(2).id]));
});

test("明文短语文件只在不存在时创建，后续读取用户修改，错误编码明确失败", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memorybook-phrases-"));
  const seed = join(dir, "seed.txt"),
    file = join(dir, "短语库.txt");
  await writeFile(seed, "原创示例");
  const lib = new ResourceLibrary(
    { getValue: () => null, setValue: () => {} },
    file,
    seed,
  );
  assert.deepEqual(await lib.phrases(), ["原创示例"]);
  await writeFile(file, "用户自己的短语");
  assert.deepEqual(await lib.phrases(), ["用户自己的短语"]);
  assert.equal(await readFile(file, "utf8"), "用户自己的短语");
  await writeFile(file, Buffer.from([0xff, 0xfe]));
  await assert.rejects(lib.phrases(), /UTF-8/);
});
