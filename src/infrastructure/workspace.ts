import {
  cp,
  mkdir,
  readdir,
  stat,
  lstat,
  readFile,
  writeFile,
  realpath,
  unlink,
  rm,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Store } from "./store";
import { Store as ProjectStore } from "./store";
import type { AssetStore } from "./assets";
import type { FontStore } from "./fonts";
import type { ResourceLibrary } from "./resource-library";
import { parsePhrases } from "./resource-library";
import { DomainError, type Album } from "../domain/model";
import { assertAlbum } from "../domain/validation";
import { requireSpace } from "./archive";
import { health } from "./health";

export async function folderBytes(path: string): Promise<number> {
  let total = 0;
  try {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = join(path, entry.name);
      total += entry.isDirectory()
        ? await folderBytes(file)
        : (await stat(file)).size;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return total;
}
export async function storageUsage(
  store: Store,
  assets: AssetStore,
  fonts: FontStore,
) {
  const measure = async (path: string) => {
    try {
      return await folderBytes(path);
    } catch {
      health.report(
        `storage:${path}`,
        new DomainError(
          "一个资料目录无法统计大小，其他资料与恢复功能可继续使用。",
        ),
      );
      return null;
    }
  };
  let protectedIds: Set<string> | null = null,
    cleanupBlocked = "";
  try {
    protectedIds = store.protectedAssets();
  } catch (error) {
    cleanupBlocked =
      error instanceof Error ? error.message : "资料引用暂时无法检查。";
  }
  let reclaimable = 0;
  try {
    for (const name of await readdir(assets.directory)) {
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      const info = await lstat(assets.path(name));
      if (!info.isFile() || info.isSymbolicLink()) continue;
      if (
        protectedIds &&
        !protectedIds.has(name) &&
        Date.now() - info.mtimeMs > 86400000
      )
        reclaimable += info.size;
    }
  } catch {
    cleanupBlocked = "原图目录暂不可读取，无法安全确认可回收文件。";
  }
  const disk = await (await import("node:fs/promises")).statfs(store.directory);
  return {
    databaseCopies: store.databaseCopies(),
    originals: await measure(assets.directory),
    cleanupBlocked,
    reclaimable,
    database:
      (await stat(join(store.directory, "memorybook.sqlite"))).size +
      (await optionalBytes(join(store.directory, "memorybook.sqlite-wal"))) +
      (await optionalBytes(join(store.directory, "memorybook.sqlite-shm"))),
    snapshots: await measure(join(store.directory, "snapshots")),
    fonts: await measure(fonts.directory),
    previews: await measure(assets.cacheDirectory),
    browser: await measure(join(store.directory, "browser-cache")),
    free: disk.bavail * disk.bsize,
  };
}
async function optionalBytes(path: string) {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}
export async function cleanupOriginals(
  store: Store,
  assets: AssetStore,
  pending: Iterable<string> = [],
): Promise<number> {
  const protectedIds = store.protectedAssets();
  for (const id of pending) protectedIds.add(id);
  let bytes = 0;
  for (const name of await readdir(assets.directory)) {
    if (!/^[a-f0-9]{64}$/.test(name) || protectedIds.has(name)) continue;
    const info = await lstat(assets.path(name));
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      Date.now() - info.mtimeMs < 86400000
    )
      continue;
    await unlink(assets.path(name));
    bytes += info.size;
  }
  return bytes;
}
export async function backupWorkspace(
  parent: string,
  store: Store,
  assets: AssetStore,
  fonts: FontStore,
  resources: ResourceLibrary,
): Promise<string> {
  const source = resolve(store.directory),
    target = resolve(parent);
  if (
    target === source ||
    target.startsWith(source + sep) ||
    target === resolve(assets.directory) ||
    target === resolve(fonts.directory) ||
    target.startsWith(resolve(fonts.directory) + sep)
  )
    throw new DomainError("请选择资料目录以外的备份位置。");
  let extra = 0;
  for (const name of await readdir(store.directory))
    if (
      /^(before-schema-v\d+|database-backup)-\d+\.sqlite$/.test(name) ||
      name.startsWith("damaged-database-")
    ) {
      const path = join(store.directory, name),
        info = await stat(path);
      extra += info.isDirectory() ? await folderBytes(path) : info.size;
    }
  await requireSpace(
    parent,
    (await folderBytes(assets.directory)) +
      (await folderBytes(fonts.directory)) +
      (await folderBytes(join(store.directory, "snapshots"))) +
      (await optionalBytes(join(store.directory, "memorybook.sqlite"))) +
      (await optionalBytes(join(store.directory, "memorybook.sqlite-wal"))) +
      (await optionalBytes(resources.phrasePath)) +
      extra,
  );
  const directory = join(parent, `memorybook-backup-${Date.now()}`);
  await mkdir(join(directory, "data"), { recursive: true });
  store.checkpoint(join(directory, "data", "memorybook.sqlite"));
  await cp(assets.directory, join(directory, "data", "assets"), {
    recursive: true,
    dereference: false,
  });
  await cp(fonts.directory, join(directory, "fonts"), {
    recursive: true,
    dereference: false,
  });
  await cp(
    join(store.directory, "snapshots"),
    join(directory, "data", "snapshots"),
    { recursive: true, dereference: false },
  );
  try {
    await cp(resources.phrasePath, join(directory, "phrases.txt"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const name of await readdir(store.directory)) {
    if (
      /^(before-schema-v\d+|database-backup)-\d+\.sqlite$/.test(name) ||
      name.startsWith("damaged-database-")
    )
      await cp(join(store.directory, name), join(directory, "data", name), {
        recursive: true,
        dereference: false,
      });
  }
  // Written last: an interrupted backup is never advertised as complete.
  await writeFile(
    join(directory, "memorybook-backup.json"),
    JSON.stringify({
      format: 1,
      createdAt: new Date().toISOString(),
      application: "Memorybook",
    }),
  );
  return directory;
}
export async function restoreWorkspace(
  directory: string,
  store: Store,
  assets: AssetStore,
  fonts: FontStore,
  resources: ResourceLibrary,
): Promise<string> {
  const root = await realpath(directory);
  const safeFile = async (relative: string) => {
    const path = await realpath(join(root, relative));
    if (!path.startsWith(root + sep) || !(await lstat(path)).isFile())
      throw new DomainError("备份路径无效。");
    return path;
  };
  const manifest = JSON.parse(
    await readFile(await safeFile("memorybook-backup.json"), "utf8"),
  );
  if (manifest.format !== 1 || manifest.application !== "Memorybook")
    throw new DomainError("此目录不是完整的资料备份。");
  const temp = join(store.directory, `workspace-import-${crypto.randomUUID()}`);
  await mkdir(temp);
  let incoming: ProjectStore | undefined;
  let count = 0;
  const failures: string[] = [];
  try {
    await cp(
      await safeFile("data/memorybook.sqlite"),
      join(temp, "memorybook.sqlite"),
    );
    const sourceStore = new ProjectStore(temp);
    incoming = sourceStore;
    const source = new (await import("./resource-library")).ResourceLibrary(
      sourceStore,
      join(root, "phrases.txt"),
      resources.phrasePath,
    );
    const projects = sourceStore.list();
    const stickerRecords = source.stickers();
    const deleted: Album[] = [];
    for (const item of sourceStore
      .recovery()
      .filter((i) => i.kind === "trash")) {
      try {
        deleted.push(sourceStore.trashAlbum(item.id));
      } catch {
        failures.push("损坏的回收站工程");
      }
    }
    const records = [
      ...projects.flatMap((p) => sourceStore.get(p.id).assets),
      ...deleted.flatMap((a) => a.assets),
      ...stickerRecords,
    ];
    const snapshotPaths: string[] = [];
    let snapshotNames: string[] = [];
    try {
      snapshotNames = await readdir(join(root, "data", "snapshots"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const name of snapshotNames.filter((n) =>
      /^[A-Za-z0-9_-]{1,80}\.\d+\.json$/.test(n),
    )) {
      try {
        const path = await safeFile(`data/snapshots/${name}`);
        if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error();
        const album: unknown = JSON.parse(await readFile(path, "utf8"));
        assertAlbum(album);
        records.push(...album.assets);
        snapshotPaths.push(path);
      } catch {
        failures.push("损坏的恢复副本");
      }
    }
    for (const asset of new Map(records.map((a) => [a.id, a])).values()) {
      try {
        const path = await safeFile(`data/assets/${asset.id}`);
        if ((await stat(path)).size > 25 * 1024 * 1024) throw new Error();
        await assets.put(await readFile(path), asset.name, asset.id);
      } catch {
        failures.push(`素材 ${asset.name}`);
      }
    }
    let names: string[] = [];
    try {
      names = await readdir(join(root, "fonts"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const id of names.filter((n) => /^[a-f0-9]{64}$/.test(n))) {
      try {
        const path = await safeFile(`fonts/${id}`);
        if ((await stat(path)).size > 32 * 1024 * 1024) throw new Error();
        await fonts.put(await readFile(path), id);
      } catch {
        failures.push(`字体 ${id.slice(0, 8)}`);
      }
    }
    store.transaction(() => {
      for (const summary of projects) {
        store.copyFrom(sourceStore, summary.id);
        count++;
      }
      for (const album of deleted) {
        album.id = crypto.randomUUID();
        store.importTrash(album);
      }
      const stickerMap = [
        ...new Map(
          [...resources.stickers(), ...stickerRecords].map((a) => [a.id, a]),
        ).values(),
      ];
      if (stickerMap.length > 500)
        throw new DomainError("合并后的贴纸超过 500 张，请先整理贴纸库。");
      resources.addStickers(stickerRecords);
      const existing = resources.layouts();
      const layouts = source.layouts();
      if (existing.length + layouts.length > 50)
        throw new DomainError("合并后的自定义排版超过 50 个，请先整理排版库。");
      for (const layout of layouts)
        resources.saveLayout({
          ...layout,
          id: crypto.randomUUID(),
          name: layout.name.slice(0, 54) + "（恢复）",
        });
    });
    for (const path of snapshotPaths) {
      try {
        const album: unknown = JSON.parse(await readFile(path, "utf8"));
        assertAlbum(album);
        store.snapshot(album, true);
      } catch {
        failures.push("恢复副本无法写入");
      }
    }
    sourceStore.checkpoint(
      join(store.directory, `before-schema-v4-${Date.now()}.sqlite`),
    );
    try {
      const sourcePath = await safeFile("phrases.txt");
      if ((await stat(sourcePath)).size > 512 * 1024)
        throw new DomainError("备份短语文件过大。");
      const lines = parsePhrases(await readFile(sourcePath, "utf8"));
      const current = await resources.phraseDocument();
      const existing = new Set(parsePhrases(current.text));
      const added = lines.filter((line) => !existing.has(line));
      if (added.length)
        await resources.savePhrases(
          current.text.trimEnd() + "\n" + added.join("\n") + "\n",
          current.hash,
        );
    } catch (error) {
      failures.push("短语库（未覆盖现有文件）");
    }
    return `已合并恢复 ${count} 本纪念册，现有工程未被覆盖。${failures.length ? `有 ${failures.length} 项资源异常，相关图片可在编辑器替换，字体可重新导入。` : ""}`;
  } finally {
    incoming?.close();
    const resolved = resolve(temp);
    if (
      !resolved.startsWith(resolve(store.directory) + sep) ||
      !resolved.split(sep).at(-1)?.startsWith("workspace-import-")
    )
      throw new DomainError("临时目录清理范围无效。");
    await rm(resolved, { recursive: true, force: true }).catch(() =>
      health.report(
        "workspace-cleanup",
        new DomainError(
          "资料导入后的临时文件清理未完成，请检查目录权限；已导入的工程不受影响。",
        ),
      ),
    );
  }
}
