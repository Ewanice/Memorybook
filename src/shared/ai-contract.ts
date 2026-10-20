import type { Album } from "../domain/model";
import { DomainError } from "../domain/model";
import { assertAlbum } from "../domain/validation";
export type AiRequest = {
  taskId: string;
  album: Album;
  previews: { assetId: string; dataUrl: string }[];
};
export type AiAccount = { remaining: number; checkedAt: string };
export function assertAiRequest(value: unknown): asserts value is AiRequest {
  if (!value || typeof value !== "object")
    throw new DomainError("AI 请求无效。");
  const input = value as AiRequest;
  if (
    Object.keys(input).sort().join() !== "album,previews,taskId" ||
    typeof input.taskId !== "string" ||
    !/^[\w-]{1,80}$/.test(input.taskId)
  )
    throw new DomainError("AI 请求编号无效。");
  assertAlbum(input.album);
  if (
    !input.album.annotations.length ||
    input.album.annotations.length > 100 ||
    input.album.annotations.some((n) => n.status !== "pending")
  )
    throw new DomainError("每次提交 1–100 条待处理批注。");
  if (!Array.isArray(input.previews) || input.previews.length > 100)
    throw new DomainError("AI 预览数量无效。");
  const ids = new Set<string>();
  for (const preview of input.previews) {
    if (
      typeof preview.assetId !== "string" ||
      ids.has(preview.assetId) ||
      !input.album.assets.some((a) => a.id === preview.assetId) ||
      typeof preview.dataUrl !== "string" ||
      preview.dataUrl.length > 300000 ||
      !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(preview.dataUrl)
    )
      throw new DomainError("AI 预览格式无效。");
    ids.add(preview.assetId);
  }
}
