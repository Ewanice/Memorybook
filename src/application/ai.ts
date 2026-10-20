import type { Album, Element } from "../domain/model";
import { DomainError } from "../domain/model";
import { assertAlbum, assertElement } from "../domain/validation";
import type { AlbumService } from "./service";
import { assertAiRequest, type AiRequest } from "../shared/ai-contract";
export interface AiProvider {
  configured(): boolean;
  propose(input: AiRequest, signal: AbortSignal): Promise<unknown>;
}
type AiCapabilities = {
  previews?: (album: Album) => Promise<{ assetId: string; dataUrl: string }[]>;
  preflight?: (before: Album, after: Album) => Promise<void>;
};
type Proposal = {
  baseRevision: number;
  results: {
    annotationId: string;
    status: "proposed" | "needsInput";
    message: string;
    element?: Element;
  }[];
};
export function applyProposal(source: Album, input: unknown): Album {
  if (!input || typeof input !== "object")
    throw new DomainError("AI 返回的数据格式无效。");
  const proposal = input as Proposal;
  const notes = source.annotations.filter((n) => n.status === "pending");
  if (
    proposal.baseRevision !== source.revision ||
    !Array.isArray(proposal.results) ||
    proposal.results.length !== notes.length
  )
    throw new DomainError("AI 结果版本或批注数量不匹配。");
  const album = structuredClone(source);
  const handled = new Set<string>();
  for (const result of proposal.results) {
    if (
      !result ||
      typeof result.message !== "string" ||
      result.message.length > 2000 ||
      handled.has(result.annotationId)
    )
      throw new DomainError("AI 结果条目无效或重复。");
    const note = album.annotations.find(
      (n) => n.id === result.annotationId && n.status === "pending",
    );
    if (!note) throw new DomainError("AI 试图修改未提交的目标。");
    handled.add(note.id);
    if (result.status === "needsInput") {
      if (result.element) throw new DomainError("未执行项不能附带修改。");
      note.status = "needsInput";
      note.message = result.message;
      continue;
    }
    if (result.status !== "proposed") throw new DomainError("AI 状态不合法。");
    assertElement(result.element);
    const page = album.pages.find((p) => p.id === note.pageId)!;
    const index = page.elements.findIndex((e) => e.id === note.elementId);
    const before = page.elements[index]!;
    const after = result.element;
    if (
      before.locked ||
      before.id !== after.id ||
      before.type !== after.type ||
      before.visible !== after.visible ||
      before.locked !== after.locked ||
      before.name !== after.name ||
      (before.type === "image" &&
        after.type === "image" &&
        (before.assetId !== after.assetId ||
          before.role !== after.role ||
          before.fit !== after.fit))
    )
      throw new DomainError("AI 修改超出了允许范围。");
    if (
      after.frame.x < 0 ||
      after.frame.y < 0 ||
      after.frame.x + after.frame.width > album.size.width ||
      after.frame.y + after.frame.height > album.size.height
    )
      throw new DomainError("AI 结果超出页面边界，未应用修改。");
    page.elements[index] = after;
    note.status = "applied";
    note.message = result.message;
  }
  assertAlbum(album);
  return album;
}
export class AiCoordinator {
  private active = new Map<
    string,
    {
      id: string;
      controller: AbortController;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private service: AlbumService,
    private provider: AiProvider,
    private capabilities: AiCapabilities = {},
  ) {}
  start(albumId: string): void {
    this.service.assertTaskFree(albumId);
    if (!this.provider.configured())
      throw new DomainError("请在设置中填写 API 地址、模型名称和 API Key。");
    if (!this.service.store.settings().aiEnabled)
      throw new DomainError("请先在设置中启用 AI。");
    const album = this.service.store.get(albumId);
    if (album.annotations.some((n) => n.status === "needsReview"))
      throw new DomainError("有批注需要复核，请先确认。");
    const notes = album.annotations.filter((n) => n.status === "pending");
    if (!notes.length) throw new DomainError("请先添加待处理批注。");
    if (
      notes.some(
        (n) =>
          album.pages
            .find((p) => p.id === n.pageId)
            ?.elements.find((e) => e.id === n.elementId)?.locked,
      )
    )
      throw new DomainError("请先解锁需要修改的元素。");
    const taskId = crypto.randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(
      () => this.cancel(albumId, "AI 请求超时，原稿未改变。", true),
      300000,
    );
    this.active.set(albumId, { id: taskId, controller, timer });
    this.service.setTask(albumId, {
      source: "ai",
      status: "running",
      message: "正在根据批注修改，您可以浏览页面或取消。",
    });
    void this.request(album, taskId, controller);
  }
  private async request(
    album: Album,
    taskId: string,
    controller: AbortController,
  ): Promise<void> {
    try {
      const pageIds = new Set(
        album.annotations
          .filter((n) => n.status === "pending")
          .map((n) => n.pageId),
      );
      pageIds.add(album.pages[0]!.id);
      const pages = album.pages.filter((p) => pageIds.has(p.id));
      const assetIds = new Set(
        pages.flatMap((p) =>
          p.elements.flatMap((el) => (el.type === "image" ? [el.assetId] : [])),
        ),
      );
      const subset: Album = {
        ...album,
        name: "AI 批注",
        pages,
        assets: album.assets
          .filter((a) => assetIds.has(a.id))
          .map((a, i) => ({ ...a, name: `素材 ${i + 1}` })),
        annotations: album.annotations.filter((n) => n.status === "pending"),
      };
      const input = {
        taskId,
        album: subset,
        previews: (await this.capabilities.previews?.(subset)) ?? [],
      };
      assertAiRequest(input);
      if (this.active.get(album.id)?.id !== taskId) return;
      const body = await this.provider.propose(input, controller.signal);
      if (this.active.get(album.id)?.id !== taskId) return;
      const result = applyProposal(album, body);
      await this.capabilities.preflight?.(album, result);
      if (this.active.get(album.id)?.id !== taskId) return;
      this.service.store.save(result, album.revision, "ai");
      this.service.setTask(album.id, {
        source: "ai",
        status: "succeeded",
        message: `修改完成，${result.annotations.filter((n) => n.status === "needsInput").length} 条需要补充说明；可整体撤销。`,
      });
    } catch (error) {
      if (this.active.get(album.id)?.id === taskId)
        this.service.setTask(album.id, {
          source: "ai",
          status: "failed",
          message:
            error instanceof DomainError
              ? error.message
              : "AI 请求失败，原稿和批注已保留。",
        });
    } finally {
      const active = this.active.get(album.id);
      if (active?.id === taskId) {
        clearTimeout(active.timer);
        this.active.delete(album.id);
      }
    }
  }
  cancel(
    albumId: string,
    message = "已取消，原稿和批注已保留。",
    failed = false,
  ): void {
    const task = this.active.get(albumId);
    if (!task) return;
    this.active.delete(albumId);
    clearTimeout(task.timer);
    task.controller.abort();
    this.service.setTask(albumId, {
      source: "ai",
      status: failed ? "failed" : "cancelled",
      message,
    });
  }
  cancelAll(): void {
    for (const albumId of this.active.keys()) this.cancel(albumId);
  }
}
