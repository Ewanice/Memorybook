import Ajv from "ajv";
import { coverPhotoIndices } from "../domain/covers";
import {
  type Album,
  type Asset,
  type Element,
  DomainError,
  id,
  imageElement,
  textElement,
} from "../domain/model";
import {
  type LayoutTemplate,
  instantiateLayout,
  fitPhrase,
} from "../domain/layouts";
import { layoutCapacity } from "../domain/templates";
import { assertAlbum } from "../domain/validation";

const nullableNumber = { type: ["number", "null"] };
const elementProperties = {
  kind: { type: "string", enum: ["photo", "sticker", "text"] },
  assetIndex: { type: ["integer", "null"] },
  text: { type: ["string", "null"] },
  x: { type: "number" },
  y: { type: "number" },
  width: { type: "number" },
  height: { type: "number" },
  rotation: { type: "number" },
  fontSize: nullableNumber,
  color: { type: ["string", "null"] },
};
export const generationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pages"],
  properties: {
    pages: {
      type: "array",
      minItems: 1,
      maxItems: 99,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["layoutId", "photoIndices", "phraseIndices", "elements"],
        properties: {
          layoutId: { type: "string" },
          photoIndices: {
            type: "array",
            items: { type: "integer", minimum: 0 },
            maxItems: 50,
          },
          phraseIndices: {
            type: "array",
            items: { type: "integer", minimum: 0 },
            maxItems: 100,
          },
          elements: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              additionalProperties: false,
              required: Object.keys(elementProperties),
              properties: elementProperties,
            },
          },
        },
      },
    },
  },
};
type PlanElement = {
  kind: "photo" | "sticker" | "text";
  assetIndex: number | null;
  text: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fontSize: number | null;
  color: string | null;
};
type PlanPage = {
  layoutId: string;
  photoIndices: number[];
  phraseIndices: number[];
  elements: PlanElement[];
};
const valid = new Ajv({ strict: true }).compile(generationSchema);
export function applyGenerationPlan(
  base: Album,
  photos: Asset[],
  stickers: Asset[],
  phrases: string[],
  catalog: LayoutTemplate[],
  mode: "templates" | "creative",
  value: unknown,
): Album {
  if (!valid(value))
    throw new DomainError("Codex 返回的纪念册结构不正确，未创建工程。");
  const plan = value as { pages: PlanPage[] };
  const assignments = plan.pages.flatMap((p) => p.photoIndices);
  const reserved = new Set(coverPhotoIndices(base, photos));
  const expected = photos.flatMap((_, i) => (reserved.has(i) ? [] : [i]));
  if (
    assignments.length !== expected.length ||
    new Set(assignments).size !== assignments.length ||
    expected.some((n) => !assignments.includes(n))
  )
    throw new DomainError("Codex 遗漏、重复或引用了未提供的照片，未创建工程。");
  const album = structuredClone(base);
  album.pages = [album.pages[0]!];
  for (const [index, p] of plan.pages.entries()) {
    if (p.phraseIndices.some((n) => n >= phrases.length))
      throw new DomainError("Codex 引用了不存在的短语。");
    if (p.layoutId !== "custom") {
      const template = catalog.find((t) => t.id === p.layoutId);
      if (
        !template ||
        p.elements.length ||
        p.photoIndices.length > layoutCapacity(template) ||
        (expected.length > 0 && !p.photoIndices.length)
      )
        throw new DomainError("Codex 选择了无效排版或照片数量。");
      album.pages.push(
        instantiateLayout(
          template,
          album.size,
          p.photoIndices.map((n) => photos[n]!),
          stickers,
          p.phraseIndices.map((n) => phrases[n]!),
          index,
          expected.length === 0,
        ),
      );
      continue;
    }
    if (mode !== "creative" || !p.elements.length)
      throw new DomainError("固定排版模式不能使用自由版面。");
    const usedPhotos: number[] = [];
    const elements: Element[] = p.elements.map((e) => {
      const frame = { x: e.x, y: e.y, width: e.width, height: e.height };
      let element: Element;
      if (e.kind === "text") {
        if (
          e.assetIndex !== null ||
          e.text === null ||
          e.text.length > 200 ||
          e.fontSize === null ||
          e.color === null
        )
          throw new DomainError("Codex 文字元素无效。");
        const text = textElement(e.text, frame, e.fontSize);
        text.style.color = e.color;
        fitPhrase(text);
        element = text;
      } else {
        if (
          e.assetIndex === null ||
          e.text !== null ||
          e.fontSize !== null ||
          e.color !== null
        )
          throw new DomainError("Codex 图片元素无效。");
        const asset =
          e.kind === "photo" ? photos[e.assetIndex] : stickers[e.assetIndex];
        if (
          !asset ||
          (e.kind === "photo" && !p.photoIndices.includes(e.assetIndex))
        )
          throw new DomainError("Codex 图片引用无效。");
        if (e.kind === "photo") usedPhotos.push(e.assetIndex);
        element = imageElement(asset, frame, e.kind);
      }
      element.rotation = e.rotation;
      const r = (e.rotation * Math.PI) / 180,
        w =
          (Math.abs(Math.cos(r)) * e.width + Math.abs(Math.sin(r)) * e.height) /
          2,
        h =
          (Math.abs(Math.sin(r)) * e.width + Math.abs(Math.cos(r)) * e.height) /
          2;
      if (
        e.x + e.width / 2 - w < 0 ||
        e.y + e.height / 2 - h < 0 ||
        e.x + e.width / 2 + w > album.size.width ||
        e.y + e.height / 2 + h > album.size.height
      )
        throw new DomainError("Codex 版面超出页面边界。");
      return element;
    });
    if (
      usedPhotos.length !== p.photoIndices.length ||
      new Set(usedPhotos).size !== usedPhotos.length ||
      p.photoIndices.some((n) => !usedPhotos.includes(n))
    )
      throw new DomainError("自由版面遗漏或重复使用照片。");
    album.pages.push({
      id: id(),
      role: "content",
      background: album.pages[0]!.background,
      ...(album.pages[0]!.backgroundStyle
        ? { backgroundStyle: album.pages[0]!.backgroundStyle }
        : {}),
      elements,
    });
  }
  album.assets = [
    ...new Map([...photos, ...stickers].map((a) => [a.id, a])).values(),
  ];
  album.assetLibrary = {
    photos: [...new Set(photos.map((a) => a.id))],
    stickers: [...new Set(stickers.map((a) => a.id))],
  };
  if (
    stickers.length &&
    !album.pages
      .slice(1)
      .some((p) =>
        p.elements.some(
          (e) =>
            e.type === "image" &&
            e.role === "sticker" &&
            stickers.some((a) => a.id === e.assetId),
        ),
      )
  )
    throw new DomainError(
      "Codex 未使用本次选择的贴纸，未创建工程。请重新生成，或取消选择贴纸。",
    );
  assertAlbum(album);
  return album;
}
