import type { Album, Asset } from "./model";
export type AssetRole = "photo" | "sticker";
export type AssetLibraryIndex = { photos: string[]; stickers: string[] };
export function assetLibraryIndex(
  album: Album,
  knownStickers: Iterable<string> = [],
): AssetLibraryIndex {
  const available = new Set(album.assets.map((a) => a.id));
  const photos = new Set(album.assetLibrary?.photos ?? []),
    stickers = new Set(album.assetLibrary?.stickers ?? []);
  for (const page of album.pages)
    for (const e of page.elements)
      if (e.type === "image")
        (e.role === "sticker" ? stickers : photos).add(e.assetId);
  // Old projects did not record unused sticker roles; match their IDs against the local sticker library.
  if (!album.assetLibrary)
    for (const id of knownStickers) if (available.has(id)) stickers.add(id);
  for (const a of album.assets)
    if (!photos.has(a.id) && !stickers.has(a.id)) photos.add(a.id);
  return {
    photos: [...photos].filter((id) => available.has(id)),
    stickers: [...stickers].filter((id) => available.has(id)),
  };
}
export function assetsForRole(
  album: Album,
  role: AssetRole,
  libraryStickers: Asset[] = [],
): Asset[] {
  const index = assetLibraryIndex(
      album,
      libraryStickers.map((a) => a.id),
    ),
    ids = new Set(role === "sticker" ? index.stickers : index.photos);
  return [
    ...new Map(
      [
        ...(role === "sticker" ? libraryStickers : []),
        ...album.assets.filter((a) => ids.has(a.id)),
      ].map((a) => [a.id, a]),
    ).values(),
  ];
}
