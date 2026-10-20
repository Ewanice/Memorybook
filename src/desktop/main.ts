import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  shell,
  safeStorage,
  nativeImage,
  screen,
} from "electron";
import { readFile, mkdir, stat, mkdtemp, rm, unlink } from "node:fs/promises";
import { join, dirname, basename, resolve, sep } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import { health } from "../infrastructure/health";
import {
  writeArchive,
  readArchive,
  requireSpace,
} from "../infrastructure/archive";
import {
  storageUsage,
  cleanupOriginals,
  backupWorkspace,
  restoreWorkspace,
} from "../infrastructure/workspace";
import { Store } from "../infrastructure/store";
import { openStore } from "../infrastructure/open-store";
import { exportSelection } from "../domain/export-options";
import {
  makeContactSheets,
  type ContactSheet,
} from "../infrastructure/contact-sheets";
import { writeAtomic as atomicWrite } from "../infrastructure/atomic-file";
import { backupDatabase } from "../infrastructure/database-backup";
import {
  assertMissingResources,
  type MissingResources,
} from "../domain/missing-resources";
import { assertTemplateDraft } from "../domain/template-draft";
import { AssetStore } from "../infrastructure/assets";
import { verifyLicense } from "../infrastructure/license";
import { AlbumService } from "../application/service";
import { AiCoordinator } from "../application/ai";
import {
  DomainError,
  type Album,
  type Asset,
  type LicenseInfo,
} from "../domain/model";
import { defaultSettings } from "../domain/model";
import { assertAlbum, assertSettings } from "../domain/validation";
import type { DesktopApi, ExportPayload, Reply } from "../shared/api";
import {
  validateAiLayout,
  validateFontForRendering,
} from "../infrastructure/preflight";
import { AiPreferences } from "../infrastructure/ai-preferences";
import { propose, clearProviderCache } from "../infrastructure/ai-provider";
import { createAlbum, layoutCatalog } from "../domain/templates";
import { GenerationCoordinator } from "../application/generation";
import { assertLayout } from "../domain/layout-validation";
import { ResourceLibrary } from "../infrastructure/resource-library";
import { FontStore, inspectFont } from "../infrastructure/fonts";
import { usedFontIds, fontCss } from "../domain/fonts";
import {
  configureStorage,
  migrateLegacy,
  migratePortableNames,
} from "../infrastructure/portable";

declare const __BUILD_CONFIG__: { publicKey: string; development: boolean };
const build = __BUILD_CONFIG__;
app.setName("Memorybook");
let storage: ReturnType<typeof configureStorage>;
try {
  storage = configureStorage(app, build.development);
} catch (error) {
  dialog.showErrorBox(
    "软件目录无法写入",
    "请先将完整软件文件夹解压到可写入的位置（例如 D 盘），再运行 Memorybook.exe。不要直接在压缩包内或只读目录中运行。\n" +
      (error instanceof Error ? error.message : ""),
  );
  app.exit(1);
  throw error;
}
app.setAppUserModelId("com.memorybook.desktop");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "memory",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
let window: BrowserWindow;
let store: Store;
let assets: AssetStore;
let fonts: FontStore;
async function availableFonts() {
  try {
    const result = await fonts.list();
    health.resolve("font-directory");
    return result;
  } catch {
    health.report(
      "font-directory",
      new DomainError("字体库目录无法读取；暂用内置字体，请检查目录权限。"),
    );
    return [];
  }
}
async function putFont(bytes: Uint8Array, expectedId?: string) {
  inspectFont(bytes);
  await validateFontForRendering(bytes);
  return fonts.put(bytes, expectedId);
}
let service: AlbumService;
let ai: AiCoordinator;
let aiPreferences: AiPreferences;
let resources: ResourceLibrary;
let generation: GenerationCoordinator;
const imported = new Map<string, Asset>();
const rendererRoot = join(__dirname, "renderer");
function license(): LicenseInfo {
  const token = store.getValue("license");
  if (!token) return { valid: false, id: "", development: build.development };
  try {
    return verifyLicense(token, build.publicKey, build.development);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return {
      valid: false,
      id: "",
      development: build.development,
      message: "已保存的卡密无效，请重新输入购买后收到的完整卡密。",
    };
  }
}
function authorized(): void {
  if (!license().valid) throw new DomainError("请先输入购买后收到的卡密。");
}
async function suggestedExportPath(name: string): Promise<string> {
  const directory =
    store.settings().exportDirectory || join(storage.root, "exports");
  await mkdir(directory, { recursive: true });
  return join(directory, name);
}
async function approvedAssets(input: Asset[]): Promise<Asset[]> {
  if (!Array.isArray(input) || input.length > 500)
    throw new DomainError("素材数量超出限制。");
  return input.map((a) => {
    const trusted = imported.get(a.id);
    if (!trusted) throw new DomainError("请通过导入窗口选择素材。");
    return trusted;
  });
}
function diagnosticSummary(): string {
  return JSON.stringify(
    {
      application: "memorybook-desktop",
      version: app.getVersion(),
      development: build.development,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      schemaVersion: 1,
      settingsVersion: store.settings().version,
      authorized: license().valid,
      aiProtocol: aiPreferences.config().protocol,
      aiEnabled: store.settings().aiEnabled,
      busy: service.hasBusyTask(),
      resourceIssues: health.list(),
    },
    null,
    2,
  );
}
const exportJobs = new Map<string, AbortController>();
async function exportPdf(input: ExportPayload): Promise<string | null> {
  service.assertTaskFree(input.albumId);
  const album = store.get(input.albumId);
  const selection = exportSelection(album, input),
    printing = {
      width: album.size.width + 2 * selection.bleed,
      height: album.size.height + 2 * selection.bleed,
    };
  if (
    selection.pages.some((page) =>
      page.elements.some((el) => el.type === "photoSlot" && el.visible),
    )
  )
    throw new DomainError("请先填入或删除空的照片、贴纸占位。");
  if (
    album.revision !== input.revision ||
    !["high", "share"].includes(input.quality)
  )
    throw new DomainError("导出快照已变化或参数无效。");
  const result = await dialog.showSaveDialog(window, {
    title: "导出逐页 PDF",
    defaultPath: await suggestedExportPath(
      `memorybook-${album.id.slice(0, 8)}${selection.pages.length === album.pages.length ? "" : `-pages-${selection.from}-${selection.to}`}.pdf`,
    ),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (result.canceled || !result.filePath) return null;
  service.assertTaskFree(album.id);
  service.setTask(album.id, { status: "exporting", message: "正在生成 PDF…" });
  const controller = new AbortController();
  exportJobs.set(album.id, controller);
  const timer = setTimeout(
    () =>
      controller.abort(
        new DomainError("PDF 导出超时，请降低导出质量或分批整理页面后重试。"),
      ),
    300000,
  );
  let exportWindow: BrowserWindow | undefined;
  const abort = () => exportWindow?.destroy();
  controller.signal.addEventListener("abort", abort, { once: true });
  try {
    const usedIds = new Set(
      selection.pages.flatMap((p) =>
        p.elements.flatMap((e) =>
          e.visible && e.type === "image" ? [e.assetId] : [],
        ),
      ),
    );
    await requireSpace(
      dirname(result.filePath),
      album.assets
        .filter((a) => usedIds.has(a.id))
        .reduce((n, a) => n + a.bytes, 0),
    );
    for (const id of usedIds) {
      await assets.verify(id);
      if (controller.signal.aborted) throw controller.signal.reason;
    }
    if (controller.signal.aborted) throw controller.signal.reason;
    exportWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await exportWindow.loadURL("memory://app/export.html");
    const pages = (await exportWindow.webContents.executeJavaScript(
      `window.memorybookExport.render(${JSON.stringify(album)},${JSON.stringify(input.quality)},${JSON.stringify({ pageIds: selection.pages.map((p) => p.id), bleed: selection.bleed })})`,
    )) as string[];
    const pdf = await PDFDocument.create();
    for (let offset = 0; offset < pages.length; offset += 8) {
      if (controller.signal.aborted) throw controller.signal.reason;
      service.setTask(album.id, {
        status: "exporting",
        message: `正在导出第 ${offset + 1}–${Math.min(offset + 8, pages.length)} 页 / 共 ${pages.length} 页…`,
      });
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src memory:; style-src 'unsafe-inline' memory:; font-src memory:"><link rel="stylesheet" href="memory://app/fonts.css"><style>${fontCss(usedFontIds({ pages: selection.pages }))}</style><style>@page{size:${printing.width}pt ${printing.height}pt;margin:0}*{box-sizing:border-box}body{margin:0}section{width:${printing.width}pt;height:${printing.height}pt;break-after:page;overflow:hidden}section:last-child{break-after:auto}section>svg{display:block;width:100%;height:100%}</style></head><body>${pages
        .slice(offset, offset + 8)
        .map((svg) => `<section>${svg}</section>`)
        .join("")}</body></html>`;
      await exportWindow.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html),
      );
      await exportWindow.webContents.executeJavaScript(
        `Promise.all([document.fonts.ready, ...Array.from(document.querySelectorAll('image')).map(el => new Promise((resolve, reject) => {const i=new Image(); i.onload=resolve; i.onerror=()=>reject(new Error('素材无法加载')); i.src=el.getAttribute('href');}))])`,
      );
      const buffer = await exportWindow.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      const part = await PDFDocument.load(buffer);
      if (part.getPageCount() !== Math.min(8, pages.length - offset))
        throw new DomainError("导出页数异常，文件未写入。");
      const embedded = await pdf.embedPages(part.getPages());
      for (const [index, picture] of embedded.entries()) {
        // Chromium rounds paper dimensions. Rehouse its vector page without
        // scaling, align at the top, and define the exact physical sheet size.
        const page = pdf.addPage([printing.width, printing.height]);
        const color = selection.pages[offset + index]!.background;
        page.drawRectangle({
          x: 0,
          y: 0,
          width: printing.width,
          height: printing.height,
          color: rgb(
            parseInt(color.slice(1, 3), 16) / 255,
            parseInt(color.slice(3, 5), 16) / 255,
            parseInt(color.slice(5, 7), 16) / 255,
          ),
        });
        page.drawPage(picture, { x: 0, y: printing.height - picture.height });
        if (selection.bleed) {
          page.setTrimBox(
            selection.bleed,
            selection.bleed,
            album.size.width,
            album.size.height,
          );
          page.setBleedBox(0, 0, printing.width, printing.height);
        }
      }
    }
    const bytes = await pdf.save();
    if (controller.signal.aborted) throw controller.signal.reason;
    await atomicWrite(result.filePath, bytes);
    try {
      store.saveSettings({
        ...store.settings(),
        exportDirectory: dirname(result.filePath),
      });
    } catch {
      health.report(
        "export-preferences",
        new DomainError("PDF 已导出，但导出目录偏好未能保存，请检查磁盘空间。"),
      );
    }
    service.setTask(album.id, {
      status: "succeeded",
      message: `已导出 ${selection.pages.length} 页 PDF。`,
    });
    return result.filePath;
  } catch (error) {
    service.setTask(album.id, {
      status: controller.signal.aborted ? "cancelled" : "failed",
      message: controller.signal.aborted
        ? "导出已取消或超时，工程未改变。"
        : "导出失败，项目未改变。",
    });
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    clearTimeout(timer);
    exportJobs.delete(album.id);
    controller.signal.removeEventListener("abort", abort);
    if (exportWindow && !exportWindow.isDestroyed()) exportWindow.destroy();
  }
}

async function backup(id: string): Promise<string | null> {
  service.assertWritable(id);
  const album = store.get(id);
  const result = await dialog.showSaveDialog(window, {
    title: "备份可编辑工程",
    defaultPath: await suggestedExportPath(
      `album-${album.id.slice(0, 8)}.memorybook`,
    ),
    filters: [{ name: "纪念册工程", extensions: ["memorybook"] }],
  });
  if (!result.filePath) return null;
  const files: { name: string; path?: string; bytes?: Uint8Array }[] = [
    { name: "album.json", bytes: Buffer.from(JSON.stringify(album)) },
  ];
  const missing: MissingResources = { assets: [], fonts: [] };
  for (const asset of album.assets) {
    try {
      await assets.verify(asset.id);
      files.push({ name: `assets/${asset.id}`, path: assets.path(asset.id) });
    } catch {
      missing.assets.push(asset.id);
    }
  }
  for (const id of usedFontIds(album)) {
    try {
      await fonts.read(id);
      files.push({ name: `fonts/${id}`, path: fonts.path(id) });
    } catch {
      missing.fonts.push(id);
    }
  }
  if (missing.assets.length || missing.fonts.length)
    files.push({
      name: "missing.json",
      bytes: Buffer.from(JSON.stringify(missing)),
    });
  await writeArchive(result.filePath, files);
  if (missing.assets.length || missing.fonts.length)
    health.report(
      `backup:${id}`,
      new DomainError(
        `已备份工程结构与可读取素材；原资料有 ${missing.assets.length} 张图片、${missing.fonts.length} 个字体缺失，恢复后可继续替换或补齐。`,
      ),
    );
  else health.resolve(`backup:${id}`);
  return result.filePath;
}
async function restore(): Promise<Album | null> {
  const result = await dialog.showOpenDialog(window, {
    filters: [{ name: "纪念册工程", extensions: ["memorybook"] }],
    properties: ["openFile"],
  });
  const path = result.filePaths[0];
  if (!path) return null;
  await requireSpace(storage.data, (await stat(path)).size);
  const staging = await mkdtemp(join(storage.data, "import-"));
  try {
    const files = await readArchive(path, staging);
    const raw = files.get("album.json");
    if (!raw) throw new DomainError("工程包缺少文档。");
    const album: unknown = JSON.parse(await readFile(raw, "utf8"));
    assertAlbum(album);
    const declaration = files.get("missing.json");
    const missing: unknown = declaration
      ? JSON.parse(await readFile(declaration, "utf8"))
      : { assets: [], fonts: [] };
    assertMissingResources(missing, album);
    for (const asset of album.assets) {
      const file = files.get(`assets/${asset.id}`);
      if (missing.assets.includes(asset.id)) {
        if (file) throw new DomainError("工程包的缺失说明与实际文件冲突。");
        continue;
      }
      const data = file ? await readFile(file) : undefined;
      if (!data) throw new DomainError(`缺少素材：${asset.name}`);
      const real = await assets.put(data, asset.name, asset.id);
      if (
        real.width !== asset.width ||
        real.height !== asset.height ||
        real.mime !== asset.mime ||
        real.bytes !== asset.bytes
      )
        throw new DomainError("素材元数据与文件不一致。");
    }
    for (const id of usedFontIds(album)) {
      const file = files.get(`fonts/${id}`);
      if (missing.fonts.includes(id)) {
        if (file) throw new DomainError("工程包的字体缺失说明与实际文件冲突。");
        continue;
      }
      const bytes = file ? await readFile(file) : undefined;
      if (!bytes) throw new DomainError("工程包缺少自定义字体。");
      await putFont(bytes, id);
    }
    album.id = crypto.randomUUID();
    album.revision = 0;
    album.updatedAt = new Date().toISOString();
    album.name = album.name.slice(0, 114) + "（导入）";
    return store.create(album);
  } finally {
    const resolved = resolve(staging);
    if (
      !resolved.startsWith(resolve(storage.data) + sep) ||
      !basename(resolved).startsWith("import-")
    )
      throw new DomainError("临时文件清理范围无效。");
    await rm(resolved, { recursive: true, force: true }).catch(() =>
      health.report(
        "import-cleanup",
        new DomainError(
          "工程导入后的临时文件清理未完成，工程操作不受影响，请检查目录权限。",
        ),
      ),
    );
  }
}

async function start(): Promise<void> {
  await app.whenReady();
  health.configure(join(storage.data, "logs"));
  await migrateLegacy(storage).catch(() =>
    health.report(
      "legacy-migration",
      new DomainError(
        "旧资料迁移未完成，原目录完整保留。可继续使用软件，并从旧资料或完整备份中导入。",
      ),
    ),
  );
  await migratePortableNames(storage, join(__dirname, "phrases.txt")).catch(
    () =>
      health.report(
        "path-migration",
        new DomainError("部分旧素材未能迁移，原文件保留；正常资料可继续使用。"),
      ),
  );
  const directory = storage.data;
  store = await openStore(directory);
  assets = new AssetStore(join(directory, "assets"));
  fonts = new FontStore(join(storage.root, "materials", "imported-fonts"));
  const libraryDirectory = storage.root;
  resources = new ResourceLibrary(
    store,
    join(libraryDirectory, "phrases.txt"),
    join(__dirname, "phrases.txt"),
  );
  service = new AlbumService(store, () =>
    resources.stickers().map((a) => a.id),
  );
  const generationDirectory = join(directory, "codex-generation");
  await mkdir(generationDirectory, { recursive: true }).catch(() =>
    health.report(
      "codex-directory",
      new DomainError(
        "Codex 临时资料目录不可写，本地编辑不受影响，请检查目录权限。",
      ),
    ),
  );
  generation = new GenerationCoordinator(
    store,
    generationDirectory,
    (before, after) =>
      validateAiLayout(
        before,
        after,
        "生成方案存在文字溢出，未创建工程。请调整提示词后重新生成。",
      ),
  );
  aiPreferences = new AiPreferences(store, {
    encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
    decrypt: (raw) => safeStorage.decryptString(Buffer.from(raw, "base64")),
  });
  ai = new AiCoordinator(
    service,
    {
      configured: () =>
        Boolean(aiPreferences.config().model.trim() && aiPreferences.hasKey()),
      propose: async (input, signal) => {
        const config = aiPreferences.config();
        return propose(
          input,
          {
            settings: config,
            key: aiPreferences.key(config),
            fontFamilies: (await availableFonts()).map((f) => f.family),
            progress: (message) => {
              if (!signal.aborted)
                service.setTask(input.album.id, {
                  status: "running",
                  source: "ai",
                  message,
                });
            },
          },
          signal,
        );
      },
    },
    {
      preflight: async (before, after) => {
        try {
          await validateAiLayout(before, after);
        } catch (error) {
          clearProviderCache();
          throw error;
        }
      },
      previews: async (album) => {
        if (!aiPreferences.config().sendImages) return [];
        const targetIds = new Set(album.annotations.map((n) => n.elementId));
        const images = album.pages.map((p) =>
          p.elements.filter((e) => e.type === "image" && e.visible),
        );
        const ids: string[] = [
          ...new Set(
            images.flatMap((list) =>
              list.flatMap((el) =>
                el.type === "image" && targetIds.has(el.id) ? [el.assetId] : [],
              ),
            ),
          ),
        ];
        const seen = new Set(ids);
        for (
          let i = 0;
          ids.length < 100 && images.some((list) => i < list.length);
          i++
        )
          for (const list of images) {
            const el = list[i];
            if (
              el?.type === "image" &&
              !seen.has(el.assetId) &&
              ids.length < 100
            ) {
              seen.add(el.assetId);
              ids.push(el.assetId);
            }
          }
        const previews: { assetId: string; dataUrl: string }[] = [];
        for (const assetId of ids) {
          try {
            const png = await assets.preview(assetId, "thumbnail");
            previews.push({
              assetId,
              dataUrl:
                "data:image/jpeg;base64," +
                nativeImage.createFromBuffer(png).toJPEG(80).toString("base64"),
            });
          } catch {
            health.report(
              `ai-preview:${assetId}`,
              new DomainError(
                "一个参考缩略图失效，已跳过；AI 仍可处理现有文字和几何信息，原图可稍后修复。",
              ),
            );
          }
        }
        return previews;
      },
    },
  );
  await mkdir(assets.directory, { recursive: true }).catch(() =>
    health.report(
      "asset-directory",
      new DomainError(
        "图片资料目录不可读写，现有页面结构保留，文字编辑可继续。请恢复目录或检查权限。",
      ),
    ),
  );
  protocol.handle("memory", async (request) => {
    const url = new URL(request.url);
    try {
      if (url.host === "font") {
        return new Response(
          new Uint8Array(await fonts.read(url.pathname.slice(1))),
          {
            headers: {
              "Content-Type": "font/ttf",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }
      if (url.host === "asset") {
        const variant = url.searchParams.get("variant");
        if (variant && !["thumbnail", "preview", "share"].includes(variant))
          return new Response(null, { status: 400 });
        const data = variant
          ? await assets.preview(
              url.pathname.slice(1),
              variant as "thumbnail" | "preview" | "share",
            )
          : await assets.read(url.pathname.slice(1));
        const mime =
          data[0] === 137
            ? "image/png"
            : data[0] === 255
              ? "image/jpeg"
              : "image/webp";
        return new Response(new Uint8Array(data), {
          headers: {
            "Content-Type": mime,
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      if (url.host !== "app") return new Response(null, { status: 403 });
      const path = decodeURIComponent(
        url.pathname === "/" ? "/index.html" : url.pathname,
      );
      if (path.includes("..") || path.includes("\\"))
        return new Response(null, { status: 403 });
      const data = await readFile(
        !build.development && path.startsWith("/fonts/")
          ? join(storage.root, "materials", "fonts", path.slice(7))
          : !build.development && path.startsWith("/papers/")
            ? join(storage.root, "materials", "papers", path.slice(8))
            : join(rendererRoot, path),
      );
      const mime = path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".html")
            ? "text/html"
            : path.endsWith(".svg")
              ? "image/svg+xml"
              : path.endsWith(".woff2")
                ? "font/woff2"
                : "application/octet-stream";
      return new Response(new Uint8Array(data), {
        headers: { "Content-Type": mime },
      });
    } catch {
      return new Response("本地资源无法读取", { status: 404 });
    }
  });
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^(https?|wss?|ftp):/.test(details.url) }),
  );
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window = new BrowserWindow({
    icon: join(__dirname, "icon.png"),
    width: 1480,
    height: Math.min(1080, screen.getPrimaryDisplay().workAreaSize.height),
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f4f3ef",
    title: "拾页 · 纪念册",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: build.development,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: "warning",
      buttons: ["继续编辑", "放弃未保存修改并关闭"],
      defaultId: 0,
      cancelId: 0,
      title: "还有未保存的修改",
      message: "请先完成保存或重试。关闭可能丢失尚未写入的修改。",
    });
    if (choice === 1) event.preventDefault();
  });
  const methods: DesktopApi = {
    templateDraft: async () => {
      const raw = store.getValue("layout-draft");
      if (!raw) return null;
      try {
        const value: unknown = JSON.parse(raw);
        assertTemplateDraft(value);
        return value;
      } catch {
        store.archivePreference("layout-draft", raw);
        health.report(
          "template-draft",
          new DomainError(
            "未保存排版的草稿损坏，原始草稿已保留，正常排版不受影响。",
          ),
        );
        return null;
      }
    },
    saveTemplateDraft: async (value) => {
      if (value !== null) assertTemplateDraft(value);
      store.setValue(
        "layout-draft",
        value === null ? "" : JSON.stringify(value),
      );
    },
    removeFont: async (id) => {
      const path = fonts.path(id);
      if (store.protectedAssets().has(id))
        throw new DomainError(
          "这个字体仍被工程、撤销记录、排版或恢复副本使用，请先更换字体或整理相应资料。",
        );
      await unlink(path);
      health.resolve(`font:${id}`);
    },
    health: async () => health.list(),
    recovery: async () => store.recovery(),
    recover: async (id, kind) => {
      if (kind !== "trash" && kind !== "snapshot")
        throw new DomainError("恢复类型无效。");
      return store.recover(id, kind);
    },
    purgeRecovery: async (id, kind) => store.purgeRecovery(id, kind),
    purgeDatabaseCopy: async (name) => store.purgeDatabaseCopy(name),
    exportRecovery: async (id, kind) => {
      const bytes = store.rawRecovery(id, kind);
      const result = await dialog.showSaveDialog(window, {
        title: "保存原始记录（用于恢复或售后）",
        defaultPath: await suggestedExportPath(`recovery-${Date.now()}.json`),
        filters: [{ name: "原始记录", extensions: ["json"] }],
      });
      if (!result.filePath) return null;
      await atomicWrite(result.filePath, bytes);
      return result.filePath;
    },
    storageUsage: () => storageUsage(store, assets, fonts),
    cleanupOriginals: async () => {
      if (service.hasBusyTask() || generation.state.status === "running")
        throw new DomainError("请先等待当前任务完成。");
      return cleanupOriginals(store, assets, imported.keys());
    },
    backupWorkspace: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: "选择完整资料备份的保存位置",
        properties: ["openDirectory", "createDirectory"],
      });
      if (!result.filePaths[0]) return null;
      return backupWorkspace(
        result.filePaths[0],
        store,
        assets,
        fonts,
        resources,
      );
    },
    restoreWorkspace: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: "选择 memorybook-backup 资料备份文件夹",
        properties: ["openDirectory"],
      });
      if (!result.filePaths[0]) return null;
      if (service.hasBusyTask() || generation.state.status === "running")
        throw new DomainError("请先等待当前任务完成。");
      return restoreWorkspace(
        result.filePaths[0],
        store,
        assets,
        fonts,
        resources,
      );
    },
    cancelExport: async (id) =>
      exportJobs
        .get(id)
        ?.abort(new DomainError("已取消导出，已有文件未被替换。")),
    checkResources: async (id, pageIds) => {
      const album = store.get(id),
        bad: string[] = [];
      if (
        pageIds &&
        (!Array.isArray(pageIds) ||
          pageIds.length > 100 ||
          pageIds.some(
            (id) =>
              typeof id !== "string" || !album.pages.some((p) => p.id === id),
          ))
      )
        throw new DomainError("页面范围无效。");
      const pages = pageIds
        ? album.pages.filter((p) => pageIds.includes(p.id))
        : album.pages;
      for (const id of new Set(
        pages.flatMap((p) =>
          p.elements.flatMap((e) =>
            e.visible && e.type === "image" ? [e.assetId] : [],
          ),
        ),
      )) {
        try {
          await assets.verify(id);
        } catch {
          bad.push(id);
        }
      }
      const available = new Set((await availableFonts()).map((f) => f.id));
      return {
        assets: bad,
        fonts: usedFontIds({ pages }).filter((id) => !available.has(id)),
      };
    },
    bootstrap: async () => ({
      settings: store.settings(),
      license: license(),
      albums: license().valid ? store.list() : [],
      version: app.getVersion(),
      aiConfig: aiPreferences.config(),
      hasAiToken: aiPreferences.hasKey(),
      fonts: await availableFonts(),
    }),
    activate: async (value) => {
      const verified = verifyLicense(value, build.publicKey, build.development);
      store.setValue("license", value.trim());
      void backupDatabase(directory).catch(() =>
        health.report(
          "database-backup",
          new DomainError(
            "自动数据库备份未完成，工程保存不受影响；请检查空间和目录权限。",
          ),
        ),
      );
      return verified;
    },
    fonts: () => availableFonts(),
    importFonts: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: "导入字体",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "字体", extensions: ["ttf", "otf"] }],
      });
      const failures: string[] = [];
      for (const path of result.filePaths) {
        try {
          if ((await stat(path)).size > 32 * 1024 * 1024)
            throw new DomainError("字体超过 32 MB 限制。");
          await putFont(await readFile(path));
        } catch (e) {
          failures.push(
            `${basename(path)}：${e instanceof Error ? e.message : "导入失败"}`,
          );
        }
      }
      return { fonts: await availableFonts(), failures };
    },
    importPhotos: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: "选择照片或透明贴纸",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp"] }],
      });
      const values: Asset[] = [];
      const failures: string[] = [];
      for (const path of result.filePaths) {
        try {
          const a = await assets.import(path);
          imported.set(a.id, a);
          values.push(a);
        } catch (error) {
          failures.push(
            `${basename(path)}：${error instanceof Error ? error.message : "导入失败"}`,
          );
        }
      }
      return { assets: values, failures };
    },
    resources: async () => {
      const content = {
        layouts: resources.layouts(),
        stickers: resources.stickers(),
        phrases: [] as string[],
        phrasePath: resources.phrasePath,
      };
      try {
        return { ...content, phrases: await resources.phrases() };
      } catch (error) {
        return {
          ...content,
          phraseError:
            error instanceof DomainError
              ? error.message
              : "短语库无法读取，请检查文件路径与读写权限。",
        };
      }
    },
    openPhrases: async () => {
      shell.showItemInFolder(resources.phrasePath);
    },
    phraseDocument: () => resources.phraseDocument(),
    resetPhrases: () => resources.resetPhrases(),
    savePhrases: (text, hash) => resources.savePhrases(text, hash),
    saveLayout: async (template) => {
      assertLayout(template);
      const preview: Album = {
        schemaVersion: 1,
        id: "layout-preview",
        revision: 0,
        name: template.name,
        updatedAt: "",
        theme: "paper",
        size: template.size,
        pages: [template.page],
        assets: [],
        annotations: [],
      };
      await validateAiLayout(
        { ...preview, pages: [] },
        preview,
        "排版文字超出文本框，请扩大文本框或缩小字号后保存。",
      );
      resources.saveLayout(template);
    },
    removeLayout: async (id) => resources.removeLayout(id),
    codexStatus: () => generation.connect(),
    reconnectCodex: () => generation.reconnect(),
    codexPreferences: async () => generation.preferences(),
    saveCodexPreferences: async (value) => generation.savePreferences(value),
    chooseCodex: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: "选择 Codex 可执行文件",
        properties: ["openFile"],
        filters: [{ name: "Codex", extensions: ["exe"] }],
      });
      return result.filePaths[0] ?? null;
    },
    generationState: async () => generation.state,
    cancelGeneration: async () => generation.cancel(),
    importStickers: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: "上传到贴纸库",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "贴纸图片", extensions: ["png", "webp", "jpg", "jpeg"] },
        ],
      });
      if (result.filePaths.length > 500)
        throw new DomainError("每次最多上传 500 张贴纸。");
      const values: Asset[] = [],
        failures: string[] = [];
      for (const path of result.filePaths) {
        try {
          values.push(await assets.import(path));
        } catch (error) {
          failures.push(
            `${basename(path)}：${error instanceof Error ? error.message : "导入失败"}`,
          );
        }
      }
      resources.addStickers(values);
      return { assets: values, failures };
    },
    removeSticker: async (id) => resources.removeSticker(id),
    create: async (input) => {
      const contactPaths: string[] = [];
      let contactWork: Promise<ContactSheet[]> | undefined;
      const reservation =
        input.options?.generator === "codex" ? generation.reserve() : undefined;
      try {
        const photoAssets = await approvedAssets(input.assets);
        const content = {
          stickers: resources.selected(input.stickerIds ?? []),
          phrases: input.options?.usePhrases
            ? await resources.phrases().catch(() => {
                health.report(
                  "phrases",
                  new DomainError(
                    "短语库损坏或不可读，本次生成跳过短语，原文件保留。",
                  ),
                );
                return [];
              })
            : [],
          customLayouts: resources.layouts(),
        };
        if (input.options?.generator === "codex") {
          const mode = input.options.codexMode ?? "templates";
          if (mode !== "templates" && mode !== "creative")
            throw new DomainError("Codex 生成模式无效。");
          const base = createAlbum(
            input.name,
            input.city,
            input.theme,
            input.pageSize,
            photoAssets.slice(0, 1),
            { ...input.options, generator: "local", layout: "auto" },
            content,
          );
          return await generation.generate(
            base,
            photoAssets,
            content.stickers,
            content.phrases,
            layoutCatalog(base.size, base.theme, content.customLayouts),
            mode,
            async () => {
              if (mode !== "creative") return [];
              contactWork = makeContactSheets(
                photoAssets,
                content.stickers,
                assets,
                generationDirectory,
                reservation!.signal,
                contactPaths,
              );
              return contactWork;
            },
            reservation,
          );
        }
        if (input.options?.generator && input.options.generator !== "local")
          throw new DomainError("生成方式无效。");
        return service.create(
          input.name,
          input.city,
          input.theme,
          input.pageSize,
          photoAssets,
          input.options,
          content,
        );
      } catch (error) {
        if (reservation) generation.release(reservation, error);
        throw error;
      } finally {
        await contactWork?.catch(() => {});
        for (const path of contactPaths)
          await unlink(path).catch(() =>
            health.report(
              "contact-cleanup",
              new DomainError(
                "一次 AI 生成的临时索引图清理失败，请检查目录权限。",
              ),
            ),
          );
      }
    },
    open: async (id) => store.get(id),
    edit: async (id, revision, edit) => {
      try {
        return { status: "saved", album: service.edit(id, revision, edit) };
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        return {
          status: "rejected",
          album: store.get(id),
          message: error.message,
        };
      }
    },
    addAssets: async (id, revision, values) =>
      service.addAssets(id, revision, await approvedAssets(values)),
    addLibraryStickers: async (id, revision, ids) =>
      service.addAssets(id, revision, resources.selected(ids), "sticker"),
    history: async (id, revision, direction) => {
      if (direction !== "undo" && direction !== "redo")
        throw new DomainError("历史操作无效");
      return service.history(id, revision, direction);
    },
    deleteAlbum: async (id) => {
      service.assertWritable(id);
      store.remove(id);
    },
    duplicateAlbum: async (id) => {
      service.assertWritable(id);
      const original = store.get(id);
      const copy: Album = {
        ...original,
        id: crypto.randomUUID(),
        name: original.name.slice(0, 116) + "（副本）",
        revision: 0,
        updatedAt: new Date().toISOString(),
        annotations: [],
      };
      copy.pages = original.pages.map((page) => ({
        ...page,
        id: crypto.randomUUID(),
        elements: page.elements.map((el) => ({
          ...el,
          id: crypto.randomUUID(),
        })),
      }));
      return store.create(copy);
    },
    settings: async (value) => {
      const saved = store.saveSettings(value);
      window.webContents.setZoomFactor(saved.zoom / 100);
      if (!saved.aiEnabled) ai.cancelAll();
      return saved;
    },
    chooseDirectory: async () =>
      (
        await dialog.showOpenDialog(window, {
          properties: ["openDirectory", "createDirectory"],
        })
      ).filePaths[0] ?? null,
    configureAi: async (config, apiKey) => {
      aiPreferences.configure(config, apiKey);
      ai.cancelAll();
    },
    removeAiKey: async () => {
      ai.cancelAll();
      aiPreferences.removeKey();
    },
    testAiConnection: async () => {
      if (!store.settings().aiEnabled)
        throw new DomainError("请先允许使用 AI，再进行连接测试。");
      const sample = createAlbum("连接测试", "", "paper", "a5", []);
      const page = sample.pages[0]!;
      sample.annotations.push({
        id: crypto.randomUUID(),
        pageId: page.id,
        elementId: page.elements[0]!.id,
        text: "保持文字不变。",
        status: "pending",
        message: "",
      });
      const config = aiPreferences.config();
      const start = Date.now();
      await propose(
        { taskId: crypto.randomUUID(), album: sample, previews: [] },
        { settings: config, key: aiPreferences.key(config) },
        AbortSignal.timeout(30000),
      );
      return `连接成功，模型已返回有效方案（${((Date.now() - start) / 1000).toFixed(1)} 秒）。`;
    },
    startAi: async (id) => ai.start(id),
    cancelAi: async (id) => ai.cancel(id),
    task: async (id) => service.state(id),
    exportPdf,
    backup,
    restore,
    dataDirectory: async () => {
      const error = await shell.openPath(directory);
      if (error) throw new DomainError(error);
    },
    storageInfo: async () => ({
      root: storage.root,
      data: directory,
      assets: assets.directory,
      cache: assets.cacheDirectory,
      fonts: fonts.directory,
      phrases: join(storage.root, "phrases.txt"),
    }),
    cacheInfo: () => assets.cacheInfo(),
    clearCache: async () => {
      if (service.hasBusyTask() || generation.state.status === "running")
        throw new DomainError("请在任务结束后清理缓存。");
      await assets.clearCache();
    },
    diagnostics: async () => diagnosticSummary(),
    exportDiagnostics: async () => {
      const result = await dialog.showSaveDialog(window, {
        defaultPath: await suggestedExportPath("memorybook-diagnostics.json"),
        filters: [{ name: "诊断信息", extensions: ["json"] }],
      });
      if (!result.filePath) return null;
      await atomicWrite(result.filePath, Buffer.from(diagnosticSummary()));
      return result.filePath;
    },
    notices: async () =>
      readFile(join(rendererRoot, "third-party-notices.txt"), "utf8"),
    importLicense: async () => {
      const result = await dialog.showOpenDialog(window, {
        filters: [{ name: "软件卡密", extensions: ["license"] }],
        properties: ["openFile"],
      });
      const path = result.filePaths[0];
      if (!path) return null;
      if ((await stat(path)).size > 8192)
        throw new DomainError("卡密文件过大。");
      const value = await readFile(path, "utf8");
      const verified = verifyLicense(value, build.publicKey, build.development);
      store.setValue("license", value.trim());
      return verified;
    },
    comparison: async (id) => store.comparison(id),
    undoAi: async (id, revision) => {
      service.assertWritable(id);
      const album = store.undoAi(id, revision);
      service.setTask(id, { status: "idle", message: "" });
      return album;
    },
    rejectAiNote: async (id, revision, noteId) => {
      service.assertWritable(id);
      const album = store.get(id),
        comparison = store.comparison(id),
        note = album.annotations.find((n) => n.id === noteId);
      if (!comparison || !note || note.status !== "applied")
        throw new DomainError("这条批注没有可撤回的 AI 修改。");
      const before = comparison.before.pages
          .flatMap((p) => p.elements)
          .find((e) => e.id === note.elementId),
        after = comparison.after.pages
          .flatMap((p) => p.elements)
          .find((e) => e.id === note.elementId),
        current = album.pages
          .flatMap((p) => p.elements)
          .find((e) => e.id === note.elementId);
      if (!before || JSON.stringify(current) !== JSON.stringify(after))
        throw new DomainError(
          "该元素在 AI 修改后已被人工调整，请使用撤销或手动修改，避免覆盖你的新改动。",
        );
      return service.edit(id, revision, {
        type: "batch",
        edits: [
          { type: "replaceElement", pageId: note.pageId, element: before },
          {
            type: "annotation",
            pageId: note.pageId,
            elementId: note.elementId,
            text: note.text,
            review: true,
          },
        ],
      });
    },
    repairSettings: async () => {
      try {
        const raw = store.getValue("settings");
        if (raw !== null) assertSettings(JSON.parse(raw));
      } catch (error) {
        if (!(error instanceof SyntaxError) && !(error instanceof DomainError))
          throw error;
        const raw = store.getValue("settings");
        if (raw !== null)
          await atomicWrite(
            join(directory, `damaged-settings-${Date.now()}.json`),
            Buffer.from(raw),
          );
        store.saveSettings(structuredClone(defaultSettings));
        return;
      }
      throw new DomainError("当前设置没有损坏，请在设置中恢复默认值。");
    },
  };
  ipcMain.handle(
    "memorybook",
    async (event, method: string, args: unknown[]): Promise<Reply<unknown>> => {
      try {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          !event.senderFrame.url.startsWith("memory://app/") ||
          !Array.isArray(args) ||
          args.length > 5 ||
          !Object.hasOwn(methods, method)
        )
          throw new DomainError("不允许的请求。");
        if (
          ![
            "bootstrap",
            "activate",
            "importLicense",
            "repairSettings",
          ].includes(method)
        )
          authorized();
        const fn = methods[method as keyof DesktopApi] as (
          ...input: unknown[]
        ) => Promise<unknown>;
        return { ok: true, value: await fn(...args) };
      } catch (error) {
        console.error(
          `[${method}]`,
          error instanceof Error ? error.message : "unknown error",
        );
        return {
          ok: false,
          error:
            error instanceof DomainError
              ? error.message
              : "操作未完成，请检查磁盘空间、文件权限或重试。",
        };
      }
    },
  );
  await window.loadURL("memory://app/");
  const autoBackup = () => {
    if (license().valid)
      void backupDatabase(directory).catch(() =>
        health.report(
          "database-backup",
          new DomainError(
            "自动数据库备份未完成，工程保存不受影响；请检查空间和目录权限。",
          ),
        ),
      );
  };
  autoBackup();
  const backupTimer = setInterval(autoBackup, 60000);
  backupTimer.unref();
  app.once("will-quit", () => clearInterval(backupTimer));
  window.webContents.setZoomFactor(store.settings().zoom / 100);
  app.on("second-instance", () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on("before-quit", () => {
    generation.close();
    ai.cancelAll();
  });
  app.on("will-quit", () => store.close());
}
app.on("window-all-closed", () => app.quit());
if (ownsInstance)
  void start().catch((error) => {
    dialog.showErrorBox(
      "无法启动纪念册",
      error instanceof Error ? error.message : "启动失败",
    );
    app.exit(1);
  });
