import type {
  Album,
  Asset,
  Bootstrap,
  Edit,
  Settings,
  TaskState,
  AiConfig,
} from "../domain/model";
import type { CreateOptions } from "../domain/templates";
export type ImportResult = { assets: Asset[]; failures: string[] };
export type LibraryContent = {
  hiddenLayoutIds?: string[];
  layouts: import("../domain/layouts").LayoutTemplate[];
  stickers: Asset[];
  phrases: string[];
  phrasePath: string;
  phraseError?: string;
};
export type ExportPayload = {
  albumId: string;
  revision: number;
  quality: "high" | "share";
  fromPage?: number;
  toPage?: number;
  bleedMm?: number;
};
export type EditResult =
  | { status: "saved"; album: Album }
  | { status: "rejected"; album: Album; message: string };
export interface DesktopApi {
  health(): Promise<import("../infrastructure/health").ResourceIssue[]>;
  recovery(): Promise<
    ReturnType<import("../infrastructure/store").Store["recovery"]>
  >;
  recover(id: string, kind: "trash" | "snapshot"): Promise<Album>;
  purgeRecovery(id: string, kind: "trash" | "snapshot"): Promise<void>;
  purgeDatabaseCopy(name: string): Promise<void>;
  exportRecovery(
    id: string,
    kind: "trash" | "snapshot" | "damaged",
  ): Promise<string | null>;
  storageUsage(): Promise<
    Awaited<
      ReturnType<typeof import("../infrastructure/workspace").storageUsage>
    >
  >;
  cleanupOriginals(): Promise<number>;
  backupWorkspace(): Promise<string | null>;
  restoreWorkspace(): Promise<string | null>;
  cancelExport(id: string): Promise<void>;
  templateDraft(): Promise<import("../domain/layouts").LayoutTemplate | null>;
  saveTemplateDraft(
    value: import("../domain/layouts").LayoutTemplate | null,
  ): Promise<void>;
  removeFont(id: string): Promise<void>;
  checkResources(
    id: string,
    pageIds?: string[],
  ): Promise<{ assets: string[]; fonts: string[] }>;
  bootstrap(): Promise<Bootstrap>;
  onPreferencesChanged(
    listener: (
      value: Pick<Bootstrap, "settings" | "aiConfig" | "hasAiToken">,
    ) => void,
  ): () => void;
  importPhotos(): Promise<ImportResult>;
  fonts(): Promise<import("../domain/fonts").ImportedFont[]>;
  importFonts(): Promise<{
    fonts: import("../domain/fonts").ImportedFont[];
    failures: string[];
  }>;
  resources(): Promise<LibraryContent>;
  importStickers(): Promise<ImportResult>;
  removeSticker(id: string): Promise<void>;
  openPhrases(): Promise<void>;
  phraseDocument(): Promise<{ text: string; hash: string }>;
  resetPhrases(): Promise<{ text: string; hash: string }>;
  savePhrases(
    text: string,
    expectedHash: string,
  ): Promise<{ text: string; hash: string }>;
  saveLayout(
    template: import("../domain/layouts").LayoutTemplate,
  ): Promise<void>;
  removeLayout(id: string): Promise<void>;
  restoreLayouts(): Promise<void>;
  chooseHomeBackground(): Promise<Settings>;
  codexStatus(): Promise<import("../infrastructure/codex-bridge").CodexStatus>;
  reconnectCodex(): Promise<
    import("../infrastructure/codex-bridge").CodexStatus
  >;
  codexPreferences(): Promise<import("../domain/codex").CodexPreferences>;
  saveCodexPreferences(
    value: import("../domain/codex").CodexPreferences,
    expected?: import("../domain/codex").CodexPreferences,
  ): Promise<void>;
  chooseCodex(): Promise<string | null>;
  generationState(): Promise<
    import("../application/generation").GenerationState
  >;
  cancelGeneration(): Promise<void>;
  create(input: {
    name: string;
    city: string;
    theme: Album["theme"];
    pageSize: Settings["pageSize"];
    assets: Asset[];
    options?: CreateOptions;
    stickerIds?: string[];
  }): Promise<Album>;
  open(id: string): Promise<Album>;
  edit(id: string, revision: number, edit: Edit): Promise<EditResult>;
  addAssets(id: string, revision: number, assets: Asset[]): Promise<Album>;
  addLibraryStickers(
    id: string,
    revision: number,
    ids: string[],
  ): Promise<Album>;
  history(
    id: string,
    revision: number,
    direction: "undo" | "redo",
  ): Promise<Album>;
  deleteAlbum(id: string): Promise<void>;
  duplicateAlbum(id: string): Promise<Album>;
  settings(settings: Settings, expected?: Settings): Promise<Settings>;
  chooseDirectory(): Promise<string | null>;
  configureAi(
    config: AiConfig,
    apiKey: string | null,
    expected?: AiConfig,
  ): Promise<void>;
  removeAiKey(): Promise<void>;
  testAiConnection(): Promise<string>;
  startAi(id: string): Promise<void>;
  cancelAi(id: string): Promise<void>;
  task(id: string): Promise<TaskState>;
  exportPdf(payload: ExportPayload): Promise<string | null>;
  backup(id: string): Promise<string | null>;
  restore(): Promise<Album | null>;
  dataDirectory(): Promise<void>;
  storageInfo(): Promise<{
    root: string;
    preferences: string;
    data: string;
    assets: string;
    cache: string;
    fonts: string;
    phrases: string;
  }>;
  cacheInfo(): Promise<{ bytes: number; files: number }>;
  clearCache(): Promise<void>;
  diagnostics(): Promise<string>;
  exportDiagnostics(): Promise<string | null>;
  notices(): Promise<string>;
  comparison(id: string): Promise<{ before: Album; after: Album } | null>;
  undoAi(id: string, revision: number): Promise<Album>;
  rejectAiNote(id: string, revision: number, noteId: string): Promise<Album>;
  repairSettings(): Promise<void>;
}
declare global {
  interface Window {
    memorybook: DesktopApi;
  }
}
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
