import { PageBackground } from "./PageBackground";
import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { Album, Element, Page, Settings } from "../domain/model";
import { SceneElement } from "./Scene";
import { pageNumber } from "../domain/pagination";
type Props = {
  album: Album;
  page: Page;
  selected: string;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onBatchChange?: (elements: Element[]) => void;
  onCrop?: (element: Extract<Element, { type: "image" }>) => void;
  onSelect: (id: string) => void;
  onChange: (element: Element) => void;
  readOnly: boolean;
  settings: Settings;
  zoom: number;
};
export function Canvas({
  album,
  page,
  selected,
  selectedIds = [],
  onSelectionChange,
  onBatchChange,
  onCrop,
  onSelect,
  onChange,
  readOnly,
  settings,
  zoom,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<{
    element: Element;
    start: { x: number; y: number };
    mode: "move" | "resize" | "rotate";
  } | null>(null);
  const [draft, setDraft] = useState<Element | null>(null);
  const [groupDraft, setGroupDraft] = useState<Element[]>([]);
  const group = useRef<Element[]>([]);
  const marquee = useRef<{
    start: { x: number; y: number };
    base: string[];
  } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const draftRef = useRef<Element | null>(null);
  const selectedElement = draft ?? page.elements.find((e) => e.id === selected);
  function point(event: Pick<PointerEvent, "clientX" | "clientY">) {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * album.size.width) / rect.width,
      y: ((event.clientY - rect.top) * album.size.height) / rect.height,
    };
  }
  function begin(
    event: PointerEvent,
    element: Element,
    mode: "move" | "resize" | "rotate",
  ) {
    event.stopPropagation();
    const members =
      element.groupId && !event.altKey && onBatchChange && onSelectionChange
        ? page.elements
            .filter(
              (e) => e.groupId === element.groupId && e.visible && !e.locked,
            )
            .map((e) => e.id)
        : [element.id];
    if (event.shiftKey && onSelectionChange) {
      onSelectionChange(
        selectedIds.includes(element.id)
          ? selectedIds.filter((id) => !members.includes(id))
          : [...new Set([...selectedIds, ...members])],
      );
      return;
    }
    const selection = selectedIds.includes(element.id) ? selectedIds : members;
    if (!selectedIds.includes(element.id)) {
      if (selection.length > 1 && onSelectionChange)
        onSelectionChange(selection);
      else onSelect(element.id);
    }
    if (readOnly || element.locked) return;
    group.current =
      mode === "move"
        ? page.elements.filter((e) => selection.includes(e.id) && !e.locked)
        : [];
    gesture.current = {
      element: structuredClone(element),
      start: point(event),
      mode,
    };
    svgRef.current!.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    if (marquee.current) {
      const { start, base } = marquee.current,
        p = point(event),
        box = {
          x: Math.min(start.x, p.x),
          y: Math.min(start.y, p.y),
          width: Math.abs(start.x - p.x),
          height: Math.abs(start.y - p.y),
        };
      setSelectionBox(box);
      onSelectionChange?.([
        ...new Set([
          ...base,
          ...page.elements
            .filter(
              (e) =>
                e.visible &&
                !e.locked &&
                e.frame.x >= box.x &&
                e.frame.y >= box.y &&
                e.frame.x + e.frame.width <= box.x + box.width &&
                e.frame.y + e.frame.height <= box.y + box.height,
            )
            .map((e) => e.id),
        ]),
      ]);
      return;
    }
    const g = gesture.current;
    if (!g) return;
    const p = point(event);
    const next = structuredClone(g.element);
    if (g.mode === "move") {
      next.frame.x += p.x - g.start.x;
      next.frame.y += p.y - g.start.y;
      if (settings.snap) {
        for (const target of [
          0,
          28,
          album.size.width / 2 - next.frame.width / 2,
          album.size.width - 28 - next.frame.width,
        ])
          if (Math.abs(next.frame.x - target) < 4) next.frame.x = target;
        for (const target of [
          0,
          28,
          album.size.height / 2 - next.frame.height / 2,
          album.size.height - 28 - next.frame.height,
        ])
          if (Math.abs(next.frame.y - target) < 4) next.frame.y = target;
      }
      // Snap against neighboring elements as well as page guides.
      if (settings.snap)
        for (const other of page.elements.filter(
          (e) => e.id !== next.id && !selectedIds.includes(e.id) && e.visible,
        )) {
          for (const [axis, size] of [
            ["x", "width"],
            ["y", "height"],
          ] as const) {
            const targets = [
              other.frame[axis],
              other.frame[axis] + other.frame[size] / 2 - next.frame[size] / 2,
              other.frame[axis] + other.frame[size] - next.frame[size],
            ];
            for (const target of targets)
              if (Math.abs(next.frame[axis] - target) < 4)
                next.frame[axis] = target;
          }
        }
    } else if (g.mode === "rotate") {
      const cx = next.frame.x + next.frame.width / 2,
        cy = next.frame.y + next.frame.height / 2;
      const delta =
        ((Math.atan2(p.y - cy, p.x - cx) -
          Math.atan2(g.start.y - cy, g.start.x - cx)) *
          180) /
        Math.PI;
      next.rotation = ((g.element.rotation + delta + 540) % 360) - 180;
      if (event.shiftKey) next.rotation = Math.round(next.rotation / 15) * 15;
      else if (Math.abs(next.rotation) < 3) next.rotation = 0;
    } else {
      const angle = (-g.element.rotation * Math.PI) / 180;
      const dx = p.x - g.start.x,
        dy = p.y - g.start.y;
      const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
      const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
      next.frame.width = Math.min(
        2000,
        Math.max(12, next.frame.width + localX),
      );
      next.frame.height =
        next.type === "image"
          ? (next.frame.width * g.element.frame.height) / g.element.frame.width
          : Math.min(2000, Math.max(12, next.frame.height + localY));
      const halfX = (next.frame.width - g.element.frame.width) / 2,
        halfY = (next.frame.height - g.element.frame.height) / 2;
      const rotation = (g.element.rotation * Math.PI) / 180;
      next.frame.x +=
        halfX * Math.cos(rotation) - halfY * Math.sin(rotation) - halfX;
      next.frame.y +=
        halfX * Math.sin(rotation) + halfY * Math.cos(rotation) - halfY;
    }
    draftRef.current = next;
    if (group.current.length > 1)
      setGroupDraft(
        group.current.map((e) => ({
          ...e,
          frame: {
            ...e.frame,
            x: e.frame.x + next.frame.x - g.element.frame.x,
            y: e.frame.y + next.frame.y - g.element.frame.y,
          },
        })),
      );
    setDraft(next);
  }
  function end(commit: boolean) {
    if (marquee.current) {
      marquee.current = null;
      setSelectionBox(null);
      return;
    }
    if (commit && draftRef.current) {
      const next = draftRef.current,
        g = gesture.current!;
      if (group.current.length > 1 && onBatchChange)
        onBatchChange(
          group.current.map((e) => ({
            ...e,
            frame: {
              ...e.frame,
              x: e.frame.x + next.frame.x - g.element.frame.x,
              y: e.frame.y + next.frame.y - g.element.frame.y,
            },
          })),
        );
      else onChange(next);
    }
    gesture.current = null;
    draftRef.current = null;
    setDraft(null);
    setGroupDraft([]);
    group.current = [];
  }
  const el = selectedElement;
  return (
    <div
      className="canvas-sheet"
      style={{
        width: album.size.width * zoom,
        height: album.size.height * zoom,
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${album.size.width} ${album.size.height}`}
        className="interactive-canvas"
        onPointerDown={(event) => {
          if (readOnly) return;
          onSelect("");
          if (onSelectionChange) {
            marquee.current = {
              start: point(event),
              base: event.shiftKey ? selectedIds : [],
            };
            svgRef.current!.setPointerCapture(event.pointerId);
          }
        }}
        onPointerMove={move}
        onPointerUp={() => end(true)}
        onPointerCancel={() => end(false)}
        onDoubleClick={(event) => {
          if (readOnly) return;
          const p = point(event);
          const element = [...page.elements].reverse().find((e) => {
            if (!e.visible || e.locked) return false;
            const f = e.frame,
              cx = f.x + f.width / 2,
              cy = f.y + f.height / 2,
              r = (-e.rotation * Math.PI) / 180;
            const x = (p.x - cx) * Math.cos(r) - (p.y - cy) * Math.sin(r) + cx,
              y = (p.x - cx) * Math.sin(r) + (p.y - cy) * Math.cos(r) + cy;
            return (
              x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height
            );
          });
          if (!element) return;
          onSelect(element.id);
          if (element.type === "image") onCrop?.(element);
          if (element.type === "text")
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLTextAreaElement>('[aria-label="文字内容"]')
                ?.focus(),
            );
        }}
      >
        <PageBackground page={page} size={album.size} />
        {page.elements.map((element) => (
          <g
            key={element.id}
            onPointerDown={(event) => begin(event, element, "move")}
            style={{ cursor: readOnly || element.locked ? "default" : "move" }}
          >
            <SceneElement
              element={
                groupDraft.find((e) => e.id === element.id) ??
                (draft?.id === element.id ? draft : element)
              }
              album={album}
            />
            {element.type === "text" && element.visible && (
              <rect
                x={element.frame.x}
                y={element.frame.y}
                width={element.frame.width}
                height={element.frame.height}
                fill="transparent"
                transform={`rotate(${element.rotation} ${element.frame.x + element.frame.width / 2} ${element.frame.y + element.frame.height / 2})`}
              />
            )}
          </g>
        ))}
        {pageNumber(album, page) && (
          <g pointerEvents="none">
            <SceneElement album={album} element={pageNumber(album, page)!} />
          </g>
        )}
        {selectionBox && (
          <rect
            {...selectionBox}
            fill="#49765b18"
            stroke="#49765b"
            pointerEvents="none"
          />
        )}
        {selectedIds
          .filter((id) => id !== selected)
          .map((id) => {
            const item =
              groupDraft.find((e) => e.id === id) ??
              page.elements.find((e) => e.id === id);
            return item ? (
              <rect
                key={id}
                {...item.frame}
                fill="none"
                stroke="#49765b"
                strokeDasharray="3 2"
                pointerEvents="none"
                transform={`rotate(${item.rotation} ${item.frame.x + item.frame.width / 2} ${item.frame.y + item.frame.height / 2})`}
              />
            ) : null;
          })}
        {settings.guides && (
          <rect
            x={28}
            y={28}
            width={album.size.width - 56}
            height={album.size.height - 56}
            fill="none"
            stroke="#758d8060"
            strokeDasharray="3 4"
            strokeWidth=".5"
            pointerEvents="none"
          />
        )}
        {!readOnly && el && (
          <g
            transform={`rotate(${el.rotation} ${el.frame.x + el.frame.width / 2} ${el.frame.y + el.frame.height / 2})`}
          >
            <rect
              x={el.frame.x}
              y={el.frame.y}
              width={el.frame.width}
              height={el.frame.height}
              fill="none"
              stroke="#49765b"
              strokeWidth="1.3"
              pointerEvents="none"
            />
            {!el.locked && (
              <>
                <rect
                  x={el.frame.x + el.frame.width - 4}
                  y={el.frame.y + el.frame.height - 4}
                  width="8"
                  height="8"
                  rx="1"
                  fill="#fff"
                  stroke="#49765b"
                  style={{ cursor: "nwse-resize" }}
                  onPointerDown={(event) => begin(event, el, "resize")}
                />
                <line
                  x1={el.frame.x + el.frame.width / 2}
                  y1={el.frame.y}
                  x2={el.frame.x + el.frame.width / 2}
                  y2={el.frame.y - 18}
                  stroke="#49765b"
                  strokeWidth="1"
                  pointerEvents="none"
                />
                <circle
                  aria-label="旋转元素"
                  cx={el.frame.x + el.frame.width / 2}
                  cy={el.frame.y - 18}
                  r={4}
                  fill="#fff"
                  stroke="#49765b"
                  style={{ cursor: "grab" }}
                  onPointerDown={(event) => begin(event, el, "rotate")}
                />
              </>
            )}
          </g>
        )}
        {page.elements
          .filter(
            (e) =>
              e.visible &&
              album.annotations.some(
                (n) => n.elementId === e.id && n.status !== "applied",
              ),
          )
          .map((e, i) => (
            <g key={e.id} pointerEvents="none">
              <circle cx={e.frame.x} cy={e.frame.y} r={8} fill="#b37442" />
              <text
                x={e.frame.x}
                y={e.frame.y + 3}
                fontSize={9}
                textAnchor="middle"
                fill="white"
              >
                {i + 1}
              </text>
            </g>
          ))}
      </svg>
    </div>
  );
}
