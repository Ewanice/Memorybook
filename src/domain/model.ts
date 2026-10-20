export type Frame = { x: number; y: number; width: number; height: number };
export type Crop = { x: number; y: number; w: number; h: number };
export type TextStyle = {
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  bold: boolean;
  fontFamily?: string;
  letterSpacing?: number;
};
type BaseElement = {
  groupId?: string;
  id: string;
  name: string;
  frame: Frame;
  rotation: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
};
export type TextElement = BaseElement & {
  type: "text";
  text: string;
  style: TextStyle;
};
export type ImageElement = BaseElement & {
  type: "image";
  assetId: string;
  fit: "cover" | "contain";
  crop: Crop;
  role: "photo" | "sticker";
};
export type PhotoSlotElement = BaseElement & {
  type: "photoSlot";
  role?: "photo" | "sticker";
};
export type Element = TextElement | ImageElement | PhotoSlotElement;
export type Page = {
  id: string;
  role: "cover" | "content" | "backCover";
  background: string;
  backgroundStyle?: import("./backgrounds").BackgroundStyle;
  elements: Element[];
};
export type Asset = {
  id: string;
  name: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  bytes: number;
};
export type Annotation = {
  id: string;
  pageId: string;
  elementId: string;
  text: string;
  status: "pending" | "needsReview" | "applied" | "needsInput";
  message: string;
};
export type Album = {
  assetLibrary?: import("./asset-library").AssetLibraryIndex;
  pagination?: import("./pagination").Pagination;
  schemaVersion: 1;
  id: string;
  revision: number;
  name: string;
  updatedAt: string;
  size: { width: number; height: number };
  theme: "paper" | "live";
  pages: Page[];
  assets: Asset[];
  annotations: Annotation[];
};
export type Settings = {
  version: 1;
  zoom: 100 | 125 | 150;
  guides: boolean;
  snap: boolean;
  pageSize: "a5" | "square";
  quality: "high" | "share";
  exportDirectory: string;
  aiEnabled: boolean;
};
export const defaultSettings: Settings = {
  version: 1,
  zoom: 100,
  guides: true,
  snap: true,
  pageSize: "a5",
  quality: "high",
  exportDirectory: "",
  aiEnabled: false,
};
export type AiConfig = {
  protocol: "chat-completions" | "responses" | "anthropic";
  baseUrl: string;
  model: string;
  sendImages: boolean;
  structuredOutput: boolean;
};
export const defaultAiConfig: AiConfig = {
  protocol: "chat-completions",
  baseUrl: "https://api.openai.com/v1",
  model: "",
  sendImages: false,
  structuredOutput: false,
};
export const sizes = {
  a5: { width: 419.528, height: 595.276 },
  square: { width: 595.276, height: 595.276 },
};
export type AlbumSummary = Pick<
  Album,
  "id" | "name" | "updatedAt" | "theme"
> & { pages: number; cover: Pick<Album, "assets" | "size"> & { page: Page } };
export type TaskState = {
  status:
    "idle" | "running" | "exporting" | "succeeded" | "failed" | "cancelled";
  message: string;
  source?: "ai" | "export";
};
export type Bootstrap = {
  settings: Settings;
  development: boolean;
  albums: AlbumSummary[];
  version: string;
  aiConfig: AiConfig;
  hasAiToken: boolean;
  fonts: import("./fonts").ImportedFont[];
};
export type Edit =
  | { type: "batch"; edits: Edit[] }
  | { type: "pagination"; value: import("./pagination").Pagination }
  | { type: "replaceElement"; pageId: string; element: Element }
  | {
      type: "translateElement";
      pageId: string;
      elementId: string;
      dx: number;
      dy: number;
    }
  | {
      type: "patchElement";
      pageId: string;
      elementId: string;
      patch: ElementPatch;
    }
  | { type: "fillSlot"; pageId: string; elementId: string; assetId: string }
  | { type: "addElement"; pageId: string; element: Element }
  | { type: "removeElement"; pageId: string; elementId: string }
  | {
      type: "layer";
      pageId: string;
      elementId: string;
      direction: "up" | "down";
    }
  | { type: "addPage"; page: Page }
  | { type: "replacePage"; page: Page }
  | { type: "reorderPage"; pageId: string; beforePageId: string }
  | { type: "renameAsset"; assetId: string; name: string }
  | { type: "removeAsset"; assetId: string }
  | { type: "removePage"; pageId: string }
  | { type: "movePage"; pageId: string; direction: "up" | "down" }
  | {
      type: "background";
      pageId: string;
      color: string;
      style?: import("./backgrounds").BackgroundStyle;
      textColors?: "match" | "contrast";
    }
  | { type: "rename"; name: string }
  | {
      type: "annotation";
      pageId: string;
      elementId: string;
      text: string;
      review: boolean;
    };
export type ElementPatch = {
  groupId?: string | null;
  frame?: Partial<Frame>;
  rotation?: number;
  opacity?: number;
  locked?: boolean;
  visible?: boolean;
  text?: string;
  style?: Partial<TextStyle>;
  assetId?: string;
  fit?: ImageElement["fit"];
  crop?: Crop;
};

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
export const id = (): string => crypto.randomUUID();
export function textElement(
  text: string,
  frame: Frame,
  fontSize = 18,
): TextElement {
  return {
    id: id(),
    type: "text",
    name: text.slice(0, 16) || "文字",
    text,
    frame,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    style: {
      fontSize,
      color: "#262e2a",
      align: "left",
      lineHeight: 1.45,
      bold: false,
      fontFamily: "Noto Sans SC",
      letterSpacing: 0,
    },
  };
}
export function imageElement(
  asset: Asset,
  frame: Frame,
  role: "photo" | "sticker" = "photo",
): ImageElement {
  return {
    id: id(),
    type: "image",
    name: asset.name,
    assetId: asset.id,
    frame,
    role,
    fit: role === "sticker" ? "contain" : "cover",
    crop: { x: 0, y: 0, w: 1, h: 1 },
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
  };
}
export function elementPatch(before: Element, after: Element): ElementPatch {
  const patch: ElementPatch = {};
  for (const key of ["rotation", "opacity", "locked", "visible"] as const)
    if (before[key] !== after[key]) Object.assign(patch, { [key]: after[key] });
  for (const key of ["x", "y", "width", "height"] as const)
    if (before.frame[key] !== after.frame[key])
      patch.frame = { ...patch.frame, [key]: after.frame[key] };
  if (before.type === "text" && after.type === "text") {
    if (before.text !== after.text) patch.text = after.text;
    for (const key of [
      "fontSize",
      "color",
      "align",
      "lineHeight",
      "bold",
      "fontFamily",
      "letterSpacing",
    ] as const)
      if (before.style[key] !== after.style[key])
        patch.style = { ...patch.style, [key]: after.style[key] };
  }
  if (before.type === "image" && after.type === "image") {
    if (before.assetId !== after.assetId) patch.assetId = after.assetId;
    if (before.fit !== after.fit) patch.fit = after.fit;
    if (JSON.stringify(before.crop) !== JSON.stringify(after.crop))
      patch.crop = after.crop;
  }
  return patch;
}
