import {
  type Album,
  type Edit,
  type Element,
  DomainError,
  id,
  imageElement,
} from "./model";
import { assetLibraryIndex } from "./asset-library";
import { matchPageText } from "./art-direction";
export function applyEditCore(
  source: Album,
  edit: Exclude<Edit, { type: "batch" }>,
  mutable = false,
): Album {
  const album = mutable ? source : structuredClone(source);
  if (edit.type === "rename") album.name = edit.name.trim();
  else if (edit.type === "pagination")
    album.pagination = structuredClone(edit.value);
  else if (edit.type === "renameAsset" || edit.type === "removeAsset") {
    const asset = album.assets.find((a) => a.id === edit.assetId);
    if (!asset) throw new DomainError("素材不存在。");
    if (edit.type === "renameAsset") {
      if (!edit.name.trim()) throw new DomainError("素材名称不能为空。");
      asset.name = edit.name.trim();
    } else {
      if (
        album.pages.some((p) =>
          p.elements.some(
            (e) => e.type === "image" && e.assetId === edit.assetId,
          ),
        )
      )
        throw new DomainError("请先移除或替换使用该素材的元素。");
      album.assets = album.assets.filter((a) => a.id !== edit.assetId);
    }
  } else if (edit.type === "addPage") {
    if (
      edit.page.role === "cover" ||
      (edit.page.role === "backCover" &&
        album.pages.some((p) => p.role === "backCover"))
    )
      throw new DomainError("不能重复添加封面或封底。");
    const end =
      edit.page.role === "content" && album.pages.at(-1)?.role === "backCover"
        ? album.pages.length - 1
        : album.pages.length;
    album.pages.splice(end, 0, edit.page);
  } else if (edit.type === "replacePage") {
    const index = album.pages.findIndex((p) => p.id === edit.page.id);
    if (index < 0 || album.pages[index]!.role !== edit.page.role)
      throw new DomainError("套用模板不能改变页面身份。");
    if (album.pages[index]!.elements.some((e) => e.locked))
      throw new DomainError("页面包含锁定元素，请先解锁再套用模板。");
    album.pages[index] = edit.page;
    album.annotations = album.annotations.flatMap((n) => {
      if (n.pageId !== edit.page.id) return [n];
      const target = album.pages.find((p) =>
        p.elements.some((e) => e.id === n.elementId),
      );
      return target
        ? [
            {
              ...n,
              pageId: target.id,
              status:
                n.status === "applied"
                  ? ("applied" as const)
                  : ("needsReview" as const),
            },
          ]
        : [];
    });
  } else {
    const page = album.pages.find((p) => p.id === edit.pageId);
    if (!page) throw new DomainError("页面不存在。");
    switch (edit.type) {
      case "translateElement": {
        const element = page.elements.find((e) => e.id === edit.elementId);
        if (!element || element.locked)
          throw new DomainError("元素不存在或已锁定。");
        element.frame.x += edit.dx;
        element.frame.y += edit.dy;
        for (const note of album.annotations)
          if (note.elementId === element.id && note.status !== "applied")
            note.status = "needsReview";
        break;
      }
      case "patchElement": {
        const index = page.elements.findIndex((e) => e.id === edit.elementId);
        const current = page.elements[index];
        if (!current) throw new DomainError("元素不存在。");
        const allowed = new Set([
          "groupId",
          "frame",
          "rotation",
          "opacity",
          "locked",
          "visible",
          ...(current.type === "text"
            ? ["text", "style"]
            : current.type === "image"
              ? ["assetId", "fit", "crop", "effects"]
              : ["effects"]),
        ]);
        if (
          !edit.patch ||
          typeof edit.patch !== "object" ||
          Object.keys(edit.patch).some((key) => !allowed.has(key))
        )
          throw new DomainError("元素修改包含无效字段。");
        if (
          current.locked &&
          (Object.keys(edit.patch).length !== 1 || edit.patch.locked !== false)
        )
          throw new DomainError("请先解锁元素。");
        const patched = {
          ...current,
          ...edit.patch,
          frame: { ...current.frame, ...edit.patch.frame },
        };
        if (edit.patch.groupId === null) delete patched.groupId;
        if (current.type === "text")
          Object.assign(patched, {
            style: { ...current.style, ...edit.patch.style },
          });
        page.elements[index] = patched as Element;
        for (const note of album.annotations)
          if (note.elementId === current.id && note.status !== "applied")
            note.status = "needsReview";
        break;
      }
      case "fillSlot": {
        const index = page.elements.findIndex((e) => e.id === edit.elementId);
        const slot = page.elements[index];
        const asset = album.assets.find((a) => a.id === edit.assetId);
        if (!slot || slot.type !== "photoSlot" || slot.locked || !asset)
          throw new DomainError("照片槽或素材无效。");
        page.elements[index] = {
          ...imageElement(asset, slot.frame, slot.role ?? "photo"),
          ...(slot.effects ? { effects: structuredClone(slot.effects) } : {}),
          id: slot.id,
          rotation: slot.rotation,
          opacity: slot.opacity,
          visible: slot.visible,
          fit:
            slot.name === "票根" || slot.role === "sticker"
              ? "contain"
              : "cover",
        };
        break;
      }
      case "replaceElement": {
        const index = page.elements.findIndex((e) => e.id === edit.element.id);
        const current = page.elements[index];
        if (!current || current.type !== edit.element.type)
          throw new DomainError("不能替换不存在的元素或改变元素类型。");
        if (
          current.locked &&
          (edit.element.locked ||
            JSON.stringify({ ...current, locked: false }) !==
              JSON.stringify(edit.element))
        )
          throw new DomainError("请先解锁元素。");
        page.elements[index] = structuredClone(edit.element);
        for (const note of album.annotations)
          if (note.elementId === current.id && note.status !== "applied")
            note.status = "needsReview";
        break;
      }
      case "addElement":
        page.elements.push(edit.element);
        break;
      case "removeElement": {
        const target = page.elements.find((e) => e.id === edit.elementId);
        if (!target || target.locked)
          throw new DomainError("元素不存在或已锁定。");
        page.elements = page.elements.filter((e) => e.id !== edit.elementId);
        album.annotations = album.annotations.filter(
          (n) => n.elementId !== edit.elementId,
        );
        break;
      }
      case "layer": {
        const index = page.elements.findIndex((e) => e.id === edit.elementId);
        const el = page.elements[index];
        if (!el || el.locked) throw new DomainError("元素不存在或已锁定。");
        const next = index + (edit.direction === "up" ? 1 : -1);
        if (next >= 0 && next < page.elements.length) {
          page.elements.splice(index, 1);
          page.elements.splice(next, 0, el);
        }
        break;
      }
      case "removePage":
        if (page.role === "cover") throw new DomainError("不能删除封面。");
        album.pages = album.pages.filter((p) => p.id !== page.id);
        album.annotations = album.annotations.filter(
          (n) => n.pageId !== page.id,
        );
        break;
      case "movePage": {
        const index = album.pages.indexOf(page);
        const next = index + (edit.direction === "up" ? -1 : 1);
        if (page.role !== "content" || album.pages[next]?.role !== "content")
          throw new DomainError("内页只能在封面与封底之间排序。");
        album.pages.splice(index, 1);
        album.pages.splice(next, 0, page);
        break;
      }
      case "reorderPage": {
        const target = album.pages.find((p) => p.id === edit.beforePageId);
        if (page.role !== "content" || !target || target.role === "cover")
          throw new DomainError("内页只能在封面与封底之间排序。");
        if (page.id === target.id) break;
        album.pages = album.pages.filter((p) => p.id !== page.id);
        album.pages.splice(album.pages.indexOf(target), 0, page);
        break;
      }
      case "background":
        page.background = edit.color;
        if (edit.style !== undefined) page.backgroundStyle = edit.style;
        if (edit.textColors !== undefined) {
          if (!["match", "contrast"].includes(edit.textColors))
            throw new DomainError("文字配色方式无效。");
          const changed = new Set(matchPageText(page, edit.textColors));
          for (const note of album.annotations)
            if (changed.has(note.elementId) && note.status !== "applied")
              note.status = "needsReview";
        }
        break;
      case "annotation": {
        if (!page.elements.some((e) => e.id === edit.elementId))
          throw new DomainError("批注目标不存在。");
        const existing = album.annotations.find(
          (n) => n.elementId === edit.elementId,
        );
        if (!edit.text.trim())
          album.annotations = album.annotations.filter(
            (n) => n.elementId !== edit.elementId,
          );
        else if (existing) {
          existing.text = edit.text;
          existing.status =
            existing.status === "needsReview" && !edit.review
              ? "needsReview"
              : "pending";
          existing.message = "";
        } else
          album.annotations.push({
            id: id(),
            pageId: page.id,
            elementId: edit.elementId,
            text: edit.text,
            status: "pending",
            message: "",
          });
        break;
      }
      default:
        throw new DomainError("不支持的编辑命令。");
    }
  }
  if (album.assetLibrary) album.assetLibrary = assetLibraryIndex(album);
  return album;
}
