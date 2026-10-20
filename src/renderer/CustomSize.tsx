import type { CreateOptions } from "../domain/templates";
import { NumberField } from "./Fields";
export function CustomSize({
  value,
  onChange,
}: {
  value: CreateOptions;
  onChange: (value: CreateOptions) => void;
}) {
  return (
    <details className="custom-size">
      <summary>自定义成品尺寸（可选）</summary>
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(value.customSize)}
          onChange={(e) => {
            const next = { ...value };
            if (e.target.checked)
              next.customSize = {
                width: (210 * 72) / 25.4,
                height: (297 * 72) / 25.4,
              };
            else delete next.customSize;
            onChange(next);
          }}
        />
        使用自定义尺寸
      </label>
      {value.customSize && (
        <div className="field-row">
          <NumberField
            label="宽度 mm"
            min={100}
            max={450}
            value={(value.customSize.width * 25.4) / 72}
            onChange={(width) =>
              onChange({
                ...value,
                customSize: {
                  ...value.customSize!,
                  width: (width * 72) / 25.4,
                },
              })
            }
          />
          <NumberField
            label="高度 mm"
            min={100}
            max={450}
            value={(value.customSize.height * 25.4) / 72}
            onChange={(height) =>
              onChange({
                ...value,
                customSize: {
                  ...value.customSize!,
                  height: (height * 72) / 25.4,
                },
              })
            }
          />
        </div>
      )}
      <p className="muted">
        支持每边 100–450 mm，排版按尺寸生成。创建后保持该尺寸。
      </p>
    </details>
  );
}
