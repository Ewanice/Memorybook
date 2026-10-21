import type { Frame, ImageEffects, Page } from "./model";
import { defaultImageEffects } from "./model";

export function scaleImageEffects(
  effects: ImageEffects,
  scale: number,
): ImageEffects {
  return {
    ...effects,
    edgeSize: Math.min(24, effects.edgeSize * scale),
    borderWidth: Math.max(0.2, Math.min(16, effects.borderWidth * scale)),
  };
}

export const imageShapeLabels: Record<ImageEffects["shape"], string> = {
  rectangle: "矩形",
  rounded: "圆角",
  ellipse: "椭圆",
  arch: "拱形",
  ticket: "票根切角",
  torn: "撕纸边缘",
  scallop: "波浪边缘",
};
export const imageBorderLabels: Record<ImageEffects["border"], string> = {
  none: "无边框",
  solid: "细边框",
  dashed: "虚线边框",
  double: "双线边框",
  polaroid: "拍立得留白",
};

// Paths are bounded by the frame: effects never enlarge the editable rectangle.
export function imageShapePath(
  f: Frame,
  effects: ImageEffects,
  inset = 0,
): string {
  const safeInset = Math.min(inset, f.width / 4, f.height / 4);
  const x = f.x + safeInset,
    y = f.y + safeInset,
    w = f.width - 2 * safeInset,
    h = f.height - 2 * safeInset;
  const r = Math.min(effects.edgeSize, w / 4, h / 4),
    right = x + w,
    bottom = y + h;
  if (effects.shape === "ellipse")
    return `M ${x} ${y + h / 2} A ${w / 2} ${h / 2} 0 1 0 ${right} ${y + h / 2} A ${w / 2} ${h / 2} 0 1 0 ${x} ${y + h / 2} Z`;
  if (effects.shape === "rounded")
    return `M ${x + r} ${y} H ${right - r} Q ${right} ${y} ${right} ${y + r} V ${bottom - r} Q ${right} ${bottom} ${right - r} ${bottom} H ${x + r} Q ${x} ${bottom} ${x} ${bottom - r} V ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
  if (effects.shape === "arch") {
    const a = Math.min(w / 2, h / 2);
    return `M ${x} ${bottom} V ${y + a} Q ${x} ${y} ${x + w / 2} ${y} Q ${right} ${y} ${right} ${y + a} V ${bottom} Z`;
  }
  if (effects.shape === "ticket")
    return `M ${x + r} ${y} H ${right - r} Q ${right - r} ${y + r} ${right} ${y + r} V ${bottom - r} Q ${right - r} ${bottom - r} ${right - r} ${bottom} H ${x + r} Q ${x + r} ${bottom - r} ${x} ${bottom - r} V ${y + r} Q ${x + r} ${y + r} ${x + r} ${y} Z`;
  if (effects.shape === "torn" || effects.shape === "scallop") {
    const points: [number, number][] = [];
    const edge = (
      length: number,
      point: (t: number, depth: number) => [number, number],
    ) => {
      const steps = Math.max(
        8,
        Math.min(80, Math.ceil(length / Math.max(4, r * 1.8))),
      );
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const d =
          effects.shape === "torn"
            ? r * [0.15, 0.65, 0.3, 0.9, 0.4, 0.75, 0.2][i % 7]!
            : r * (0.5 - 0.5 * Math.cos(i * Math.PI));
        points.push(point(t, d));
      }
    };
    edge(w, (t, d) => [x + t * w, y + d]);
    edge(h, (t, d) => [right - d, y + t * h]);
    edge(w, (t, d) => [right - t * w, bottom - d]);
    edge(h, (t, d) => [x + d, bottom - t * h]);
    if (effects.shape === "scallop") {
      const first = points[0]!,
        last = points.at(-1)!;
      return (
        `M ${(last[0] + first[0]) / 2} ${(last[1] + first[1]) / 2} ` +
        points
          .map((p, i) => {
            const n = points[(i + 1) % points.length]!;
            return `Q ${p[0]} ${p[1]} ${(p[0] + n[0]) / 2} ${(p[1] + n[1]) / 2}`;
          })
          .join(" ") +
        " Z"
      );
    }
    return (
      points.map((p, i) => `${i ? "L" : "M"} ${p[0]} ${p[1]}`).join(" ") + " Z"
    );
  }
  return `M ${x} ${y} H ${right} V ${bottom} H ${x} Z`;
}
export function imageContentFrame(frame: Frame, effects: ImageEffects): Frame {
  if (effects.border !== "polaroid") return frame;
  const edge = Math.min(
    effects.borderWidth * 2,
    frame.width * 0.12,
    frame.height * 0.12,
  );
  return {
    x: frame.x + edge,
    y: frame.y + edge,
    width: frame.width - 2 * edge,
    height: frame.height - 4 * edge,
  };
}
export function decorateLayout(page: Page, layout: string): Page {
  const treatment: Partial<Record<string, Partial<ImageEffects>>> = {
    monologue: {
      shape: "rounded",
      edgeSize: 3,
      border: "solid",
      borderWidth: 1.2,
    },
    dialogue: { border: "polaroid", borderWidth: 3 },
    fieldnotes: {
      shape: "rounded",
      edgeSize: 2,
      border: "solid",
      borderWidth: 0.8,
    },
    letter: { shape: "torn", edgeSize: 2.5, border: "solid", borderWidth: 1 },
    hero: { shape: "rounded", edgeSize: 5 },
    duo: { shape: "rounded", edgeSize: 4 },
    three: { border: "solid", borderWidth: 1.2 },
    index: { shape: "rounded", edgeSize: 2 },
    chapter: { shape: "arch" },
    ticket: {
      shape: "ticket",
      edgeSize: 7,
      border: "double",
      borderWidth: 1.2,
    },
  };
  const style = treatment[layout];
  if (style)
    for (const e of page.elements)
      if (e.type !== "text" && e.role !== "sticker")
        e.effects = {
          ...defaultImageEffects,
          ...style,
          borderColor: "#fffaf1",
        };
  return page;
}
