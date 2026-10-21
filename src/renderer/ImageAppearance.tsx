import { useId, type ReactNode } from "react";
import {
  defaultImageEffects,
  type Frame,
  type ImageEffects,
} from "../domain/model";
import { imageShapePath } from "../domain/image-effects";
export function ImageAppearance({
  frame,
  effects = defaultImageEffects,
  children,
  identifier,
}: {
  frame: Frame;
  effects?: ImageEffects;
  children: ReactNode;
  identifier: string;
}) {
  const clipId =
    "image-edge-" + identifier + "-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const path = imageShapePath(frame, effects),
    w = effects.borderWidth;
  return (
    <>
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <path d={path} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {effects.border === "polaroid" && (
          <path d={path} fill={effects.borderColor} />
        )}
        {children}
        {effects.border !== "none" && effects.border !== "polaroid" && (
          <path
            d={path}
            fill="none"
            stroke={effects.borderColor}
            strokeWidth={2 * w}
            strokeLinejoin="round"
            strokeDasharray={
              effects.border === "dashed" ? `${3 * w} ${2 * w}` : undefined
            }
          />
        )}
        {effects.border === "double" && (
          <path
            d={imageShapePath(frame, effects, w * 2.5)}
            fill="none"
            stroke={effects.borderColor}
            strokeWidth={w}
            strokeLinejoin="round"
          />
        )}
      </g>
    </>
  );
}
