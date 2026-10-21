import type { Album, Element, Page } from "../domain/model";
import { textLines, textInset, type MeasureText } from "../domain/text";
import { defaultImageEffects } from "../domain/model";
import { imageContentFrame } from "../domain/image-effects";
import { ImageAppearance } from "./ImageAppearance";
import { PageBackground } from "./PageBackground";
import { loadImportedFonts, failedFonts } from "./fonts";
import { useState, useEffect } from "react";
import { usedFontIds } from "../domain/fonts";
import { pageNumber } from "../domain/pagination";
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
if (!context) throw new Error("无法初始化文字布局引擎。");
export const measureText: MeasureText = (
  text,
  size,
  bold,
  fontFamily = "Noto Sans SC",
) => {
  context.font = `${bold ? 700 : 400} ${size}px "${fontFamily}", "Noto Sans SC"`;
  return context.measureText(text).width;
};
export async function ensureFonts(
  album: Pick<Album, "pages">,
  strict = false,
): Promise<void> {
  await loadImportedFonts(usedFontIds(album), strict);
  const groups = new Map<string, string[]>();
  for (const page of album.pages)
    for (const element of page.elements)
      if (element.type === "text") {
        const family = element.style.fontFamily ?? "Noto Sans SC";
        const key = `${element.style.bold ? 700 : 400} 14px "${failedFonts.has(family.replace("MemoryFont_", "")) ? "Noto Sans SC" : family}"`;
        const texts = groups.get(key) ?? [];
        texts.push(element.text);
        groups.set(key, texts);
      }
  await Promise.all(
    [...groups].map(async ([font, texts]) => {
      const faces = await document.fonts.load(font, texts.join("") || "纪念册");
      if (!faces.length)
        throw new Error("本地中文字体不可用，请重新安装软件。");
    }),
  );
}
export const assetUrl = (
  id: string,
  variant: "original" | "thumbnail" | "preview" | "share" = "thumbnail",
): string =>
  `memory://asset/${id}${variant === "original" ? "" : "?variant=" + variant}`;
export function SceneElement({
  element,
  album,
  variant = "preview",
}: {
  element: Element;
  album: Pick<Album, "assets" | "size">;
  variant?: "original" | "thumbnail" | "preview" | "share";
}) {
  const { frame: f } = element;
  const transform = `rotate(${element.rotation} ${f.x + f.width / 2} ${f.y + f.height / 2})`;
  if (!element.visible) return null;
  if (element.type === "photoSlot") {
    const slotFrame = imageContentFrame(
      f,
      element.effects ?? defaultImageEffects,
    );
    return (
      <g transform={transform} opacity={element.opacity}>
        <ImageAppearance
          frame={f}
          effects={element.effects}
          identifier={element.id}
        >
          <rect
            x={slotFrame.x}
            y={slotFrame.y}
            width={slotFrame.width}
            height={slotFrame.height}
            fill="#dbe2d6"
            stroke="#a0b292"
            strokeDasharray="4 4"
          />
          <text
            x={f.x + f.width / 2}
            y={f.y + f.height / 2}
            textAnchor="middle"
            fontSize={11}
            fill="#708665"
          >
            {element.role === "sticker" ? "＋ 贴纸" : "＋ 添加照片"}
          </text>
        </ImageAppearance>
      </g>
    );
  }
  if (element.type === "text") {
    const style = element.style;
    const inset = textInset(element);
    const x =
      style.align === "center"
        ? f.x + f.width / 2
        : style.align === "right"
          ? f.x + f.width - inset
          : f.x + inset;
    return (
      <g transform={transform} opacity={element.opacity}>
        <svg
          x={f.x}
          y={f.y}
          width={f.width}
          height={f.height}
          overflow="hidden"
        >
          <text
            xmlSpace="preserve"
            x={x - f.x}
            y={style.fontSize + inset}
            fill={style.color}
            stroke={style.outline?.enabled ? style.outline.color : undefined}
            strokeWidth={2 * inset}
            strokeLinejoin="round"
            paintOrder="stroke fill"
            fontFamily={`${style.fontFamily ?? "Noto Sans SC"}, Noto Sans SC`}
            fontSize={style.fontSize}
            fontWeight={style.bold ? 700 : 400}
            letterSpacing={style.letterSpacing ?? 0}
            textAnchor={
              style.align === "center"
                ? "middle"
                : style.align === "right"
                  ? "end"
                  : "start"
            }
          >
            {textLines(element, measureText).map((line, i) => (
              <tspan
                key={i}
                x={x - f.x}
                y={
                  style.fontSize + inset + i * style.fontSize * style.lineHeight
                }
              >
                {line || " "}
              </tspan>
            ))}
          </text>
        </svg>
      </g>
    );
  }
  const asset = album.assets.find((a) => a.id === element.assetId);
  if (!asset) return null;
  return (
    <ImageLayer
      key={element.assetId}
      asset={asset}
      element={element}
      variant={variant}
    />
  );
}
function ImageLayer({
  asset,
  element,
  variant,
}: {
  asset: import("../domain/model").Asset;
  element: import("../domain/model").ImageElement;
  variant: string;
}) {
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const refresh = () => {
      setFailed(false);
      setReload((value) => value + 1);
    };
    window.addEventListener("memorybook-assets-changed", refresh);
    return () =>
      window.removeEventListener("memorybook-assets-changed", refresh);
  }, []);
  const f = element.frame,
    c = element.crop;
  const content = imageContentFrame(f, element.effects ?? defaultImageEffects);
  const transform = `rotate(${element.rotation} ${f.x + f.width / 2} ${f.y + f.height / 2})`;
  if (failed)
    return (
      <g transform={transform}>
        <rect
          {...{ x: f.x, y: f.y, width: f.width, height: f.height }}
          fill="#eee8df"
          stroke="#b37442"
          strokeDasharray="4 3"
        />
        <text
          x={f.x + f.width / 2}
          y={f.y + f.height / 2}
          textAnchor="middle"
          fontSize={10}
          fill="#76502e"
        >
          素材失效 · 点击替换
        </text>
      </g>
    );
  return (
    <g transform={transform} opacity={element.opacity}>
      <ImageAppearance
        frame={f}
        effects={element.effects}
        identifier={element.id}
      >
        <svg
          x={content.x}
          y={content.y}
          width={content.width}
          height={content.height}
          viewBox={`${c.x * asset.width} ${c.y * asset.height} ${c.w * asset.width} ${c.h * asset.height}`}
          preserveAspectRatio={
            element.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"
          }
          overflow="hidden"
        >
          <image
            href={
              assetUrl(asset.id, variant as "preview") +
              (reload
                ? (variant === "original" ? "?" : "&") + "reload=" + reload
                : "")
            }
            onError={() => setFailed(true)}
            x="0"
            y="0"
            width={asset.width}
            height={asset.height}
          />
        </svg>
      </ImageAppearance>
    </g>
  );
}
export function Scene({
  album,
  page,
  variant = "preview",
  bleed = 0,
}: {
  album: Pick<Album, "assets" | "size"> &
    Partial<Pick<Album, "pages" | "pagination" | "theme">>;
  page: Page;
  variant?: "original" | "thumbnail" | "preview" | "share";
  bleed?: number;
}) {
  const number = pageNumber(album, page);
  const elements = [...page.elements, ...(number ? [number] : [])].map(
    (element) => (
      <SceneElement
        key={element.id}
        element={element}
        album={album}
        variant={variant}
      />
    ),
  );
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${-bleed} ${-bleed} ${album.size.width + 2 * bleed} ${album.size.height + 2 * bleed}`}
      width={album.size.width + 2 * bleed}
      height={album.size.height + 2 * bleed}
    >
      {bleed > 0 && (
        <rect
          x={-bleed}
          y={-bleed}
          width={album.size.width + 2 * bleed}
          height={album.size.height + 2 * bleed}
          fill={page.background}
        />
      )}
      <PageBackground page={page} size={album.size} />
      {elements}
    </svg>
  );
}
