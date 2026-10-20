import type { PrintOptions } from "../domain/export-options";
import { NumberField } from "./Fields";
export function ExportControls({
  pages,
  value,
  onChange,
}: {
  pages: number;
  value: PrintOptions;
  onChange: (value: PrintOptions) => void;
}) {
  return (
    <details className="print-controls">
      <summary>导出范围与印刷</summary>
      <p className="muted">
        默认导出整本。照片较多时可按页分段导出，降低内存占用；页码保持原来的编号。
      </p>
      <NumberField
        label="起始页"
        min={1}
        max={pages}
        value={value.fromPage ?? 1}
        onChange={(fromPage) => onChange({ ...value, fromPage })}
      />
      <NumberField
        label="结束页（0 表示最后一页）"
        min={0}
        max={pages}
        value={value.toPage ?? 0}
        onChange={(toPage) =>
          onChange({ ...value, toPage: toPage || undefined })
        }
      />
      <NumberField
        label="出血尺寸 mm"
        min={0}
        max={10}
        step={0.5}
        value={value.bleedMm ?? 0}
        onChange={(bleedMm) => onChange({ ...value, bleedMm })}
      />
      <small className="muted">
        家用 PDF 保持 0；印刷可设 3
        mm。将照片手动延伸到裁切线外，底色会延展至出血区。PDF
        写入裁切与出血边界，输出采用 RGB；交付印厂前请确认其要求。
      </small>
    </details>
  );
}
