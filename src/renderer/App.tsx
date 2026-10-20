import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Album,
  Element as AlbumElement,
  Asset,
  Bootstrap,
  Edit,
  Page,
  TaskState,
} from "../domain/model";
import { imageElement, textElement, elementPatch } from "../domain/model";
import {
  createPage,
  templateLabels,
  suggestedPageCount,
  defaultCreateOptions,
  layoutCatalog,
  type CreateOptions,
  type TemplateName,
} from "../domain/templates";
import { Scene, assetUrl, measureText, ensureFonts } from "./Scene";
import { Canvas } from "./Canvas";
import { Inspector } from "./Inspector";
import { FontContext, loadImportedFonts } from "./fonts";
import { usedFontIds } from "../domain/fonts";
import { SettingsDialog } from "./Settings";
import { Comparison } from "./Comparison";
import { AssetLibrary } from "./AssetLibrary";
import { ResourceLibrary } from "./ResourceLibrary";
import type { LibraryContent } from "../shared/api";
import { textOverflows } from "../domain/text";
import type { LayoutTemplate } from "../domain/layouts";
import type { CodexStatus } from "../infrastructure/codex-bridge";
import type { GenerationState } from "../application/generation";
import { TemplateEditor } from "./TemplateEditor";
import { SelectionTools } from "./SelectionTools";
import { CropDialog } from "./CropDialog";
import { BookStyle } from "./BookStyle";
import { LazyScene } from "./LazyScene";
import { elementBounds } from "../domain/geometry";
import { exportSelection, type PrintOptions } from "../domain/export-options";
import { ExportControls } from "./ExportControls";
import { CustomSize } from "./CustomSize";
import { SpreadPreview } from "./SpreadPreview";
import { reflowPage } from "../domain/reflow";
import { instantiateLayout } from "../domain/layouts";
import { PaginationControls } from "./PaginationControls";
import { sizes, id } from "../domain/model";
import "./styles.css";

const api = window.memorybook;
export function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [album, setAlbum] = useState<Album | null>(null);
  const current = useRef<Album | null>(null);
  const [pageId, setPageId] = useState("");
  const [selected, setPrimary] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const clipboard = useRef<AlbumElement[]>([]);
  function setSelected(id: string) {
    setPrimary(id);
    setSelectedIds(id ? [id] : []);
  }
  const [layoutPreview, setLayoutPreview] = useState<{
    before: Page;
    after: Page[];
  } | null>(null);
  const [exportReview, setExportReview] = useState<{
    revision: number;
    issues: {
      pageId: string;
      elementId: string;
      message: string;
      blocking: boolean;
    }[];
  } | null>(null);
  const [cropElement, setCropElement] = useState<Extract<
    AlbumElement,
    { type: "image" }
  > | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("通用");
  const [templateEditor, setTemplateEditor] = useState<LayoutTemplate | null>(
    null,
  );
  const [templateDraft, setTemplateDraft] = useState<LayoutTemplate | null>(
    null,
  );
  const [pageNumbersOpen, setPageNumbersOpen] = useState(false);
  useEffect(() => {
    const refreshFonts = () => {
      void api
        .fonts()
        .then(async (fonts) => {
          await loadImportedFonts(fonts.map((f) => f.id));
          setData((value) => (value ? { ...value, fonts } : value));
        })
        .catch((e) => report(e.message));
    };
    window.addEventListener("memorybook-fonts-changed", refreshFonts);
    return () =>
      window.removeEventListener("memorybook-fonts-changed", refreshFonts);
  }, []);
  const [codex, setCodex] = useState<CodexStatus | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationState>(
    { status: "idle", message: "" },
  );
  const [newOpen, setNewOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [resources, setResources] = useState<LibraryContent | null>(null);
  const [stickerIds, setStickerIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [theme, setTheme] = useState<Album["theme"]>("paper");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(0);
  const [saveError, setSaveError] = useState(false);
  const [drawer, setDrawer] = useState<
    "none" | "assets" | "templates" | "notes"
  >("none");
  const [assetMode, setAssetMode] = useState<"photo" | "sticker" | "replace">(
    "photo",
  );
  const [zoom, setZoom] = useState(0.9);
  const [preview, setPreview] = useState(false);
  const [printOptions, setPrintOptions] = useState<PrintOptions>({});
  const [task, setTask] = useState<TaskState>({ status: "idle", message: "" });
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [newOptions, setNewOptions] = useState<CreateOptions>({
    ...defaultCreateOptions,
    layout: "random",
    usePhrases: true,
    randomSeed: 1,
    generator: "local",
    codexMode: "templates",
  });
  const [applyLayout, setApplyLayout] = useState(false);
  const [comparison, setComparison] = useState<{
    before: Album;
    after: Album;
  } | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pendingEdits = useRef<Edit[]>([]);
  const saveFailed = useRef(false);
  const report = useCallback((message: string) => setError(message), []);
  useEffect(() => {
    const warning = (event: Event) =>
      report((event as CustomEvent<string>).detail);
    const changed = () => {
      void refresh().catch((e) => report(e.message));
    };
    window.addEventListener("memorybook-resource-warning", warning);
    window.addEventListener("memorybook-data-changed", changed);
    return () => {
      window.removeEventListener("memorybook-resource-warning", warning);
      window.removeEventListener("memorybook-data-changed", changed);
    };
  }, []);
  const refresh = useCallback(async () => {
    const boot = await api.bootstrap();
    await loadImportedFonts([
      ...new Set(
        boot.albums.flatMap((a) => usedFontIds({ pages: [a.cover.page] })),
      ),
    ]).catch((error) => report(error.message));
    setData(boot);
    setResources(await api.resources());
    setTemplateDraft(await api.templateDraft());
    const issues = await api.health();
    if (issues.length)
      report(
        `发现 ${issues.length} 项资源异常，正常内容可继续使用。请在“设置 → 备份与恢复”查看详情与恢复副本。`,
      );
  }, []);
  async function beginNew() {
    setResources(await api.resources());
    setAssets([]);
    setStickerIds([]);
    setName("");
    setCity("");
    setNewOpen(true);
    setNewOptions((value) => ({
      ...value,
      layout: "random",
      randomSeed: crypto.getRandomValues(new Uint32Array(1))[0]!,
    }));
    void api
      .codexStatus()
      .then(setCodex)
      .catch((e) => report(e.message));
  }
  useEffect(() => {
    if (!data) return;
    const refreshStatus = () => {
      void api
        .codexStatus()
        .then(setCodex)
        .catch((e) => report(e.message));
    };
    refreshStatus();
    const timer = setInterval(refreshStatus, 30000);
    return () => clearInterval(timer);
  }, [data !== null]);
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => {
      void api
        .generationState()
        .then(setGenerationProgress)
        .catch((e) => report(e.message));
    }, 800);
    return () => clearInterval(timer);
  }, [generating]);
  useEffect(() => {
    void refresh().catch((e) => report(String(e.message)));
  }, [refresh, report]);
  useEffect(() => {
    const preventClose = (event: BeforeUnloadEvent) => {
      if (
        pendingEdits.current.length ||
        document.querySelector('[data-dirty="true"]')
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", preventClose);
    return () => window.removeEventListener("beforeunload", preventClose);
  }, []);
  function adopt(value: Album) {
    current.current = value;
    setAlbum(value);
    void ensureFonts(value)
      .then(() =>
        setAlbum((latest) =>
          latest?.id === value.id && latest.revision === value.revision
            ? { ...latest }
            : latest,
        ),
      )
      .catch((error) => report(error.message));
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      report(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  async function load(value: Album) {
    setPrintOptions({});
    const fonts = await api.fonts();
    setData((data) => (data ? { ...data, fonts } : data));
    const restoredTask = await api.task(value.id);
    adopt(value);
    setPageId(value.pages[0]!.id);
    setSelected("");
    setTask(restoredTask);
    setDrawer("none");
    setSaveError(false);
    saveFailed.current = false;
    pendingEdits.current = [];
  }
  function commit(edit: Edit) {
    pendingEdits.current.push(edit);
    setSaving((v) => v + 1);
    queue.current = queue.current.then(async () => {
      if (!current.current) return;
      if (saveFailed.current) {
        setSaving((v) => Math.max(0, v - 1));
        return;
      }
      const next = pendingEdits.current[0];
      if (!next) return;
      try {
        const result = await api.edit(
          current.current.id,
          current.current.revision,
          next,
        );
        pendingEdits.current.shift();
        adopt(result.album);
        if (result.status === "rejected") report(result.message);
        setSaveError(false);
      } catch (e) {
        saveFailed.current = true;
        setSaveError(true);
        report(e instanceof Error ? e.message : "保存失败，当前修改仍待重试。");
      } finally {
        setSaving((v) => Math.max(0, v - 1));
      }
    });
  }
  async function retrySave() {
    await queue.current;
    while (pendingEdits.current.length && current.current) {
      const edit = pendingEdits.current[0]!;
      const result = await api.edit(
        current.current.id,
        current.current.revision,
        edit,
      );
      adopt(result.album);
      if (result.status === "rejected") report(result.message);
      pendingEdits.current.shift();
    }
    saveFailed.current = false;
    setSaveError(false);
    setSaving(0);
  }
  const page = album?.pages.find((p) => p.id === pageId) ?? album?.pages[0];
  const element = page?.elements.find((e) => e.id === selected);
  const libraryRole =
    assetMode === "sticker" ||
    (assetMode === "replace" &&
      (element?.type === "image" || element?.type === "photoSlot") &&
      element.role === "sticker")
      ? "sticker"
      : "photo";
  const locked = busy || task.status === "running" || saveError;
  useEffect(() => {
    if (!album || !["running", "exporting"].includes(task.status)) return;
    const timer = setInterval(() => {
      void api
        .task(album.id)
        .then(async (state) => {
          setTask(state);
          if (state.status !== "running") adopt(await api.open(album.id));
        })
        .catch((e) => report(e.message));
    }, 1200);
    return () => clearInterval(timer);
  }, [album?.id, task.status, report]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        settingsOpen ||
        newOpen ||
        comparison ||
        preview ||
        templateEditor ||
        pageNumbersOpen ||
        layoutPreview ||
        cropElement ||
        exportReview
      )
        return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        locked ||
        !current.current
      )
        return;
      const targets =
        page?.elements.filter((e) => selectedIds.includes(e.id) && !e.locked) ??
        [];
      if (
        page &&
        (event.ctrlKey || event.metaKey) &&
        ["a", "c", "v", "d", "g"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        const key = event.key.toLowerCase();
        if (key === "a") {
          const ids = page.elements
            .filter((e) => e.visible && !e.locked)
            .map((e) => e.id);
          setSelectedIds(ids);
          setPrimary(ids[0] ?? "");
          return;
        }
        if (key === "g") {
          const ids = selectedIds.filter(
            (id) => page.elements.find((e) => e.id === id)?.locked !== true,
          );
          if (ids.length) {
            const groupId = event.shiftKey ? null : crypto.randomUUID();
            commit({
              type: "batch",
              edits: ids.map((id) => ({
                type: "patchElement",
                pageId: page.id,
                elementId: id,
                patch: { groupId },
              })),
            });
          }
          return;
        }
        if (key === "c") {
          clipboard.current = structuredClone(targets);
          report(`已复制 ${targets.length} 个元素，可切换页面粘贴。`);
          return;
        }
        const source = key === "d" ? targets : clipboard.current;
        if (!source.length) return;
        if (
          source.some(
            (e) =>
              e.type === "image" &&
              !album?.assets.some((a) => a.id === e.assetId),
          )
        ) {
          report("复制的照片不在当前纪念册，请先导入该照片。");
          return;
        }
        const groups = new Map<string, string>();
        const copies = source.map((e) => {
          if (e.groupId && !groups.has(e.groupId))
            groups.set(e.groupId, crypto.randomUUID());
          return {
            ...structuredClone(e),
            ...(e.groupId ? { groupId: groups.get(e.groupId)! } : {}),
            id: crypto.randomUUID(),
            frame: { ...e.frame, x: e.frame.x + 8, y: e.frame.y + 8 },
          };
        });
        commit({
          type: "batch",
          edits: copies.map((element) => ({
            type: "addElement",
            pageId: page.id,
            element,
          })),
        });
        setSelectedIds(copies.map((e) => e.id));
        setPrimary(copies[0]!.id);
        return;
      }
      if (
        page &&
        targets.length &&
        (event.key === "Delete" ||
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          ))
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        commit({
          type: "batch",
          edits: targets.map((element) =>
            event.key === "Delete"
              ? {
                  type: "removeElement",
                  pageId: page.id,
                  elementId: element.id,
                }
              : {
                  type: "translateElement",
                  pageId: page.id,
                  elementId: element.id,
                  dx:
                    event.key === "ArrowLeft"
                      ? -step
                      : event.key === "ArrowRight"
                        ? step
                        : 0,
                  dy:
                    event.key === "ArrowUp"
                      ? -step
                      : event.key === "ArrowDown"
                        ? step
                        : 0,
                },
          ),
        });
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        ["z", "y"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        const direction =
          event.shiftKey || event.key.toLowerCase() === "y" ? "redo" : "undo";
        setSaving((value) => value + 1);
        queue.current = queue.current
          .then(async () => {
            if (saveFailed.current || !current.current) return;
            const a = current.current;
            adopt(await api.history(a.id, a.revision, direction));
          })
          .catch((error) => report(error.message))
          .finally(() => setSaving((value) => Math.max(0, value - 1)));
        return;
      }
      if (event.key === "Escape") setSelected("");
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "d" &&
        page &&
        element
      ) {
        event.preventDefault();
        const copy = structuredClone(element);
        copy.id = crypto.randomUUID();
        copy.frame.x += 8;
        copy.frame.y += 8;
        commit({ type: "addElement", pageId: page.id, element: copy });
        setSelected(copy.id);
      }
      if (event.key === "Delete" && page && element && !element.locked) {
        event.preventDefault();
        commit({
          type: "removeElement",
          pageId: page.id,
          elementId: element.id,
        });
      }
      if (
        page &&
        element &&
        !element.locked &&
        !event.ctrlKey &&
        !event.metaKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        commit({
          type: "translateElement",
          pageId: page.id,
          elementId: element.id,
          dx:
            event.key === "ArrowLeft"
              ? -step
              : event.key === "ArrowRight"
                ? step
                : 0,
          dy:
            event.key === "ArrowUp"
              ? -step
              : event.key === "ArrowDown"
                ? step
                : 0,
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  async function importImages(forNew: boolean) {
    const stickerImport = !forNew && libraryRole === "sticker";
    const result = await (stickerImport
      ? api.importStickers()
      : api.importPhotos());
    if (result.assets.length)
      window.dispatchEvent(new Event("memorybook-assets-changed"));
    if (result.failures.length) report(result.failures.join("\n"));
    if (forNew)
      setAssets((existing) => [
        ...new Map(
          [...existing, ...result.assets].map((a) => [a.id, a]),
        ).values(),
      ]);
    else if (current.current && result.assets.length) {
      await queue.current;
      const a = current.current;
      adopt(
        stickerImport
          ? await api.addLibraryStickers(
              a.id,
              a.revision,
              result.assets.map((a) => a.id),
            )
          : await api.addAssets(a.id, a.revision, result.assets),
      );
      if (stickerImport) setResources(await api.resources());
    }
  }
  async function placeAsset(asset: Asset) {
    await queue.current;
    const book = current.current;
    if (!book) return;
    if (!book.assets.some((a) => a.id === asset.id))
      adopt(await api.addLibraryStickers(book.id, book.revision, [asset.id]));
    addAsset(asset);
  }
  function addAsset(asset: Asset) {
    if (!album || !page || locked) return;
    const slot =
      element?.type === "photoSlot" &&
      (assetMode === "replace" ||
        (element.role === "sticker") === (assetMode === "sticker"))
        ? element
        : assetMode !== "replace"
          ? page.elements.find(
              (e) =>
                e.type === "photoSlot" &&
                !e.locked &&
                (e.role === "sticker") === (assetMode === "sticker"),
            )
          : undefined;
    if (slot) {
      commit({
        type: "fillSlot",
        pageId: page.id,
        elementId: slot.id,
        assetId: asset.id,
      });
      setSelected(slot.id);
    } else if (assetMode === "replace" && element?.type === "image")
      commit({
        type: "patchElement",
        pageId: page.id,
        elementId: element.id,
        patch: { assetId: asset.id, crop: { x: 0, y: 0, w: 1, h: 1 } },
      });
    else {
      const w = assetMode === "sticker" ? 80 : album.size.width * 0.6;
      const el = imageElement(
        asset,
        {
          x: 36,
          y: 50,
          width: w,
          height: Math.min(
            album.size.height * 0.6,
            (w * asset.height) / asset.width,
          ),
        },
        assetMode === "sticker" ? "sticker" : "photo",
      );
      commit({ type: "addElement", pageId: page.id, element: el });
      setSelected(el.id);
    }
  }
  async function exportPdf(confirmed = false) {
    await queue.current;
    const a = current.current!;
    if (pendingEdits.current.length)
      throw new Error("有未保存修改，请先重试保存。");
    const selection = exportSelection(a, printOptions);
    const missing = await api.checkResources(
      a.id,
      selection.pages.map((p) => p.id),
    );
    const issues: {
      pageId: string;
      elementId: string;
      message: string;
      blocking: boolean;
    }[] = [];
    selection.pages.forEach((p) =>
      p.elements
        .filter((e) => e.visible)
        .forEach((el) => {
          const add = (message: string, blocking = false) =>
            issues.push({
              pageId: p.id,
              elementId: el.id,
              message: `第 ${a.pages.findIndex((page) => page.id === p.id) + 1} 页 · ${el.name}：${message}`,
              blocking,
            });
          if (el.type === "photoSlot") add("照片或贴纸位置尚未填入", true);
          if (el.type === "text" && textOverflows(el, measureText))
            add("文字超出文本框");
          if (
            el.type === "text" &&
            missing.fonts.some(
              (id) => el.style.fontFamily === "MemoryFont_" + id,
            )
          )
            add("字体缺失或损坏，请重新导入或更换字体", true);
          const bounds = elementBounds(el);
          if (
            bounds.x < -selection.bleed - 0.01 ||
            bounds.y < -selection.bleed - 0.01 ||
            bounds.x + bounds.width > a.size.width + selection.bleed + 0.01 ||
            bounds.y + bounds.height > a.size.height + selection.bleed + 0.01
          )
            add("旋转后的元素超出页面");
          if (el.type === "image") {
            if (missing.assets.includes(el.assetId))
              add("原图缺失或损坏，请重新导入原文件或替换", true);
            const asset = a.assets.find((s) => s.id === el.assetId)!;
            if (
              Math.min(
                (asset.width * el.crop.w) / el.frame.width,
                (asset.height * el.crop.h) / el.frame.height,
              ) *
                72 <
              150
            )
              add("图片在当前尺寸下可能不够清晰");
          }
        }),
    );
    if (issues.length && (!confirmed || issues.some((i) => i.blocking))) {
      setExportReview({ revision: a.revision, issues });
      return;
    }
    const path = await api.exportPdf({
      albumId: a.id,
      revision: a.revision,
      quality: data!.settings.quality,
      ...printOptions,
    });
    if (path) report(`PDF 已保存：${path}`);
  }
  function chooseLayout(template: LayoutTemplate) {
    if (!album || !page) return;
    if (applyLayout && page.role === "content") {
      try {
        setLayoutPreview({
          before: page,
          after: reflowPage(album, page, template),
        });
      } catch (e) {
        report(e instanceof Error ? e.message : "无法套用排版");
      }
    } else {
      const p = instantiateLayout(template, album.size, [], [], [], 0, true);
      commit({ type: "addPage", page: p });
      setPageId(p.id);
      setSelected("");
      setDrawer("none");
    }
  }
  if (!data)
    return (
      <main className="startup">
        <div className="brand large">
          拾页<span>MEMORYBOOK</span>
        </div>
        <p>{error || "正在打开你的创作空间…"}</p>
        {error && (
          <>
            <button
              onClick={() => void refresh().catch((e) => report(e.message))}
            >
              重试
            </button>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "仅在设置损坏时重置。损坏副本会保留，项目和 AI 凭证不会删除。",
                  )
                )
                  void run(async () => {
                    await api.repairSettings();
                    await refresh();
                  });
              }}
            >
              修复损坏设置
            </button>
          </>
        )}
      </main>
    );
  const notice = error && (
    <div className="notice" role="status">
      <span>{error}</span>
      <button onClick={() => setError("")} aria-label="关闭提示">
        ×
      </button>
    </div>
  );
  return (
    <FontContext.Provider value={data.fonts ?? []}>
      <div
        className="app"
        style={
          { "--ui-scale": data.settings.zoom / 100 } as React.CSSProperties
        }
      >
        {!album ? (
          <>
            <header className="home-header">
              <div className="brand">
                拾页<span>MEMORYBOOK</span>
              </div>
              <div className="button-row">
                {templateDraft && (
                  <button onClick={() => setTemplateEditor(templateDraft)}>
                    恢复未保存排版
                  </button>
                )}
                <button
                  className={
                    "codex-badge " +
                    (codex?.ready
                      ? "ready"
                      : codex?.connected
                        ? "waiting"
                        : "disconnected")
                  }
                  title={codex?.message ?? "正在自动检测本地 Codex"}
                  onClick={() => {
                    setSettingsTab("本地 Codex");
                    setSettingsOpen(true);
                  }}
                >
                  <i />
                  <span>
                    Codex{" "}
                    <strong>
                      {codex?.ready
                        ? "已连接"
                        : codex?.connected
                          ? "待登录"
                          : codex
                            ? "未连接"
                            : "检测中"}
                    </strong>
                  </span>
                  <span className="badge-arrow">↗</span>
                </button>
                <span className="offline">
                  <i /> 本地创作
                </span>
                <button
                  onClick={() =>
                    void run(async () => {
                      await refresh();
                      setSettingsOpen(true);
                    })
                  }
                >
                  设置
                </button>
              </div>
            </header>
            <main className="library">
              <div className="library-heading">
                <div>
                  <p className="eyebrow">留住值得记住的瞬间</p>
                  <h1>
                    我的纪念册
                    <span>
                      {data.albums.length.toString().padStart(2, "0")}
                    </span>
                  </h1>
                  <p className="muted">
                    从一张照片开始，慢慢拼成属于你的故事。
                  </p>
                </div>
                <div className="button-row">
                  <button
                    className="materials-jump"
                    onClick={() =>
                      document
                        .querySelector(".resource-library")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                  >
                    贴纸 · 短语 · 排版 ↓
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const a = await api.restore();
                        if (a) await load(a);
                      })
                    }
                  >
                    导入工程
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void run(beginNew)}
                  >
                    ＋ 新建纪念册
                  </button>
                </div>
              </div>
              <div className="album-grid">
                <button
                  className="new-album-tile"
                  disabled={busy}
                  onClick={() => void run(beginNew)}
                >
                  <span>＋</span>
                  <strong>新的一本，新的回忆</strong>
                  <small>选择照片 · 挑选风格 · 开始创作</small>
                </button>
                {data.albums.map((a) => (
                  <article className="album-card" key={a.id}>
                    <button
                      className={`album-cover ${a.theme}`}
                      onClick={() =>
                        void run(async () => load(await api.open(a.id)))
                      }
                    >
                      <div className="cover-art">
                        <Scene
                          album={a.cover}
                          page={a.cover.page}
                          variant="thumbnail"
                        />
                      </div>
                    </button>
                    <div className="album-info">
                      <div>
                        <strong>{a.name}</strong>
                        <small>
                          {a.pages} 页 ·{" "}
                          {new Date(a.updatedAt).toLocaleDateString("zh-CN")}
                        </small>
                      </div>
                      <button
                        aria-label={`复制 ${a.name}`}
                        onClick={() =>
                          void run(async () => {
                            await api.duplicateAlbum(a.id);
                            await refresh();
                          })
                        }
                      >
                        复制
                      </button>
                      <button
                        aria-label={`删除 ${a.name}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `将“${a.name}”移至最近删除？可以在设置的资料保护与恢复中恢复。`,
                            )
                          )
                            void run(async () => {
                              await api.deleteAlbum(a.id);
                              await refresh();
                            });
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!data.albums.length && (
                <p className="library-footnote">
                  从演唱会、旅行到平凡日常，每一段回忆都有它的位置。
                </p>
              )}
              <ResourceLibrary
                content={resources}
                editPhrases={() => {
                  setSettingsTab("短语库");
                  setSettingsOpen(true);
                }}
                newLayout={() => {
                  const page = createPage(sizes.a5, "paper", "hero");
                  setTemplateEditor({
                    id: id(),
                    name: "我的新排版",
                    size: sizes.a5,
                    page,
                    phraseIds: page.elements
                      .filter((e) => e.type === "text")
                      .map((e) => e.id),
                  });
                }}
                editLayout={(template) =>
                  setTemplateEditor(
                    template.id.startsWith("builtin-")
                      ? {
                          ...structuredClone(template),
                          id: id(),
                          name: template.name + " · 我的排版",
                        }
                      : structuredClone(template),
                  )
                }
                removeLayout={(key) => {
                  if (window.confirm("删除此排版？已有纪念册不受影响。"))
                    void run(async () => {
                      await api.removeLayout(key);
                      setResources(await api.resources());
                    });
                }}
                busy={busy}
                upload={() =>
                  void run(async () => {
                    const result = await api.importStickers();
                    if (result.assets.length)
                      window.dispatchEvent(
                        new Event("memorybook-assets-changed"),
                      );
                    setResources(await api.resources());
                    if (result.failures.length)
                      report(result.failures.join("\n"));
                  })
                }
                remove={(id) => {
                  if (window.confirm("移出贴纸库？已有纪念册里的贴纸会保留。"))
                    void run(async () => {
                      await api.removeSticker(id);
                      setResources(await api.resources());
                    });
                }}
                reload={() =>
                  void run(async () => setResources(await api.resources()))
                }
                open={() => void run(() => api.openPhrases())}
              />
            </main>
          </>
        ) : (
          page && (
            <>
              <header className="editor-header">
                <button
                  className="back-button"
                  disabled={
                    saving > 0 ||
                    saveError ||
                    busy ||
                    task.status === "running" ||
                    task.status === "exporting"
                  }
                  onClick={() =>
                    void run(async () => {
                      await queue.current;
                      current.current = null;
                      setAlbum(null);
                      await refresh();
                    })
                  }
                >
                  ‹ 我的纪念册
                </button>
                <div className="project-title">
                  <button
                    className="rename-project"
                    disabled={locked}
                    onClick={() => {
                      const value = window.prompt("纪念册名称", album.name);
                      if (value?.trim())
                        commit({ type: "rename", name: value });
                    }}
                  >
                    {album.name}
                  </button>
                  <small className={saveError ? "warning" : ""}>
                    {saveError
                      ? "尚未保存"
                      : saving
                        ? "保存中…"
                        : "已保存在本机"}
                    {saveError && (
                      <button onClick={() => void run(retrySave)}>重试</button>
                    )}
                  </small>
                </div>
                <div className="editor-actions">
                  <button
                    disabled={locked || saving > 0}
                    onClick={() =>
                      void run(async () => {
                        const a = current.current!;
                        adopt(await api.history(a.id, a.revision, "undo"));
                      })
                    }
                  >
                    撤销
                  </button>
                  <button
                    disabled={locked || saving > 0}
                    onClick={() =>
                      void run(async () => {
                        const a = current.current!;
                        adopt(await api.history(a.id, a.revision, "redo"));
                      })
                    }
                  >
                    重做
                  </button>
                  <button
                    disabled={
                      locked || saving > 0 || task.status === "exporting"
                    }
                    onClick={() =>
                      void run(async () => {
                        await queue.current;
                        if (pendingEdits.current.length)
                          throw new Error("请先重试保存尚未完成的修改。");
                        await api.startAi(album.id);
                        setInspectorOpen(false);
                        setTask(await api.task(album.id));
                      })
                    }
                  >
                    统一 AI 修改
                    {album.annotations.some((n) => n.status === "pending")
                      ? ` (${album.annotations.filter((n) => n.status === "pending").length})`
                      : ""}
                  </button>
                  <button
                    disabled={locked}
                    onClick={() => setPageNumbersOpen(true)}
                  >
                    页码
                  </button>
                  <span className="divider" />
                  <button
                    className="inspector-toggle"
                    onClick={() => setInspectorOpen(!inspectorOpen)}
                  >
                    属性
                  </button>
                  <button onClick={() => setPreview(!preview)}>
                    {preview ? "继续编辑" : "预览"}
                  </button>
                  <button
                    onClick={() =>
                      void run(async () => {
                        await refresh();
                        setSettingsOpen(true);
                      })
                    }
                  >
                    设置
                  </button>
                  <button
                    className="primary"
                    disabled={
                      locked || saving > 0 || task.status === "exporting"
                    }
                    onClick={() => {
                      setTask({
                        status: "exporting",
                        message: "正在导出当前已保存版本，您可以继续编辑。",
                      });
                      void exportPdf()
                        .catch((error) => report(error.message))
                        .finally(() => {
                          const id = current.current?.id;
                          if (id)
                            void api
                              .task(id)
                              .then(setTask)
                              .catch((error) => report(error.message));
                        });
                    }}
                  >
                    {task.status === "exporting" ? "正在导出…" : "导出 PDF ↗"}
                  </button>
                </div>
              </header>
              <div className="workbench">
                <aside className="page-rail">
                  <div className="rail-title">
                    页面<span>{album.pages.length}</span>
                  </div>
                  <div className="page-list">
                    {album.pages.map((p, i) => (
                      <button
                        draggable={!locked && p.role === "content"}
                        onDragStart={(event) =>
                          event.dataTransfer.setData("text/plain", p.id)
                        }
                        onDragOver={(event) => {
                          if (!locked && p.role !== "cover")
                            event.preventDefault();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const id = event.dataTransfer.getData("text/plain");
                          if (id && !locked)
                            commit({
                              type: "reorderPage",
                              pageId: id,
                              beforePageId: p.id,
                            });
                        }}
                        key={p.id}
                        className={`page-thumb ${page.id === p.id ? "selected" : ""}`}
                        onClick={() => {
                          setPageId(p.id);
                          setSelected("");
                        }}
                      >
                        <div className="thumbnail">
                          <LazyScene album={album} page={p} />
                        </div>
                        <span>
                          {i === 0
                            ? "封面"
                            : p.role === "backCover"
                              ? "封底"
                              : `第 ${i + 1} 页`}
                        </span>
                      </button>
                    ))}
                  </div>
                  <button
                    disabled={locked}
                    className="add-page"
                    onClick={() =>
                      setDrawer(drawer === "templates" ? "none" : "templates")
                    }
                  >
                    ＋ 添加页面
                  </button>
                </aside>
                <section className="workspace">
                  <div className="canvas-toolbar">
                    <div className="button-row">
                      <button
                        disabled={locked || preview}
                        onClick={() => {
                          setAssetMode("photo");
                          setDrawer("assets");
                        }}
                      >
                        ＋ 照片
                      </button>
                      <button
                        disabled={locked || preview}
                        onClick={() => {
                          setAssetMode("sticker");
                          setDrawer("assets");
                        }}
                      >
                        ＋ 贴纸
                      </button>
                      <button
                        disabled={locked || preview}
                        onClick={() => {
                          const el = textElement(
                            "写下这一刻",
                            { x: 40, y: 60, width: 240, height: 70 },
                            24,
                          );
                          commit({
                            type: "addElement",
                            pageId: page.id,
                            element: el,
                          });
                          setSelected(el.id);
                          setInspectorOpen(true);
                        }}
                      >
                        ＋ 文字
                      </button>
                    </div>
                    <button
                      onClick={() =>
                        setDrawer(drawer === "notes" ? "none" : "notes")
                      }
                    >
                      批注{" "}
                      {album.annotations.filter((n) => n.status !== "applied")
                        .length || ""}
                    </button>
                  </div>
                  {task.status !== "idle" && (
                    <div className={`task-banner ${task.status}`}>
                      <span>{task.message}</span>
                      {task.status === "exporting" && (
                        <button
                          onClick={() =>
                            void api
                              .cancelExport(album.id)
                              .catch((e) => report(e.message))
                          }
                        >
                          取消导出
                        </button>
                      )}
                      {task.status === "succeeded" && task.source === "ai" && (
                        <button
                          onClick={() =>
                            void run(async () => {
                              const value = await api.comparison(album.id);
                              if (value) setComparison(value);
                              else report("当前没有 AI 修改记录。");
                            })
                          }
                        >
                          查看修改前后
                        </button>
                      )}
                      {task.status === "running" && (
                        <button
                          onClick={() =>
                            void run(async () => {
                              await api.cancelAi(album.id);
                              setTask(await api.task(album.id));
                            })
                          }
                        >
                          取消修改
                        </button>
                      )}
                    </div>
                  )}
                  {drawer !== "none" && (
                    <div className="drawer">
                      <div className="drawer-header">
                        <strong>
                          {drawer === "assets"
                            ? assetMode === "replace"
                              ? "选择替换图片"
                              : assetMode === "sticker"
                                ? "你的贴纸"
                                : "你的照片"
                            : drawer === "templates"
                              ? "添加页面"
                              : "整本批注"}
                        </strong>
                        <button onClick={() => setDrawer("none")}>
                          收起 ×
                        </button>
                      </div>
                      {drawer === "assets" && (
                        <>
                          <button
                            disabled={locked}
                            onClick={() => void run(() => importImages(false))}
                          >
                            {libraryRole === "sticker"
                              ? "上传贴纸"
                              : "从电脑导入照片"}
                          </button>
                          {libraryRole === "sticker" && (
                            <p className="muted">
                              首页贴纸库与本册贴纸，点击即可加入当前页。
                            </p>
                          )}
                          <AssetLibrary
                            key={libraryRole}
                            album={album}
                            role={libraryRole}
                            stickers={resources?.stickers ?? []}
                            disabled={locked}
                            onAdd={(asset) => void run(() => placeAsset(asset))}
                            edit={commit}
                          />
                        </>
                      )}
                      {drawer === "templates" && (
                        <>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={applyLayout}
                              disabled={page.role !== "content"}
                              onChange={(event) =>
                                setApplyLayout(event.target.checked)
                              }
                            />
                            套用到当前页（替换当前元素）
                          </label>
                          <div className="template-grid">
                            {(
                              Object.keys(templateLabels) as TemplateName[]
                            ).map((layout) => (
                              <button
                                disabled={locked}
                                key={layout}
                                onClick={() =>
                                  chooseLayout(
                                    layoutCatalog(album.size, album.theme).find(
                                      (t) => t.id === "builtin-" + layout,
                                    ) ?? {
                                      id: "builtin-" + layout,
                                      name: templateLabels[layout],
                                      size: album.size,
                                      page: createPage(
                                        album.size,
                                        album.theme,
                                        layout,
                                      ),
                                      phraseIds: [],
                                    },
                                  )
                                }
                              >
                                <span className={`layout-preview ${layout}`}>
                                  <Scene
                                    album={album}
                                    page={createPage(
                                      album.size,
                                      album.theme,
                                      layout,
                                    )}
                                    variant="thumbnail"
                                  />
                                </span>
                                {templateLabels[layout]}
                              </button>
                            ))}
                          </div>
                          <div className="template-grid">
                            {resources?.layouts.map((template) => (
                              <button
                                key={template.id}
                                disabled={locked}
                                onClick={() => chooseLayout(template)}
                              >
                                <span className="layout-preview">
                                  <Scene
                                    album={{ size: template.size, assets: [] }}
                                    page={template.page}
                                    variant="thumbnail"
                                  />
                                </span>
                                {template.name}
                              </button>
                            ))}
                          </div>
                          <button
                            className="wide"
                            disabled={
                              locked ||
                              album.pages.some((p) => p.role === "backCover")
                            }
                            onClick={() => {
                              const p = createPage(
                                album.size,
                                album.theme,
                                "ending",
                              );
                              p.role = "backCover";
                              commit({ type: "addPage", page: p });
                              setPageId(p.id);
                              setDrawer("none");
                            }}
                          >
                            添加封底
                          </button>
                        </>
                      )}
                      {drawer === "notes" && (
                        <>
                          <div className="notes-list">
                            {album.annotations.map((n) => (
                              <button
                                key={n.id}
                                onClick={() => {
                                  setPageId(n.pageId);
                                  setSelected(n.elementId);
                                }}
                              >
                                <span>
                                  第{" "}
                                  {album.pages.findIndex(
                                    (p) => p.id === n.pageId,
                                  ) + 1}{" "}
                                  页 ·{" "}
                                  {
                                    {
                                      pending: "待提交",
                                      needsReview: "需复核",
                                      applied: "已应用",
                                      needsInput: "需说明",
                                    }[n.status]
                                  }
                                </span>
                                <strong>{n.text}</strong>
                                {n.message && <small>{n.message}</small>}
                              </button>
                            ))}
                          </div>
                          {!album.annotations.length && (
                            <p className="muted">
                              选中任意元素，在右侧写下修改意见。
                            </p>
                          )}
                          <button
                            disabled={locked}
                            onClick={() =>
                              void run(async () => {
                                const value = await api.comparison(album.id);
                                if (value) setComparison(value);
                                else report("当前保留的历史中没有 AI 修改。");
                              })
                            }
                          >
                            查看最近 AI 修改
                          </button>
                          <button
                            className="primary"
                            disabled={
                              locked ||
                              saving > 0 ||
                              task.status === "exporting" ||
                              !album.annotations.some(
                                (n) => n.status === "pending",
                              )
                            }
                            onClick={() =>
                              void run(async () => {
                                await queue.current;
                                if (pendingEdits.current.length)
                                  throw new Error(
                                    "请先重试保存尚未完成的修改。",
                                  );
                                await api.startAi(album.id);
                                setInspectorOpen(false);
                                setTask(await api.task(album.id));
                              })
                            }
                          >
                            统一 AI 修改
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  <SelectionTools
                    page={page}
                    ids={selectedIds}
                    disabled={locked}
                    edit={commit}
                  />
                  <div className="canvas-scroller">
                    {preview ? (
                      <SpreadPreview
                        album={album}
                        pageId={page.id}
                        zoom={zoom}
                        onPage={setPageId}
                      />
                    ) : (
                      <Canvas
                        onCrop={setCropElement}
                        selectedIds={selectedIds}
                        onSelectionChange={(ids) => {
                          setSelectedIds(ids);
                          setPrimary(ids[0] ?? "");
                        }}
                        onBatchChange={(elements) =>
                          commit({
                            type: "batch",
                            edits: elements.map((element) => ({
                              type: "replaceElement",
                              pageId: page.id,
                              element,
                            })),
                          })
                        }
                        album={album}
                        page={page}
                        selected={selected}
                        onSelect={(id) => {
                          setSelected(id);
                          if (id) setInspectorOpen(true);
                        }}
                        onChange={(el) => {
                          const before = page.elements.find(
                            (e) => e.id === el.id,
                          );
                          if (before)
                            commit({
                              type: "patchElement",
                              pageId: page.id,
                              elementId: el.id,
                              patch: elementPatch(before, el),
                            });
                        }}
                        readOnly={locked}
                        settings={data.settings}
                        zoom={zoom}
                      />
                    )}
                  </div>
                  <footer className="canvas-footer">
                    <span>
                      {album.pages.indexOf(page) + 1} / {album.pages.length} 页
                      <span className="separator">·</span>
                      {data.settings.pageSize === "square" &&
                      album.size.width === album.size.height
                        ? "方形"
                        : "单页设计"}
                    </span>
                    <div className="button-row">
                      <button
                        onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}
                      >
                        −
                      </button>
                      <span>{Math.round(zoom * 100)}%</span>
                      <button
                        onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
                      >
                        ＋
                      </button>
                      <button onClick={() => setZoom(0.9)}>适应</button>
                    </div>
                  </footer>
                </section>
                {!preview && (
                  <div
                    className={`right-column ${inspectorOpen ? "mobile-open" : ""}`}
                    style={{ top: task.status === "idle" ? 125 : 165 }}
                  >
                    <Inspector
                      key={page.id + ":" + selected}
                      album={album}
                      page={page}
                      element={element}
                      edit={commit}
                      disabled={locked}
                      onReplace={() => {
                        setAssetMode("replace");
                        setDrawer("assets");
                      }}
                    />
                    <div className="layers">
                      <details>
                        <summary>图层 · {page.elements.length}</summary>
                        {[...page.elements].reverse().map((el) => (
                          <button
                            key={el.id}
                            className={selected === el.id ? "active" : ""}
                            onClick={() => setSelected(el.id)}
                          >
                            {el.type === "text" ? "T" : "▧"}{" "}
                            <span>{el.name || "文字"}</span>
                            {el.locked && "锁定"}
                          </button>
                        ))}
                      </details>
                      <details>
                        <summary>页面与工程</summary>
                        <button
                          className="wide"
                          disabled={locked}
                          onClick={() =>
                            void run(async () => {
                              const value = await api.comparison(album.id);
                              if (value) setComparison(value);
                              else report("当前没有 AI 修改记录。");
                            })
                          }
                        >
                          查看最近 AI 修改
                        </button>
                        <div className="button-row">
                          <button
                            disabled={locked}
                            onClick={() => {
                              const copy: Page = {
                                ...structuredClone(page),
                                id: crypto.randomUUID(),
                                role: "content",
                                elements: page.elements.map((e) => ({
                                  ...structuredClone(e),
                                  id: crypto.randomUUID(),
                                })),
                              };
                              commit({ type: "addPage", page: copy });
                            }}
                          >
                            复制页面
                          </button>
                          <button
                            disabled={locked || page.role === "cover"}
                            onClick={() => {
                              if (
                                window.confirm("删除当前页及其批注？可以撤销。")
                              )
                                commit({ type: "removePage", pageId: page.id });
                            }}
                          >
                            删除页面
                          </button>
                        </div>
                        <div className="button-row">
                          <button
                            disabled={locked || album.pages.indexOf(page) < 2}
                            onClick={() =>
                              commit({
                                type: "movePage",
                                pageId: page.id,
                                direction: "up",
                              })
                            }
                          >
                            页面前移
                          </button>
                          <button
                            disabled={
                              locked ||
                              page.role === "cover" ||
                              album.pages.indexOf(page) ===
                                album.pages.length - 1
                            }
                            onClick={() =>
                              commit({
                                type: "movePage",
                                pageId: page.id,
                                direction: "down",
                              })
                            }
                          >
                            页面后移
                          </button>
                        </div>
                        <ExportControls
                          pages={album.pages.length}
                          value={printOptions}
                          onChange={setPrintOptions}
                        />
                        <BookStyle
                          album={album}
                          disabled={locked || saving > 0}
                          edit={commit}
                        />
                        <button
                          disabled={locked || saving > 0}
                          className="wide"
                          onClick={() =>
                            void run(async () => {
                              const path = await api.backup(album.id);
                              if (path) {
                                const issue = (await api.health()).find(
                                  (i) => i.key === `backup:${album.id}`,
                                );
                                report(
                                  `工程已备份：${path}${issue ? "\n" + issue.message : ""}`,
                                );
                              }
                            })
                          }
                        >
                          备份可编辑工程
                        </button>
                      </details>
                    </div>
                  </div>
                )}
              </div>
            </>
          )
        )}
        {newOpen && (
          <div className="modal-backdrop">
            <section
              className="new-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="新建纪念册"
            >
              <header>
                <div>
                  <p className="eyebrow">一个故事，从这里开始</p>
                  <h2>新建纪念册</h2>
                </div>
                <button disabled={busy} onClick={() => setNewOpen(false)}>
                  关闭 ×
                </button>
              </header>
              <div className="new-body" inert={generating}>
                <div className="new-form">
                  <label className="field">
                    给它一个名字
                    <input
                      autoFocus
                      value={name}
                      maxLength={120}
                      placeholder="例如：明日世界"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    城市或一句短语 <small>选填</small>
                    <input
                      value={city}
                      maxLength={120}
                      placeholder="北京"
                      onChange={(e) => setCity(e.target.value)}
                    />
                  </label>
                  <label className="field">选择风格</label>
                  <div className="theme-options">
                    <button
                      className={theme === "paper" ? "selected" : ""}
                      onClick={() => setTheme("paper")}
                    >
                      <span className="swatch paper" />
                      留白影集<small>温暖纸色 · 自然留白</small>
                    </button>
                    <button
                      className={theme === "live" ? "selected" : ""}
                      onClick={() => setTheme("live")}
                    >
                      <span className="swatch live" />
                      现场档案<small>深色底片 · 暖黄文字</small>
                    </button>
                  </div>
                  <details>
                    <summary>生成选项</summary>
                    <label className="field">
                      封面方式
                      <select
                        value={newOptions.coverMode}
                        onChange={(event) =>
                          setNewOptions({
                            ...newOptions,
                            coverMode: event.target
                              .value as CreateOptions["coverMode"],
                          })
                        }
                      >
                        <option value="photo">
                          照片封面 · 标题与角标可编辑
                        </option>
                        <option value="complete">
                          完整封面图片 · 不重复叠字
                        </option>
                      </select>
                    </label>
                  </details>
                  <p className="muted">
                    {newOptions.customSize
                      ? `${Math.round((newOptions.customSize.width * 25.4) / 72)} × ${Math.round((newOptions.customSize.height * 25.4) / 72)} mm`
                      : data.settings.pageSize === "a5"
                        ? "A5 竖版"
                        : "方形"}{" "}
                    · {newOptions.generator === "codex" ? "本地参考" : "共"}{" "}
                    {suggestedPageCount(
                      assets.length,
                      newOptions.density,
                      newOptions.layout,
                      newOptions.randomSeed,
                      resources?.layouts,
                    )}{" "}
                    页
                    {newOptions.generator === "codex"
                      ? "，最终页数由 Codex 确定"
                      : ""}{" "}
                    · 每个元素都可以修改
                  </p>
                </div>
                <div className="photo-picker">
                  <button
                    className="upload-area"
                    disabled={busy}
                    onClick={() => void run(() => importImages(true))}
                  >
                    <span>＋</span>
                    <strong>
                      {assets.length ? "继续添加照片" : "选择你的照片"}
                    </strong>
                    <small>JPEG、PNG、WebP · 单张最大 25 MB</small>
                  </button>
                  <div className="picked-photos">
                    {assets.map((a, i) => (
                      <div key={a.id}>
                        <img src={assetUrl(a.id)} alt={a.name} />
                        <span>{i === 0 ? "封面" : i + 1}</span>
                        <button
                          aria-label={`移除 ${a.name}`}
                          onClick={() =>
                            setAssets((values) =>
                              values.filter((v) => v.id !== a.id),
                            )
                          }
                        >
                          ×
                        </button>
                        {i > 0 && (
                          <button
                            className="photo-move"
                            title="向前移动"
                            onClick={() =>
                              setAssets((values) => {
                                const copy = [...values];
                                [copy[i - 1], copy[i]] = [
                                  copy[i]!,
                                  copy[i - 1]!,
                                ];
                                return copy;
                              })
                            }
                          >
                            ←
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="muted">
                    第一张用作封面；也可以不选照片，从空白开始。
                  </p>
                </div>
              </div>
              <div className="generation-materials" inert={generating}>
                <div className="section-label">
                  <CustomSize value={newOptions} onChange={setNewOptions} />
                  <h3>选择排版</h3>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={newOptions.usePhrases ?? false}
                      onChange={(e) =>
                        setNewOptions({
                          ...newOptions,
                          usePhrases: e.target.checked,
                        })
                      }
                    />
                    使用短语库 · {resources?.phrases.length ?? 0} 句
                  </label>
                </div>
                {resources?.phraseError && (
                  <p className="warning">
                    {resources.phraseError} 请先在首页修复，或关闭短语排版。
                  </p>
                )}
                <p className="muted">
                  全部 {11 + (resources?.layouts.length ?? 0)}{" "}
                  个照片排版参与生成。每轮打乱后逐个使用，减少重复；自定义排版保存后自动加入。
                </p>
                <div className="composition-options composition-catalog">
                  {layoutCatalog(
                    newOptions.customSize ?? sizes[data.settings.pageSize],
                    theme,
                    resources?.layouts,
                  ).map((t) => (
                    <div className="composition-card" key={t.id}>
                      <div>
                        <Scene
                          album={{ size: t.size, assets: [] }}
                          page={t.page}
                          variant="thumbnail"
                        />
                      </div>
                      <strong>{t.name}</strong>
                    </div>
                  ))}
                </div>
                <PaginationControls
                  value={newOptions.pagination}
                  onChange={(pagination) =>
                    setNewOptions({ ...newOptions, pagination })
                  }
                />
                <label className="field">
                  生成方式
                  <select
                    aria-label="生成方式"
                    value={newOptions.generator ?? "local"}
                    disabled={generating}
                    onChange={(e) =>
                      setNewOptions({
                        ...newOptions,
                        generator: e.target.value as "local" | "codex",
                      })
                    }
                  >
                    <option value="local">本地自动排版 · 无需联网</option>
                    <option value="codex">调用本地 Codex 生成</option>
                  </select>
                </label>
                {newOptions.generator === "codex" && (
                  <div className="codex-generation-options">
                    <p role="status">
                      {codex?.message ?? "正在检测本地 Codex…"}
                    </p>
                    <button
                      disabled={generating}
                      onClick={() =>
                        void api
                          .reconnectCodex()
                          .then(setCodex)
                          .catch((e) => report(e.message))
                      }
                    >
                      重新检测 Codex
                    </button>
                    <label className="field">
                      Codex 设计方式
                      <select
                        aria-label="Codex 设计方式"
                        value={newOptions.codexMode ?? "templates"}
                        onChange={(e) =>
                          setNewOptions({
                            ...newOptions,
                            codexMode: e.target.value as
                              "templates" | "creative",
                          })
                        }
                      >
                        <option value="templates">使用固定排版 · 更快</option>
                        <option value="creative">
                          自由设计 · 可参考设置中的 skill
                        </option>
                      </select>
                    </label>
                    <p className="muted">
                      固定模式不发送原图，自由设计会提供最多 8
                      张缩略图。使用本机 Codex 登录和默认模型；提示词、模型与
                      skill 可在设置中调整，可能消耗额度。
                    </p>
                  </div>
                )}
                <div className="section-label">
                  <h3>
                    本次使用的贴纸 <small>{stickerIds.length} 张</small>
                  </h3>
                  <span className="muted">可不选；有贴纸时按页轮流排入</span>
                </div>
                <div className="sticker-selection">
                  {resources?.stickers.map((a) => (
                    <button
                      key={a.id}
                      aria-pressed={stickerIds.includes(a.id)}
                      className={stickerIds.includes(a.id) ? "selected" : ""}
                      onClick={() =>
                        setStickerIds((ids) =>
                          ids.includes(a.id)
                            ? ids.filter((id) => id !== a.id)
                            : [...ids, a.id],
                        )
                      }
                    >
                      <img src={assetUrl(a.id)} alt={a.name} />
                      <span>{a.name}</span>
                      <small>
                        {stickerIds.includes(a.id) ? "已选择 ✓" : "选择"}
                      </small>
                    </button>
                  ))}
                  {!resources?.stickers.length && (
                    <p className="muted">
                      还没有贴纸，可先回首页上传；也可以生成后再添加。
                    </p>
                  )}
                </div>
                {!!resources?.stickers.length && (
                  <div className="button-row">
                    <button
                      onClick={() =>
                        setStickerIds(resources.stickers.map((a) => a.id))
                      }
                    >
                      全选贴纸
                    </button>
                    <button
                      disabled={!stickerIds.length}
                      onClick={() => setStickerIds([])}
                    >
                      清空选择
                    </button>
                    <span className="muted">
                      {stickerIds.length
                        ? `已选 ${stickerIds.length} 张贴纸供排版使用`
                        : "尚未选择贴纸，本次自动生成不会排入贴纸。"}
                    </span>
                  </div>
                )}
                {newOptions.layout === "auto" && (
                  <p className="muted">
                    基础网格也会搭配纸张、短语和已选贴纸，生成后均可编辑。
                  </p>
                )}
              </div>
              <footer>
                <span>
                  {generating
                    ? generationProgress.message
                    : `${assets.length} 张照片 · ${newOptions.generator === "codex" ? "由本地 Codex 生成" : "完全本地处理"}`}
                </span>
                {generating && newOptions.generator === "codex" && (
                  <button
                    onClick={() =>
                      void api
                        .cancelGeneration()
                        .catch((e) => report(e.message))
                    }
                  >
                    取消生成
                  </button>
                )}
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setGenerating(true);
                      setGenerationProgress({
                        status: "running",
                        message: "正在生成…",
                      });
                      try {
                        const a = await api.create({
                          name,
                          city,
                          theme,
                          pageSize: data.settings.pageSize,
                          assets,
                          options: newOptions,
                          stickerIds,
                        });
                        await load(a);
                        setNewOpen(false);
                      } finally {
                        setGenerating(false);
                      }
                    })
                  }
                >
                  {busy ? "正在生成…" : "生成纪念册 →"}
                </button>
              </footer>
            </section>
          </div>
        )}
        {layoutPreview && album && (
          <div className="modal-backdrop">
            <section
              className="comparison-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="套用排版预览"
            >
              <header>
                <h2>套用排版预览</h2>
                <button onClick={() => setLayoutPreview(null)}>取消</button>
              </header>
              <p className="muted">
                保留照片、贴纸和文字。照片位置不足时自动拆成{" "}
                {layoutPreview.after.length}{" "}
                页；多余文字与贴纸保留原位置，请检查是否重叠。整次套用可以撤销。
              </p>
              <div className="comparison-pages">
                <div>
                  <h4>原页面</h4>
                  <Scene album={album} page={layoutPreview.before} />
                </div>
                <div>
                  <h4>新排版</h4>
                  {layoutPreview.after.map((p) => (
                    <Scene key={p.id} album={album} page={p} />
                  ))}
                </div>
              </div>
              <footer>
                <button
                  className="primary"
                  disabled={locked}
                  onClick={() => {
                    const [first, ...rest] = layoutPreview.after;
                    const following =
                      album.pages[
                        album.pages.findIndex(
                          (p) => p.id === layoutPreview.before.id,
                        ) + 1
                      ];
                    commit({
                      type: "batch",
                      edits: [
                        ...rest.map((page) => ({
                          type: "addPage" as const,
                          page,
                        })),
                        ...(following
                          ? rest.map((page) => ({
                              type: "reorderPage" as const,
                              pageId: page.id,
                              beforePageId: following.id,
                            }))
                          : []),
                        { type: "replacePage", page: first! },
                      ],
                    });
                    setLayoutPreview(null);
                    setSelected("");
                    setDrawer("none");
                  }}
                >
                  确认套用
                </button>
              </footer>
            </section>
          </div>
        )}
        {exportReview && album && (
          <div className="modal-backdrop">
            <section
              className="export-review"
              role="dialog"
              aria-modal="true"
              aria-label="导出检查"
            >
              <header>
                <h2>导出前检查</h2>
                <button onClick={() => setExportReview(null)}>关闭</button>
              </header>
              <p className="muted">
                点击问题可定位到对应元素。资源缺失或空图片位置需要先处理，其他提醒可检查后继续导出。
              </p>
              <div className="export-issues">
                {exportReview.issues.map((issue, i) => (
                  <button
                    key={i}
                    className={issue.blocking ? "warning" : ""}
                    onClick={() => {
                      setPageId(issue.pageId);
                      setSelected(issue.elementId);
                      setExportReview(null);
                    }}
                  >
                    {issue.blocking ? "需修复" : "提醒"} · {issue.message} ↗
                  </button>
                ))}
              </div>
              <button
                className="primary"
                disabled={exportReview.issues.some((i) => i.blocking)}
                onClick={() => {
                  if (current.current?.revision !== exportReview.revision) {
                    setExportReview(null);
                    report("工程已变化，请重新导出以检查最新内容。");
                    return;
                  }
                  setExportReview(null);
                  setTask({ status: "exporting", message: "正在生成 PDF…" });
                  void exportPdf(true)
                    .catch((e) => report(e.message))
                    .finally(
                      () =>
                        void api
                          .task(album.id)
                          .then(setTask)
                          .catch((e) => report(e.message)),
                    );
                }}
              >
                检查后继续导出
              </button>
            </section>
          </div>
        )}
        {cropElement && album && page && (
          <CropDialog
            album={album}
            element={cropElement}
            onClose={() => setCropElement(null)}
            onApply={(element) => {
              commit({ type: "replaceElement", pageId: page.id, element });
              setCropElement(null);
            }}
          />
        )}
        {settingsOpen && (
          <SettingsDialog
            data={data}
            initialTab={settingsTab}
            onClose={() => {
              setSettingsOpen(false);
              void api
                .resources()
                .then(setResources)
                .catch((e) => report(e.message));
              void api
                .codexStatus()
                .then(setCodex)
                .catch((e) => report(e.message));
            }}
            report={report}
            onUpdate={(settings) => setData({ ...data, settings })}
          />
        )}
        {templateEditor && (
          <TemplateEditor
            initial={templateEditor}
            onClose={() => {
              setTemplateEditor(null);
              setTemplateDraft(null);
            }}
            onSaved={async () => setResources(await api.resources())}
            report={report}
          />
        )}
        {pageNumbersOpen && album && (
          <div className="modal-backdrop">
            <section
              className="page-number-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="页码设置"
            >
              <h2>页码设置</h2>
              <PaginationControls
                value={album.pagination}
                disabled={locked}
                onChange={(value) => commit({ type: "pagination", value })}
              />
              <button onClick={() => setPageNumbersOpen(false)}>完成</button>
            </section>
          </div>
        )}
        {comparison && album && (
          <Comparison
            annotations={album.annotations}
            snapshots={comparison}
            initialPageId={pageId}
            onClose={() => setComparison(null)}
            onReject={(noteId) =>
              void run(async () => {
                const value = current.current!;
                adopt(await api.rejectAiNote(value.id, value.revision, noteId));
                setComparison(null);
                report(
                  "已撤回这条修改，其他 AI 修改保留；批注重新进入待提交。",
                );
              })
            }
            onUndo={() =>
              void run(async () => {
                const a = current.current!;
                adopt(await api.undoAi(a.id, a.revision));
                setTask(await api.task(a.id));
                setComparison(null);
              })
            }
          />
        )}
        {notice}
      </div>
    </FontContext.Provider>
  );
}
