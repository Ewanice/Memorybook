import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  existsSync,
  renameSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { defaultSettings, DomainError, type Settings } from "../domain/model";
import { assertSettings } from "../domain/validation";
import { health } from "./health";

export const sharedPreferenceKeys = new Set([
  "settings",
  "aiConfig",
  "providerCredential",
  "codex-preferences",
]);

// Projects and libraries deliberately never enter this database.
export class SharedPreferences {
  private db: DatabaseSync;
  private version = 0;
  readonly path: string;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.path = join(directory, "preferences.sqlite");
    const open = () => {
      const db = new DatabaseSync(this.path);
      try {
        db.exec("PRAGMA busy_timeout=5000;");
        const check = db.prepare("PRAGMA quick_check").get() as {
          quick_check: string;
        };
        if (check.quick_check !== "ok")
          throw new Error("database disk image is malformed");
        const schema = (
          db.prepare("PRAGMA user_version").get() as { user_version: number }
        ).user_version;
        if (schema > 1)
          throw new DomainError("共享设置版本较新，请使用新版软件。");
        db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
        db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS quarantined_preferences(key TEXT NOT NULL,value TEXT NOT NULL,time TEXT NOT NULL);
          PRAGMA user_version=1; COMMIT;`);
        for (const [table, columns] of [
          ["preferences", ["key", "value"]],
          ["quarantined_preferences", ["key", "value", "time"]],
        ] as const) {
          const found = new Set(
            (
              db.prepare(`PRAGMA table_info(${table})`).all() as {
                name: string;
              }[]
            ).map((row) => row.name),
          );
          if (columns.some((column) => !found.has(column)))
            throw new Error("database schema is malformed");
        }
        return db;
      } catch (error) {
        db.close();
        throw error;
      }
    };
    try {
      this.db = open();
    } catch (error) {
      if (
        !/file is not a database|database disk image is malformed|database schema is malformed/.test(
          String(error),
        )
      )
        throw error;
      const damaged = join(directory, "damaged-preferences-" + Date.now());
      mkdirSync(damaged);
      for (const suffix of ["", "-wal", "-shm"])
        if (existsSync(this.path + suffix))
          renameSync(
            this.path + suffix,
            join(damaged, "preferences.sqlite" + suffix),
          );
      const backup = join(directory, "preferences-backup.sqlite");
      if (existsSync(backup)) {
        let probe: DatabaseSync | undefined;
        try {
          probe = new DatabaseSync(backup, { readOnly: true });
          if (
            (
              probe.prepare("PRAGMA quick_check").get() as {
                quick_check: string;
              }
            ).quick_check !== "ok"
          )
            throw new Error();
          probe.prepare("SELECT key,value FROM preferences").all();
          copyFileSync(backup, this.path);
        } catch {
          health.report(
            "shared-settings-backup",
            new DomainError("共享设置的备份也无法读取，原文件已保留。"),
          );
        } finally {
          probe?.close();
        }
      }
      this.db = open();
      health.report(
        "shared-settings",
        new DomainError(
          "共享设置数据库损坏，原文件已隔离保留；已尝试恢复最近副本。工程仍保存在各自软件目录，不受影响。",
        ),
      );
    }
    this.changed();
  }
  close() {
    this.db.close();
  }
  getValue(key: string): string | null {
    return (
      (
        this.db
          .prepare("SELECT value FROM preferences WHERE key=?")
          .get(key) as { value: string } | undefined
      )?.value ?? null
    );
  }
  setValue(key: string, value: string) {
    if (!sharedPreferenceKeys.has(key))
      throw new DomainError("该资料不属于共享设置。");
    this.db
      .prepare(
        "INSERT INTO preferences(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
    if (!this.db.isTransaction) this.backup();
  }
  archivePreference(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO quarantined_preferences(key,value,time) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM quarantined_preferences WHERE key=? AND value=?)",
      )
      .run(key, value, new Date().toISOString(), key, value);
  }
  transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      this.backup();
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
  seedFrom(source: { getValue(key: string): string | null }) {
    this.transaction(() => {
      // A second installation must never replace newer shared settings with its old copy.
      if (this.getValue("settings") !== null) return;
      for (const key of sharedPreferenceKeys) {
        const value = source.getValue(key);
        if (value !== null) this.setValue(key, value);
      }
      if (this.getValue("settings") === null)
        this.setValue("settings", JSON.stringify(defaultSettings));
    });
  }
  saveSettings(value: unknown, expected?: Settings): Settings {
    assertSettings(value);
    if (expected) assertSettings(expected);
    return this.transaction(() => {
      const raw = this.getValue("settings");
      let current: Settings = structuredClone(defaultSettings);
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          assertSettings(parsed);
          current = parsed;
        } catch {
          this.archivePreference("settings", raw);
        }
      }
      const next = { ...current } as Record<string, unknown>;
      if (expected) {
        const before = expected as unknown as Record<string, unknown>;
        const requested = value as unknown as Record<string, unknown>;
        for (const key of new Set([
          ...Object.keys(before),
          ...Object.keys(requested),
        ])) {
          if (before[key] === requested[key]) continue;
          if (next[key] !== before[key] && next[key] !== requested[key])
            throw new DomainError(
              "这个设置刚被另一个软件窗口修改，请查看最新值后重试。",
            );
          if (requested[key] === undefined) delete next[key];
          else next[key] = requested[key];
        }
      } else {
        for (const key of Object.keys(next)) delete next[key];
        Object.assign(next, value);
      }
      assertSettings(next);
      this.setValue("settings", JSON.stringify(next));
      return next;
    });
  }
  changed(): boolean {
    const value = (
      this.db.prepare("PRAGMA data_version").get() as { data_version: number }
    ).data_version;
    const changed = value !== this.version;
    this.version = value;
    return changed;
  }
  backup() {
    // A settings-only snapshot: it contains no projects or original photos.
    const temp = join(
      this.directory,
      `preferences-backup-${crypto.randomUUID()}.tmp`,
    );
    try {
      this.db.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
      renameSync(temp, join(this.directory, "preferences-backup.sqlite"));
      health.resolve("shared-settings-backup");
    } catch {
      health.report(
        "shared-settings-backup",
        new DomainError(
          "设置已保存，但设置备份未能更新，请检查设置目录权限与空间。",
        ),
      );
    } finally {
      try {
        if (existsSync(temp)) unlinkSync(temp);
      } catch {
        health.report(
          "shared-settings-temp",
          new DomainError("设置已保存，临时备份尚未清理，请检查设置目录权限。"),
        );
      }
    }
  }
}
