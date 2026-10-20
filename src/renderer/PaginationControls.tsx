import {
  defaultPagination,
  pagePositions,
  type Pagination,
} from "../domain/pagination";
export function PaginationControls({
  value = defaultPagination,
  onChange,
  disabled = false,
}: {
  value?: Pagination;
  onChange: (value: Pagination) => void;
  disabled?: boolean;
}) {
  return (
    <div className="pagination-controls">
      <label className="check">
        <input
          type="checkbox"
          disabled={disabled}
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        添加页码
      </label>
      {value.enabled && (
        <div className="pagination-fields">
          <label className="field">
            页码位置
            <select
              aria-label="页码位置"
              disabled={disabled}
              value={value.position}
              onChange={(e) =>
                onChange({
                  ...value,
                  position: e.target.value as Pagination["position"],
                })
              }
            >
              {Object.entries(pagePositions).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            起始页码
            <input
              aria-label="起始页码"
              disabled={disabled}
              type="number"
              min={1}
              max={9999}
              value={value.start}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1 && n <= 9999)
                  onChange({ ...value, start: n });
              }}
            />
          </label>
        </div>
      )}
      <p className="muted">封面和封底不编号；内页随页序自动更新。</p>
    </div>
  );
}
