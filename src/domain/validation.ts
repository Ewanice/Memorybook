import Ajv from "ajv";
import { backgroundStyles } from "./backgrounds";
import type { Album, Settings, Element, AiConfig } from "./model";
import { DomainError } from "./model";
const ajv = new Ajv({ allErrors: true, strict: true });
const number = { type: "number" };
const string = { type: "string", maxLength: 20000 };
const color = { type: "string", pattern: "^#[0-9a-fA-F]{6}$" };
const ident = { type: "string", pattern: "^[a-zA-Z0-9_-]{1,80}$" };
function object(properties: Record<string, unknown>, optional: string[] = []) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties).filter(
      (key) => key !== "groupId" && !optional.includes(key),
    ),
    additionalProperties: false,
  };
}
const frame = object({
  x: { ...number, minimum: -5000, maximum: 5000 },
  y: { ...number, minimum: -5000, maximum: 5000 },
  width: { ...number, exclusiveMinimum: 0, maximum: 5000 },
  height: { ...number, exclusiveMinimum: 0, maximum: 5000 },
});
const common = {
  groupId: ident,
  id: ident,
  name: string,
  frame,
  rotation: { ...number, minimum: -360, maximum: 360 },
  opacity: { ...number, minimum: 0, maximum: 1 },
  locked: { type: "boolean" },
  visible: { type: "boolean" },
};
const imageEffects = object({
  shape: {
    enum: [
      "rectangle",
      "rounded",
      "ellipse",
      "arch",
      "ticket",
      "torn",
      "scallop",
    ],
  },
  edgeSize: { ...number, minimum: 0, maximum: 24 },
  border: { enum: ["none", "solid", "dashed", "double", "polaroid"] },
  borderWidth: { ...number, minimum: 0.2, maximum: 16 },
  borderColor: color,
});
const element = {
  oneOf: [
    object(
      {
        ...common,
        type: { const: "photoSlot" },
        role: { enum: ["photo", "sticker"] },
        effects: imageEffects,
      },
      ["role", "effects"],
    ),
    object({
      ...common,
      type: { const: "text" },
      text: string,
      style: object(
        {
          fontSize: { ...number, minimum: 4, maximum: 300 },
          color,
          align: { enum: ["left", "center", "right"] },
          lineHeight: { ...number, minimum: 0.8, maximum: 3 },
          bold: { type: "boolean" },
          fontFamily: {
            type: "string",
            pattern: "^(Noto Sans SC|Noto Serif SC|MemoryFont_[a-f0-9]{64})$",
          },
          letterSpacing: { ...number, minimum: -2, maximum: 20 },
          outline: object({
            enabled: { type: "boolean" },
            color,
            width: { ...number, minimum: 0.2, maximum: 8 },
          }),
        },
        ["fontFamily", "letterSpacing", "outline"],
      ),
    }),
    object(
      {
        ...common,
        type: { const: "image" },
        effects: imageEffects,
        assetId: ident,
        fit: { enum: ["cover", "contain"] },
        role: { enum: ["photo", "sticker"] },
        crop: object({
          x: { ...number, minimum: 0, maximum: 1 },
          y: { ...number, minimum: 0, maximum: 1 },
          w: { ...number, exclusiveMinimum: 0, maximum: 1 },
          h: { ...number, exclusiveMinimum: 0, maximum: 1 },
        }),
      },
      ["effects"],
    ),
  ],
};
const validateElement = ajv.compile(element);
const validateAlbum = ajv.compile(
  object(
    {
      schemaVersion: { const: 1 },
      id: ident,
      revision: { type: "integer", minimum: 0 },
      name: { type: "string", minLength: 1, maxLength: 120 },
      updatedAt: string,
      size: object({
        width: { ...number, minimum: 100, maximum: 2000 },
        height: { ...number, minimum: 100, maximum: 2000 },
      }),
      theme: { enum: ["paper", "live"] },
      pagination: object({
        enabled: { type: "boolean" },
        position: {
          enum: [
            "bottom-center",
            "bottom-left",
            "bottom-right",
            "top-left",
            "top-center",
            "top-right",
          ],
        },
        start: { type: "integer", minimum: 1, maximum: 9999 },
      }),
      pages: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: object(
          {
            id: ident,
            role: { enum: ["cover", "content", "backCover"] },
            background: color,
            backgroundStyle: { enum: backgroundStyles.map((s) => s.id) },
            elements: { type: "array", maxItems: 100, items: element },
          },
          ["backgroundStyle"],
        ),
      },
      assets: {
        type: "array",
        maxItems: 1000,
        items: object({
          id: { type: "string", pattern: "^[a-f0-9]{64}$" },
          name: string,
          mime: { enum: ["image/png", "image/jpeg", "image/webp"] },
          width: { type: "integer", minimum: 1, maximum: 30000 },
          height: { type: "integer", minimum: 1, maximum: 30000 },
          bytes: { type: "integer", minimum: 1, maximum: 26214400 },
        }),
      },
      assetLibrary: object({
        photos: {
          type: "array",
          maxItems: 1000,
          uniqueItems: true,
          items: { type: "string", pattern: "^[a-f0-9]{64}$" },
        },
        stickers: {
          type: "array",
          maxItems: 1000,
          uniqueItems: true,
          items: { type: "string", pattern: "^[a-f0-9]{64}$" },
        },
      }),
      annotations: {
        type: "array",
        maxItems: 10000,
        items: object({
          id: ident,
          pageId: ident,
          elementId: ident,
          text: { type: "string", maxLength: 4000 },
          status: { enum: ["pending", "needsReview", "applied", "needsInput"] },
          message: string,
        }),
      },
    },
    ["pagination", "assetLibrary"],
  ),
);
const validateSettings = ajv.compile(
  object(
    {
      version: { const: 1 },
      displayName: {
        type: "string",
        minLength: 1,
        maxLength: 24,
        pattern: "\\S",
      },
      accentColor: color,
      homeBackground: { type: "string", pattern: "^([a-f0-9]{64})?$" },
      homeBackgroundOpacity: { type: "number", minimum: 0, maximum: 1 },
      homeBackgroundScale: { type: "number", minimum: 1, maximum: 4 },
      zoom: { enum: [100, 125, 150] },
      guides: { type: "boolean" },
      snap: { type: "boolean" },
      pageSize: { enum: ["a5", "square"] },
      quality: { enum: ["high", "share"] },
      exportDirectory: { type: "string", maxLength: 4096 },
      aiEnabled: { type: "boolean" },
    },
    [
      "displayName",
      "accentColor",
      "homeBackground",
      "homeBackgroundOpacity",
      "homeBackgroundScale",
    ],
  ),
);
const validateAiConfig = ajv.compile(
  object({
    protocol: { enum: ["chat-completions", "responses", "anthropic"] },
    baseUrl: { type: "string", minLength: 1, maxLength: 2048 },
    model: { type: "string", maxLength: 160 },
    sendImages: { type: "boolean" },
    structuredOutput: { type: "boolean" },
  }),
);
export function assertAiConfig(value: unknown): asserts value is AiConfig {
  if (!validateAiConfig(value)) throw new DomainError("AI 设置格式不正确。");
  const config = value as AiConfig;
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new DomainError("请输入完整的 API Base URL。");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new DomainError(
      "远程 API 必须使用 HTTPS，且地址不能包含账号、查询参数或片段。",
    );
  if (config.protocol === "anthropic" && config.structuredOutput)
    throw new DomainError("Anthropic 协议请关闭严格结构化输出选项。");
}
export function assertElement(value: unknown): asserts value is Element {
  if (!validateElement(value))
    throw new DomainError("元素数据不合法，请检查尺寸、颜色和内容。");
}
export function assertSettings(value: unknown): asserts value is Settings {
  if (!validateSettings(value)) throw new DomainError("设置格式或版本无效。");
}
export function assertAlbum(value: unknown): asserts value is Album {
  if (!validateAlbum(value))
    throw new DomainError(
      `工程结构无效：${validateAlbum.errors?.[0]?.instancePath || "文档"}。`,
    );
  const album = value as Album;
  const ids = new Set<string>();
  const assetIds = new Set(album.assets.map((a) => a.id));
  if (assetIds.size !== album.assets.length)
    throw new DomainError("素材编号重复。");
  if (
    album.assetLibrary &&
    [...album.assetLibrary.photos, ...album.assetLibrary.stickers].some(
      (id) => !assetIds.has(id),
    )
  )
    throw new DomainError("素材分类引用不存在。");
  for (const [index, page] of album.pages.entries()) {
    if (ids.has(page.id)) throw new DomainError("页面编号重复。");
    ids.add(page.id);
    if (
      (index === 0) !== (page.role === "cover") ||
      (page.role === "backCover" && index !== album.pages.length - 1)
    )
      throw new DomainError("封面或封底的位置不正确。");
    for (const el of page.elements) {
      if (ids.has(el.id)) throw new DomainError("元素编号重复。");
      ids.add(el.id);
      if (
        el.type === "image" &&
        (!assetIds.has(el.assetId) ||
          el.crop.x + el.crop.w > 1.000001 ||
          el.crop.y + el.crop.h > 1.000001)
      )
        throw new DomainError("图片引用或裁切范围不正确。");
    }
  }
  const targets = new Set<string>();
  for (const note of album.annotations) {
    if (ids.has(note.id) || targets.has(note.elementId))
      throw new DomainError("批注重复。");
    ids.add(note.id);
    targets.add(note.elementId);
    if (
      !album.pages
        .find((p) => p.id === note.pageId)
        ?.elements.some((e) => e.id === note.elementId)
    )
      throw new DomainError("批注目标不存在。");
  }
}
