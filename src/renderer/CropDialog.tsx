import { useRef, useState } from "react";
import type { Album, ImageElement } from "../domain/model";
import { SceneElement } from "./Scene";
import { imageContentFrame, scaleImageEffects } from "../domain/image-effects";
import { defaultImageEffects } from "../domain/model";
export function CropDialog({
  album,
  element,
  onClose,
  onApply,
}: {
  album: Album;
  element: ImageElement;
  onClose: () => void;
  onApply: (element: ImageElement) => void;
}) {
  const [value, setValue] = useState(element);
  const gesture = useRef<{
    x: number;
    y: number;
    crop: ImageElement["crop"];
  } | null>(null);
  const width = 440,
    height = Math.min(
      480,
      (width * element.frame.height) / element.frame.width,
    );
  const asset = album.assets.find((a) => a.id === element.assetId)!;
  const previewEffects = scaleImageEffects(
    value.effects ?? defaultImageEffects,
    Math.min(width / element.frame.width, height / element.frame.height),
  );
  const content = imageContentFrame(
    { x: 0, y: 0, width, height },
    previewEffects,
  );
  return (
    <div className="modal-backdrop">
      <section
        className="crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="照片取景"
      >
        <header>
          <h2>拖动照片调整取景</h2>
          <button onClick={onClose}>取消</button>
        </header>
        <p className="muted">拖动画面选择保留的位置，使用滑块调整放大程度。</p>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          onPointerDown={(event) => {
            gesture.current = {
              x: event.clientX,
              y: event.clientY,
              crop: value.crop,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const g = gesture.current;
            if (!g) return;
            const scale = Math.max(
              content.width / (asset.width * g.crop.w),
              content.height / (asset.height * g.crop.h),
            );
            setValue({
              ...value,
              crop: {
                ...g.crop,
                x: Math.max(
                  0,
                  Math.min(
                    1 - g.crop.w,
                    g.crop.x - (event.clientX - g.x) / (asset.width * scale),
                  ),
                ),
                y: Math.max(
                  0,
                  Math.min(
                    1 - g.crop.h,
                    g.crop.y - (event.clientY - g.y) / (asset.height * scale),
                  ),
                ),
              },
            });
          }}
          onPointerUp={() => {
            gesture.current = null;
          }}
          onPointerCancel={() => {
            gesture.current = null;
          }}
        >
          <SceneElement
            album={album}
            element={{
              ...value,
              rotation: 0,
              effects: previewEffects,
              frame: { x: 0, y: 0, width, height },
            }}
          />
        </svg>
        <label className="field">
          放大取景
          <input
            aria-label="取景缩放"
            type="range"
            min="1"
            max="4"
            step="0.01"
            value={1 / value.crop.w}
            onChange={(event) => {
              const w = 1 / Number(event.target.value);
              setValue({
                ...value,
                crop: {
                  w,
                  h: w,
                  x: Math.max(
                    0,
                    Math.min(1 - w, value.crop.x + (value.crop.w - w) / 2),
                  ),
                  y: Math.max(
                    0,
                    Math.min(1 - w, value.crop.y + (value.crop.h - w) / 2),
                  ),
                },
              });
            }}
          />
        </label>
        <button className="primary" onClick={() => onApply(value)}>
          应用取景
        </button>
      </section>
    </div>
  );
}
