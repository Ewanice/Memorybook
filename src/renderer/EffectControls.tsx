import {
  defaultImageEffects,
  type ImageEffects,
  type TextOutline,
} from "../domain/model";
import { imageShapeLabels, imageBorderLabels } from "../domain/image-effects";
import { CommitInput, NumberField } from "./Fields";
export function OutlineControls({
  outline,
  disabled,
  onChange,
}: {
  outline?: TextOutline;
  disabled: boolean;
  onChange: (value: TextOutline) => void;
}) {
  const value = outline ?? { enabled: false, color: "#ffffff", width: 1 };
  return (
    <details>
      <summary>文字描边</summary>
      <label className="check">
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        启用文字描边
      </label>
      {value.enabled && (
        <>
          <div className="field-row">
            <NumberField
              label="描边粗细 pt"
              min={0.2}
              max={8}
              step={0.2}
              value={value.width}
              disabled={disabled}
              onChange={(width) => onChange({ ...value, width })}
            />
            <label className="field">
              描边颜色
              <CommitInput
                type="color"
                value={value.color}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, color: e.target.value })}
              />
            </label>
          </div>
          <p className="muted">
            描边绘制在文字外围；文本框过小时请扩大文本框。
          </p>
        </>
      )}
    </details>
  );
}
export function ImageEffectControls({
  effects,
  disabled,
  onChange,
}: {
  effects?: ImageEffects;
  disabled: boolean;
  onChange: (value: ImageEffects) => void;
}) {
  const value = effects ?? defaultImageEffects;
  return (
    <details>
      <summary>边缘与边框</summary>
      <label className="field">
        裁切形状
        <select
          disabled={disabled}
          value={value.shape}
          onChange={(e) =>
            onChange({
              ...value,
              shape: e.target.value as ImageEffects["shape"],
            })
          }
        >
          {Object.entries(imageShapeLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {!["rectangle", "ellipse", "arch"].includes(value.shape) && (
        <NumberField
          label={value.shape === "rounded" ? "圆角大小 pt" : "边缘幅度 pt"}
          min={0}
          max={24}
          step={0.5}
          disabled={disabled}
          value={value.edgeSize}
          onChange={(edgeSize) => onChange({ ...value, edgeSize })}
        />
      )}
      <label className="field">
        边框样式
        <select
          disabled={disabled}
          value={value.border}
          onChange={(e) =>
            onChange({
              ...value,
              border: e.target.value as ImageEffects["border"],
            })
          }
        >
          {Object.entries(imageBorderLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {value.border !== "none" && (
        <div className="field-row">
          <NumberField
            label={value.border === "polaroid" ? "留白宽度 pt" : "边框粗细 pt"}
            min={0.2}
            max={16}
            step={0.2}
            disabled={disabled}
            value={value.borderWidth}
            onChange={(borderWidth) => onChange({ ...value, borderWidth })}
          />
          <label className="field">
            边框颜色
            <CommitInput
              type="color"
              disabled={disabled}
              value={value.borderColor}
              onChange={(e) =>
                onChange({ ...value, borderColor: e.target.value })
              }
            />
          </label>
        </div>
      )}
      <button
        disabled={disabled}
        onClick={() => onChange({ ...defaultImageEffects })}
      >
        清除边缘效果
      </button>
      <p className="muted">
        效果只改变显示，不修改原图。可与双击裁切、缩放和旋转一起使用。
      </p>
    </details>
  );
}
