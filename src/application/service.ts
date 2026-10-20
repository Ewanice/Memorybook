import type { Album, Asset, Edit, Settings, TaskState } from "../domain/model";
import { DomainError } from "../domain/model";
import { applyEdit } from "../domain/edit";
import { createAlbum, type CreateOptions } from "../domain/templates";
import type { Store } from "../infrastructure/store";
import { assetLibraryIndex, type AssetRole } from "../domain/asset-library";
export class AlbumService {
  private tasks = new Map<string, TaskState>();
  constructor(
    readonly store: Store,
    private readonly knownStickerIds: () => string[] = () => [],
  ) {}
  state(id: string): TaskState {
    return this.tasks.get(id) ?? { status: "idle", message: "" };
  }
  assertWritable(id: string): void {
    if (this.state(id).status === "running")
      throw new DomainError("AI 修改进行中，暂时不能执行此操作。");
  }
  assertTaskFree(id: string): void {
    if (["running", "exporting"].includes(this.state(id).status))
      throw new DomainError("请等待当前任务结束。");
  }
  setTask(id: string, state: TaskState): void {
    this.tasks.set(id, state);
  }
  hasBusyTask(): boolean {
    return [...this.tasks.values()].some(
      (t) => t.status === "running" || t.status === "exporting",
    );
  }
  create(
    name: string,
    city: string,
    theme: Album["theme"],
    pageSize: Settings["pageSize"],
    assets: Asset[],
    options?: CreateOptions,
    content?: import("../domain/compositions").CompositionContent,
  ): Album {
    return this.store.create(
      createAlbum(name, city, theme, pageSize, assets, options, content),
    );
  }
  edit(id: string, revision: number, edit: Edit): Album {
    this.assertWritable(id);
    const before = this.store.get(id);
    if (!before.assetLibrary)
      before.assetLibrary = assetLibraryIndex(before, this.knownStickerIds());
    return this.store.save(applyEdit(before, edit), revision);
  }
  addAssets(
    id: string,
    revision: number,
    assets: Asset[],
    role: AssetRole = "photo",
  ): Album {
    this.assertWritable(id);
    const a = this.store.get(id);
    const index = assetLibraryIndex(
        a,
        a.assetLibrary ? [] : this.knownStickerIds(),
      ),
      key = role === "sticker" ? "stickers" : "photos";
    index[key] = [...new Set([...index[key], ...assets.map((a) => a.id)])];
    a.assets = [
      ...new Map(
        [...a.assets, ...assets].map((asset) => [asset.id, asset]),
      ).values(),
    ];
    a.assetLibrary = index;
    return this.store.save(a, revision);
  }
  history(id: string, revision: number, direction: "undo" | "redo"): Album {
    this.assertWritable(id);
    return this.store.history(id, direction, revision);
  }
}
