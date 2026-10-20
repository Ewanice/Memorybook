import { type Album, type Edit } from "./model";
import { assertAlbum, assertElement } from "./validation";
import { applyEditCore } from "./edit-core";
import { DomainError } from "./model";
export function applyEdit(source: Album, edit: Edit): Album {
  if (edit.type === "batch") {
    if (
      !Array.isArray(edit.edits) ||
      !edit.edits.length ||
      edit.edits.length > 10100 ||
      edit.edits.some((e) => e.type === "batch")
    )
      throw new DomainError("批量编辑数量或结构无效。");
    let next = structuredClone(source);
    for (const action of edit.edits) {
      if ("element" in action) assertElement(action.element);
      next = applyEditCore(
        next,
        action as Exclude<Edit, { type: "batch" }>,
        true,
      );
    }
    assertAlbum(next);
    return next;
  }
  if ("element" in edit) assertElement(edit.element);
  const album = applyEditCore(source, edit);
  assertAlbum(album);
  return album;
}
