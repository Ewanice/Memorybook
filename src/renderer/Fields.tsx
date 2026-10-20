import { useEffect, useRef, useState } from "react";
export function TextField({
  value,
  onSave,
  multiline = false,
  label,
  placeholder,
  disabled = false,
}: {
  value: string;
  onSave: (value: string) => void;
  multiline?: boolean;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  const composing = useRef(false);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (dirty.current) {
        dirty.current = false;
        saveRef.current(latestDraft.current);
      }
    },
    [],
  );
  function save(next: string) {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    saveRef.current(next);
  }
  const props = {
    value: draft,
    disabled,
    placeholder,
    "aria-label": label,
    "data-dirty": dirty.current,
    onCompositionStart: () => {
      composing.current = true;
      clearTimeout(timer.current);
    },
    onCompositionEnd: (
      event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      composing.current = false;
      const next = event.currentTarget.value;
      timer.current = setTimeout(() => save(next), 500);
    },
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      const next = event.target.value;
      dirty.current = true;
      setDraft(next);
      clearTimeout(timer.current);
      if (!composing.current) timer.current = setTimeout(() => save(next), 500);
    },
    onBlur: () => save(draft),
  };
  return (
    <label className="field">
      {label}
      {multiline ? <textarea {...props} rows={4} /> : <input {...props} />}
    </label>
  );
}
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(2))));
  const [dirty, setDirty] = useState(false);
  const editing = useRef(false);
  const latest = useRef({ draft, onChange, value, min, max });
  latest.current = { draft, onChange, value, min, max };
  useEffect(() => {
    if (!editing.current) setDraft(String(Number(value.toFixed(2))));
  }, [value]);
  function save() {
    if (!editing.current) return;
    const n = Number(draft);
    editing.current = false;
    setDirty(false);
    if (draft.trim() && Number.isFinite(n) && n >= min && n <= max) {
      if (n !== value) onChange(n);
    } else setDraft(String(Number(value.toFixed(2))));
  }
  useEffect(
    () => () => {
      if (editing.current) {
        const v = latest.current,
          n = Number(v.draft);
        if (
          v.draft.trim() &&
          Number.isFinite(n) &&
          n >= v.min &&
          n <= v.max &&
          n !== v.value
        )
          v.onChange(n);
      }
    },
    [],
  );
  return (
    <label className="field">
      {label}
      <input
        type="number"
        disabled={disabled}
        value={draft}
        data-dirty={dirty}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          editing.current = true;
          setDirty(true);
          setDraft(event.target.value);
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            save();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            editing.current = false;
            setDirty(false);
            setDraft(String(Number(value.toFixed(2))));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

export function CommitInput({
  value,
  onChange,
  onBlur,
  onPointerUp,
  onKeyUp,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const [draft, setDraft] = useState(value ?? "");
  const pending = useRef<React.ChangeEvent<HTMLInputElement> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    if (!pending.current) setDraft(value ?? "");
  }, [value]);
  function save() {
    clearTimeout(timer.current);
    const event = pending.current;
    pending.current = null;
    if (event) callback.current?.(event);
  }
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const event = pending.current;
      if (event) callback.current?.(event);
    },
    [],
  );
  return (
    <input
      {...props}
      value={draft}
      data-dirty={Boolean(pending.current)}
      onChange={(event) => {
        pending.current = event;
        setDraft(event.target.value);
        clearTimeout(timer.current);
        timer.current = setTimeout(save, 450);
      }}
      onPointerUp={(event) => {
        save();
        onPointerUp?.(event);
      }}
      onKeyUp={(event) => {
        save();
        onKeyUp?.(event);
      }}
      onBlur={(event) => {
        save();
        onBlur?.(event);
      }}
    />
  );
}
