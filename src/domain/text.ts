import type { TextElement } from "./model";
export type MeasureText = (
  text: string,
  fontSize: number,
  bold: boolean,
  fontFamily?: string,
) => number;
export const textInset = (element: TextElement): number =>
  element.style.outline?.enabled ? element.style.outline.width : 0;
export function textLines(
  element: TextElement,
  measure: MeasureText,
): string[] {
  const lines: string[] = [];
  for (const paragraph of element.text.split("\n")) {
    let line = "";
    for (const character of Array.from(paragraph)) {
      if (
        line &&
        measure(
          line + character,
          element.style.fontSize,
          element.style.bold,
          element.style.fontFamily,
        ) +
          Array.from(line).length * (element.style.letterSpacing ?? 0) >
          Math.max(1, element.frame.width - 2 * textInset(element))
      ) {
        lines.push(line);
        line = character;
      } else line += character;
    }
    lines.push(line);
  }
  return lines;
}
export function textOverflows(
  element: TextElement,
  measure: MeasureText,
): boolean {
  return (
    textLines(element, measure).length *
      element.style.fontSize *
      element.style.lineHeight +
      2 * textInset(element) >
    element.frame.height
  );
}
