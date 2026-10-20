import type { Element } from "./model";
export function elementBounds(element: Element) {
  const f = element.frame,
    r = (element.rotation * Math.PI) / 180;
  const width =
      Math.abs(Math.cos(r)) * f.width + Math.abs(Math.sin(r)) * f.height,
    height = Math.abs(Math.sin(r)) * f.width + Math.abs(Math.cos(r)) * f.height;
  return {
    x: f.x + f.width / 2 - width / 2,
    y: f.y + f.height / 2 - height / 2,
    width,
    height,
  };
}
