import { DatabaseSync } from "node:sqlite";
import {
  stat,
  rename,
  mkdir,
  readdir,
  copyFile,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { Store } from "./store";
import { health } from "./health";
import { DomainError } from "../domain/model";
function checkDatabase(db: DatabaseSync): number {
  const results = db.prepare("PRAGMA quick_check").all() as {
    quick_check: string;
  }[];
  if (results.length !== 1 || results[0]?.quick_check !== "ok")
    throw new Error("database disk image is malformed");
  const version = (
    db.prepare("PRAGMA user_version").get() as { user_version: number }
  ).user_version;
  if (version > 4) return version;
  const tables = new Set(
    (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all() as { name: string }[]
    ).map((t) => t.name),
  );
  if (version === 0) {
    if (tables.size) throw new Error("database schema is malformed");
    return version;
  }
  const required: Record<string, string[]> = {
    albums: ["id", "revision", "document", "cursor"],
    history: [
      "album_id",
      "seq",
      "before_doc",
      "after_doc",
      ...(version >= 2 ? ["origin"] : []),
    ],
    preferences: ["key", "value"],
  };
  for (const [name, columns] of Object.entries(required)) {
    if (!tables.has(name)) throw new Error("database schema is malformed");
    const found = new Set(
      (
        db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]
      ).map((c) => c.name),
    );
    if (columns.some((c) => !found.has(c)))
      throw new Error("database schema is malformed");
  }
  return version;
}

export async function openStore(directory: string): Promise<Store> {
  const path = join(directory, "memorybook.sqlite");
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return new Store(directory);
    throw error;
  }
  let probe: DatabaseSync | undefined;
  try {
    probe = new DatabaseSync(path, { readOnly: true });
    checkDatabase(probe);
  } catch (error) {
    probe?.close();
    probe = undefined;
    if (
      !/file is not a database|database disk image is malformed|database schema is malformed/i.test(
        error instanceof Error ? error.message : "",
      )
    )
      throw error;
    const quarantine = join(directory, `damaged-database-${Date.now()}`);
    await mkdir(quarantine);
    // Preserve the complete SQLite family, including a possible uncheckpointed WAL.
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        await rename(
          path + suffix,
          join(quarantine, "memorybook.sqlite" + suffix),
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    health.report(
      "database",
      new DomainError(
        "工程数据库损坏，原始数据库已完整隔离保留。软件已打开新的工作空间，可从“备份与恢复”找回自动副本或导入资料备份。",
      ),
    );
    const candidates = (await readdir(directory))
      .filter((n) => /^database-backup-\d+\.sqlite$/.test(n))
      .sort()
      .reverse();
    for (const name of candidates) {
      let candidate: DatabaseSync | undefined;
      try {
        candidate = new DatabaseSync(join(directory, name), { readOnly: true });
        if (checkDatabase(candidate) > 4) continue;
        candidate.close();
        candidate = undefined;
        const temporary = path + ".recovering-" + crypto.randomUUID() + ".tmp";
        try {
          await copyFile(join(directory, name), temporary);
          await rename(temporary, path);
        } catch (error) {
          await unlink(temporary).catch(() => {});
          throw error;
        }
        health.report(
          "database",
          new DomainError(
            "数据库损坏，原始文件已隔离保留；已从最近一次完整数据库副本恢复。请检查最近几分钟的修改，也可从恢复中心找回工程副本。",
          ),
        );
        break;
      } catch {
        health.report(
          `database-backup:${name}`,
          new DomainError("一个数据库恢复副本损坏，已跳过并尝试其他副本。"),
        );
      } finally {
        candidate?.close();
      }
    }
  } finally {
    probe?.close();
  }
  return new Store(directory);
}
