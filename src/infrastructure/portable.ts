import type { App } from "electron";
import { mkdirSync } from "node:fs";
import {
  access,
  mkdir,
  cp,
  writeFile,
  rename,
  readFile,
  readdir,
} from "node:fs/promises";
import { FontStore } from "./fonts";
import { health } from "./health";
import { join, dirname, basename, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
export type StoragePaths = {
  root: string;
  data: string;
  migrate: boolean;
  preferences?: string;
};
export function configureStorage(app: App, development: boolean): StoragePaths {
  const appPath = app.getAppPath();
  const exe = dirname(app.getPath("exe"));
  const root = development
    ? appPath
    : appPath.endsWith(".asar")
      ? dirname(dirname(appPath))
      : /^app-\d/.test(basename(exe))
        ? dirname(exe)
        : exe;
  const explicit = process.argv
    .find((arg) => arg.startsWith("--user-data-dir="))
    ?.slice(16);
  const data = resolve(
    (development && process.env.MEMORY_USER_DATA) ||
      explicit ||
      join(root, development ? ".local/user-data" : "data"),
  );
  mkdirSync(data, { recursive: true });
  mkdirSync(join(data, "browser-cache"), { recursive: true });
  app.setPath("userData", data);
  app.setPath("sessionData", join(data, "browser-cache"));
  app.setAppLogsPath(join(data, "logs"));
  return {
    root,
    data,
    migrate: !development && !explicit,
    preferences: resolve(
      process.argv
        .find((arg) => arg.startsWith("--settings-dir="))
        ?.slice(15) ||
        (development || explicit
          ? join(data, "shared-settings")
          : join(app.getPath("appData"), "Memorybook", "shared-settings")),
    ),
  };
}
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return false;
  }
}
export async function migratePortableNames(
  paths: StoragePaths,
  seedPath: string,
): Promise<void> {
  const marker = join(paths.data, "path-migration-v131.json");
  if (await exists(marker)) return;
  const oldPhrases = join(paths.root, "短语库.txt"),
    target = join(paths.root, "phrases.txt");
  if (await exists(oldPhrases)) {
    const seed = await readFile(seedPath);
    if (!(await exists(target)) || (await readFile(target)).equals(seed)) {
      const temp = `${target}.${crypto.randomUUID()}.tmp`;
      await writeFile(temp, await readFile(oldPhrases));
      await rename(temp, target);
    }
  }
  const oldFonts = join(paths.root, "素材", "导入字体");
  if (await exists(oldFonts)) {
    const fonts = new FontStore(
      join(paths.root, "materials", "imported-fonts"),
    );
    for (const name of await readdir(oldFonts))
      if (/^[a-f0-9]{64}$/.test(name))
        try {
          await fonts.put(await readFile(join(oldFonts, name)), name);
        } catch {
          health.report(
            `legacy-font:${name}`,
            new Error("一个旧版字体损坏，原文件保留，其他字体继续迁移。"),
          );
        }
  }
  await writeFile(
    marker,
    JSON.stringify({ version: "1.3.1", legacyFilesPreserved: true }),
  );
}
// Copy a consistent database snapshot last, so interruption never leaves a half-migrated profile active.
export async function migrateLegacy(paths: StoragePaths): Promise<void> {
  await mkdir(paths.data, { recursive: true });
  const probe = join(paths.data, `.write-${crypto.randomUUID()}`);
  const { unlink } = await import("node:fs/promises");
  await writeFile(probe, "");
  await unlink(probe);
  // Only upgrade data already beside this executable. A new folder must never
  // inherit another installation's projects, settings or credentials.
  const sourceDirectory = join(paths.root, "数据");
  const destination = join(paths.data, "memorybook.sqlite"),
    source = join(sourceDirectory, "memorybook.sqlite");
  if (!paths.migrate || (await exists(destination)) || !(await exists(source)))
    return;
  const temp = join(paths.data, `migration-${crypto.randomUUID()}.sqlite`);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  if (await exists(join(sourceDirectory, "assets")))
    await cp(join(sourceDirectory, "assets"), join(paths.data, "assets"), {
      recursive: true,
    });
  await rename(temp, destination);
  await writeFile(
    join(paths.data, "migration-notes.txt"),
    "已从软件同目录的旧版数据文件夹复制工程、素材和设置，原目录保留。未读取系统用户目录。\n",
  );
}
