import { type Album, type Asset, DomainError } from "../domain/model";
import { coverPhotoIndices } from "../domain/covers";
import {
  type CodexPreferences,
  defaultCodexPreferences,
} from "../domain/codex";
import { type LayoutTemplate } from "../domain/layouts";
import { layoutCapacity } from "../domain/templates";
import { CodexBridge } from "../infrastructure/codex-bridge";
import {
  applyGenerationPlan,
  generationSchema,
} from "../infrastructure/generation-plan";
import type { Store } from "../infrastructure/store";
import { health } from "../infrastructure/health";

export type GenerationState = {
  status: "idle" | "running" | "succeeded" | "failed" | "cancelled";
  message: string;
};
export class GenerationCoordinator {
  bridge: CodexBridge;
  private active?: AbortController;
  private executable = "";
  state: GenerationState = { status: "idle", message: "" };
  constructor(
    private store: Store,
    readonly cwd: string,
    private preflight: (before: Album, after: Album) => Promise<void>,
  ) {
    this.bridge = new CodexBridge(cwd);
  }
  preferences(): CodexPreferences {
    const raw = this.store.getValue("codex-preferences");
    try {
      const value = raw
        ? JSON.parse(raw)
        : structuredClone(defaultCodexPreferences);
      this.validate(value);
      health.resolve("codex-config");
      return value;
    } catch {
      if (raw) this.store.archivePreference("codex-preferences", raw);
      health.report(
        "codex-config",
        new DomainError("Codex 设置损坏，暂用默认配置，原设置已保留。"),
      );
      return structuredClone(defaultCodexPreferences);
    }
  }
  async connect() {
    try {
      const p = this.preferences();
      if (this.executable !== p.executable) {
        this.bridge.close();
        this.bridge = new CodexBridge(this.cwd, p.executable);
        this.executable = p.executable;
      }
      return await this.bridge.connect();
    } catch (e) {
      return {
        connected: false,
        ready: false,
        message: e instanceof Error ? e.message : "Codex 设置无法读取。",
        executable: "",
        skills: [],
      };
    }
  }
  private validate(p: CodexPreferences): void {
    if (
      !p ||
      Object.keys(p).sort().join() !== "executable,model,prompt,skillPaths" ||
      typeof p.executable !== "string" ||
      p.executable.length > 4096 ||
      typeof p.model !== "string" ||
      p.model.length > 120 ||
      typeof p.prompt !== "string" ||
      !p.prompt.trim() ||
      p.prompt.length > 12000 ||
      !Array.isArray(p.skillPaths) ||
      p.skillPaths.length > 5 ||
      p.skillPaths.some((s) => typeof s !== "string" || s.length > 4096)
    )
      throw new DomainError(
        "Codex 设置无效；提示词最多 12000 字符，最多选择 5 个 skill。",
      );
  }
  savePreferences(p: CodexPreferences, expected?: CodexPreferences): void {
    if (this.active) throw new DomainError("请先取消正在进行的生成。");
    this.validate(p);
    this.store.preferencesTransaction(() => {
      if (
        expected &&
        JSON.stringify(expected) !== JSON.stringify(this.preferences())
      )
        throw new DomainError(
          "Codex 设置已被另一个副本修改，请重新读取后再保存。",
        );
      this.store.setValue("codex-preferences", JSON.stringify(p));
    });
    this.bridge.close();
    this.bridge = new CodexBridge(this.cwd, p.executable);
    this.executable = p.executable;
    void this.bridge.connect();
  }
  async reconnect() {
    if (this.active) throw new DomainError("生成期间不能重新连接，请先取消。");
    this.bridge.close();
    this.executable = this.preferences().executable;
    this.bridge = new CodexBridge(this.cwd, this.executable);
    return this.bridge.connect();
  }
  cancel(): void {
    if (!this.active) return;
    this.active?.abort();
    this.active = undefined;
    this.state = { status: "cancelled", message: "已取消，未创建工程。" };
  }
  reserve(): AbortController {
    if (this.active)
      throw new DomainError("已有纪念册正在生成，请等待或取消。");
    this.active = new AbortController();
    this.state = { status: "running", message: "正在准备生成素材…" };
    return this.active;
  }
  release(controller: AbortController, error: unknown): void {
    if (this.active !== controller) return;
    this.active = undefined;
    this.state = {
      status: "failed",
      message: error instanceof Error ? error.message : "生成素材准备失败。",
    };
  }
  async generate(
    base: Album,
    photos: Asset[],
    stickers: Asset[],
    phrases: string[],
    catalog: LayoutTemplate[],
    mode: "templates" | "creative",
    previews: () => Promise<
      {
        index: number;
        path: string;
        kind?: "photo" | "sticker";
        indices?: number[];
      }[]
    > = async () => [],
    reservation?: AbortController,
  ): Promise<Album> {
    const controller = reservation ?? this.reserve();
    if (controller.signal.aborted || this.active !== controller)
      throw new DomainError("已取消生成，未创建工程。");
    this.state = { status: "running", message: "正在连接本地 Codex…" };
    const timer = setTimeout(() => controller.abort(), 600000);
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new DomainError("生成已取消或超时，未创建工程。"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const preferences = this.preferences();
      const prompt =
        preferences.prompt +
        "\n\n必须遵守的软件协议：\n" +
        JSON.stringify({
          mode,
          size: base.size,
          title: base.name,
          photos: photos.map((a, index) => ({
            index,
            name: a.name,
            width: a.width,
            height: a.height,
          })),
          stickers: stickers.map((a, index) => ({
            index,
            name: a.name,
            width: a.width,
            height: a.height,
          })),
          phrases,
          layouts: catalog.map((t) => ({
            id: t.id,
            name: t.name,
            capacity: layoutCapacity(t),
            phraseSlots: t.phraseIds.length,
            stickerSlots: t.page.elements.filter(
              (e) => e.type === "photoSlot" && e.role === "sticker",
            ).length,
            paper: {
              color: t.page.background,
              texture: t.page.backgroundStyle ?? "solid",
            },
            typography: t.page.elements
              .filter((e) => e.type === "text")
              .map((e) => ({
                role: e.name,
                color: e.style.color,
                fontSize: e.style.fontSize,
                fontFamily: e.style.fontFamily ?? "Noto Sans SC",
              })),
          })),
          rules: [
            `自由设计内页沿用封面的底色 ${base.pages[0]!.background} 和纸张 ${base.pages[0]!.backgroundStyle ?? "solid"}；请根据底色选择清晰可读的文字颜色。固定排版的纸张与文字配色已成套设计，直接使用。`,
            `封面已由软件生成。不要输出封面。照片索引 ${JSON.stringify(coverPhotoIndices(base, photos))} 已用于封面，不再使用；其余照片索引必须在 photoIndices 中各出现恰好一次。`,
            "每个结果页都要包含 layoutId、photoIndices、phraseIndices、elements。固定排版用给定 layoutId，elements=[]，照片数量不能大于 capacity。",
            "短语引用 phraseIndices 使用 phrases 的零起始索引；没有短语时用 []。",
            "当 stickers 非空时，必须在内页实际使用至少一张已选贴纸，按页轮用并保留留白；仅把贴纸列入素材库不算使用。自由页添加 kind=sticker 元素；固定页选择含 stickerSlots 的排版。stickers 为空时不得编造贴纸。",
            "优先轮用各个固定排版。页数不超过 99；无内页照片时仅输出一个固定排版页、photoIndices=[]。",
            mode === "templates"
              ? "本次只能使用固定排版，不允许 custom。"
              : "可自由设计：layoutId=custom，并在 elements 给出 photo/sticker/text 元素。图片 assetIndex 是各自 photos/stickers 的零起始索引。照片元素与本页 photoIndices 一一对应。文字使用 text/fontSize/color，assetIndex=null；图片的 text/fontSize/color=null。坐标与宽高使用 pt，旋转以度为单位，旋转后也必须完全在页面内。",
            "不需要的字段必须为 null，禁止额外字段。图片不能引用路径或 URL。不要运行命令或修改文件。",
          ],
        });
      const work = async () => {
        const images = await previews();
        if (controller.signal.aborted) throw new DomainError("已取消生成。");
        const status = await this.connect();
        if (!status.ready) throw new DomainError(status.message);
        const result = await this.bridge.generate(
          prompt +
            "\n附带素材缩略图或索引图。索引图上的 P0、P1 表示 photos 索引，S0、S1 表示 stickers 索引；indices 列出每张索引图包含的全部素材。没有 indices 时 index 对应单张素材。请结合全部索引图安排内容：" +
            JSON.stringify(
              images.map((image) => ({
                kind: image.kind ?? "photo",
                index: image.index,
                indices: image.indices,
              })),
            ),
          generationSchema,
          preferences.skillPaths,
          controller.signal,
          (message) => {
            if (this.active === controller)
              this.state = { status: "running", message };
          },
          preferences.model,
          images.map((image) => image.path),
        );
        if (controller.signal.aborted) throw new DomainError("已取消生成。");
        this.state = {
          status: "running",
          message: "正在检查版式、照片完整性和文字…",
        };
        const album = applyGenerationPlan(
          base,
          photos,
          stickers,
          phrases,
          catalog,
          mode,
          result,
        );
        await this.preflight({ ...album, pages: [] }, album);
        if (controller.signal.aborted) throw new DomainError("已取消生成。");
        return album;
      };
      const album = await Promise.race([work(), cancelled]);
      if (this.active !== controller || controller.signal.aborted)
        throw new DomainError("已取消生成。");
      const created = this.store.create(album);
      this.state = {
        status: "succeeded",
        message: "纪念册已生成，可继续编辑。",
      };
      return created;
    } catch (error) {
      if (this.active === controller)
        this.state = {
          status: controller.signal.aborted ? "cancelled" : "failed",
          message:
            error instanceof Error ? error.message : "生成失败，未创建工程。",
        };
      throw error;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
      if (this.active === controller) this.active = undefined;
    }
  }
  close(): void {
    this.cancel();
    this.bridge.close();
  }
}
