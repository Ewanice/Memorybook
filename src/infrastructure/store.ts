import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  writeFileSync,
  renameSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { Album, AlbumSummary, Settings } from "../domain/model";
import { defaultSettings, DomainError } from "../domain/model";
import { assertAlbum, assertSettings } from "../domain/validation";
import jsonPatch from "fast-json-patch";
import { health } from "./health";
const { compare, applyPatch } = jsonPatch;

export class Store {
  private db: DatabaseSync;
  private backupReferences = new Map<
    string,
    { signature: string; ids: Set<string> }
  >();
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, "memorybook.sqlite"));
    try {
      this.db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;",
      );
      const version = (
        this.db.prepare("PRAGMA user_version").get() as { user_version: number }
      ).user_version;
      if (version > 4)
        throw new DomainError("工程数据库版本较新，请使用新版软件打开。");
      if (version === 0)
        this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE albums(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE history(album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE, seq INTEGER NOT NULL, before_doc TEXT NOT NULL, after_doc TEXT NOT NULL, PRIMARY KEY(album_id, seq));
      CREATE TABLE preferences(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
      if (version > 0 && version < 3) {
        const backup = join(
          directory,
          `before-schema-v3-${Date.now()}.sqlite`,
        ).replace(/'/g, "''");
        this.db.exec(`VACUUM INTO '${backup}'`);
      }
      if (version === 3) {
        const backup = join(
          directory,
          `before-schema-v4-${Date.now()}.sqlite`,
        ).replace(/'/g, "''");
        this.db.exec(`VACUUM INTO '${backup}'`);
      }
      if (version <= 1)
        this.db.exec(
          "BEGIN IMMEDIATE; ALTER TABLE history ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'; PRAGMA user_version=2; COMMIT;",
        );
      if (version < 3)
        this.transaction(() => {
          const rows = this.db
            .prepare("SELECT album_id,seq,before_doc,after_doc FROM history")
            .all() as {
            album_id: string;
            seq: number;
            before_doc: string;
            after_doc: string;
          }[];
          const damaged = new Set<string>();
          for (const row of rows) {
            try {
              const before = this.parse(row.before_doc);
              const after = this.parse(row.after_doc);
              this.db
                .prepare(
                  "UPDATE history SET before_doc=?,after_doc=? WHERE album_id=? AND seq=?",
                )
                .run(
                  JSON.stringify(compare(after, before)),
                  JSON.stringify(compare(before, after)),
                  row.album_id,
                  row.seq,
                );
            } catch {
              damaged.add(row.album_id);
            }
          }
          for (const id of damaged) {
            this.db.prepare("DELETE FROM history WHERE album_id=?").run(id);
            this.db.prepare("UPDATE albums SET cursor=0 WHERE id=?").run(id);
            health.report(
              `history:${id}`,
              new DomainError(
                "一个旧工程的撤销历史损坏，正文仍可编辑；原始历史保留在升级前数据库副本中。",
              ),
            );
          }
          this.db.exec("PRAGMA user_version=3");
        });
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS trash(id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quarantined_preferences(key TEXT NOT NULL, value TEXT NOT NULL, time TEXT NOT NULL);
      PRAGMA user_version=4;`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
  transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = action();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  getValue(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM preferences WHERE key=?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }
  setValue(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO preferences(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
  settings(): Settings {
    const raw = this.getValue("settings");
    if (raw === null) return structuredClone(defaultSettings);
    try {
      const value: unknown = JSON.parse(raw);
      assertSettings(value);
      health.resolve("settings");
      return value;
    } catch (error) {
      health.report(
        "settings",
        new DomainError(
          "设置损坏，暂用默认设置；原始设置保留，可在恢复中心查看。",
        ),
      );
      return structuredClone(defaultSettings);
    }
  }
  saveSettings(value: unknown): Settings {
    assertSettings(value);
    const raw = this.getValue("settings");
    if (raw) {
      try {
        assertSettings(JSON.parse(raw));
      } catch {
        this.archivePreference("settings", raw);
      }
    }
    this.setValue("settings", JSON.stringify(value));
    health.resolve("settings");
    return value;
  }
  list(): AlbumSummary[] {
    const summaries: AlbumSummary[] = [];
    for (const row of this.db
      .prepare("SELECT id,document FROM albums")
      .iterate() as Iterable<{ id: string; document: string }>) {
      try {
        const album = this.parse(row.document),
          page = album.pages[0]!,
          used = new Set(
            page.elements.flatMap((e) =>
              e.type === "image" ? [e.assetId] : [],
            ),
          );
        health.resolve(`album:${row.id}`);
        summaries.push({
          id: album.id,
          name: album.name,
          updatedAt: album.updatedAt,
          theme: album.theme,
          pages: album.pages.length,
          cover: {
            page,
            size: album.size,
            assets: album.assets.filter((asset) => used.has(asset.id)),
          },
        });
      } catch {
        health.report(
          `album:${row.id}`,
          new DomainError(
            `工程 ${row.id.slice(0, 8)} 损坏，已隔离；其他工程可正常使用。`,
          ),
        );
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  private parse(raw: string): Album {
    const value: unknown = JSON.parse(raw);
    assertAlbum(value);
    return value;
  }
  get(id: string): Album {
    const row = this.db
      .prepare("SELECT document FROM albums WHERE id=?")
      .get(id) as { document: string } | undefined;
    if (!row) throw new DomainError("纪念册不存在。");
    return this.parse(row.document);
  }
  create(album: Album): Album {
    assertAlbum(album);
    this.db
      .prepare("INSERT INTO albums(id,revision,document) VALUES(?,?,?)")
      .run(album.id, album.revision, JSON.stringify(album));
    this.snapshot(album, true);
    return album;
  }
  save(
    album: Album,
    expectedRevision: number,
    origin: "manual" | "ai" = "manual",
  ): Album {
    assertAlbum(album);
    const saved = this.transaction(() => {
      const row = this.db
        .prepare("SELECT revision,document,cursor FROM albums WHERE id=?")
        .get(album.id) as
        { revision: number; document: string; cursor: number } | undefined;
      if (!row || row.revision !== expectedRevision)
        throw new DomainError("项目版本已变化，请重新打开后继续编辑。");
      const next = {
        ...album,
        revision: row.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      this.db
        .prepare("DELETE FROM history WHERE album_id=? AND seq>?")
        .run(album.id, row.cursor);
      const previous = this.parse(row.document);
      this.db
        .prepare("INSERT INTO history VALUES(?,?,?,?,?)")
        .run(
          album.id,
          row.cursor + 1,
          JSON.stringify(compare(next, previous)),
          JSON.stringify(compare(previous, next)),
          origin,
        );
      this.db
        .prepare("UPDATE albums SET revision=?,document=?,cursor=? WHERE id=?")
        .run(next.revision, JSON.stringify(next), row.cursor + 1, album.id);
      this.db
        .prepare("DELETE FROM history WHERE album_id=? AND seq<=?")
        .run(album.id, row.cursor + 1 - 200);
      return next;
    });
    this.snapshot(saved);
    return saved;
  }
  history(
    id: string,
    direction: "undo" | "redo",
    expectedRevision: number,
  ): Album {
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT revision,cursor FROM albums WHERE id=?")
        .get(id) as { revision: number; cursor: number } | undefined;
      if (!row || row.revision !== expectedRevision)
        throw new DomainError("项目版本已变化。");
      const seq = direction === "undo" ? row.cursor : row.cursor + 1;
      const entry = this.db
        .prepare(
          "SELECT before_doc,after_doc FROM history WHERE album_id=? AND seq=?",
        )
        .get(id, seq) as { before_doc: string; after_doc: string } | undefined;
      if (!entry)
        throw new DomainError(
          direction === "undo" ? "没有可撤销的修改。" : "没有可重做的修改。",
        );
      const album = applyPatch(
        this.get(id),
        JSON.parse(direction === "undo" ? entry.before_doc : entry.after_doc),
        true,
        false,
        true,
      ).newDocument;
      assertAlbum(album);
      album.revision = row.revision + 1;
      album.updatedAt = new Date().toISOString();
      this.db
        .prepare("UPDATE albums SET revision=?,document=?,cursor=? WHERE id=?")
        .run(
          album.revision,
          JSON.stringify(album),
          direction === "undo" ? seq - 1 : seq,
          id,
        );
      return album;
    });
  }
  remove(id: string): void {
    this.transaction(() => {
      const row = this.db
        .prepare("SELECT document FROM albums WHERE id=?")
        .get(id) as { document: string } | undefined;
      if (!row) throw new DomainError("纪念册不存在。");
      this.db
        .prepare("INSERT OR REPLACE INTO trash VALUES(?,?,?)")
        .run(id, new Date().toISOString(), row.document);
      this.db.prepare("DELETE FROM albums WHERE id=?").run(id);
    });
  }
  archivePreference(key: string, value: string): void {
    const previous = this.db
      .prepare(
        "SELECT value FROM quarantined_preferences WHERE key=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(key) as { value: string } | undefined;
    if (previous?.value !== value)
      this.db
        .prepare("INSERT INTO quarantined_preferences VALUES(?,?,?)")
        .run(key, value, new Date().toISOString());
  }
  private snapshotTimes = new Map<string, number>();
  snapshot(album: Album, force = false): void {
    if (!force && Date.now() - (this.snapshotTimes.get(album.id) ?? 0) < 300000)
      return;
    try {
      const directory = join(this.directory, "snapshots");
      mkdirSync(directory, { recursive: true });
      const stamp = Math.max(
        Date.now(),
        (this.snapshotTimes.get(album.id) ?? 0) + 1,
      );
      const name = `${album.id}.${stamp}.json`,
        path = join(directory, name);
      writeFileSync(path + ".tmp", JSON.stringify(album));
      renameSync(path + ".tmp", path);
      this.snapshotTimes.set(album.id, stamp);
      const files = readdirSync(directory)
        .filter((n) => n.startsWith(album.id + ".") && n.endsWith(".json"))
        .sort();
      for (const stale of files.slice(0, -10))
        unlinkSync(join(directory, stale));
      health.resolve(`snapshot:${album.id}`);
    } catch (error) {
      health.report(
        `snapshot:${album.id}`,
        new DomainError("工程已保存，但自动恢复副本写入失败，请检查剩余空间。"),
      );
    }
  }
  recovery(): {
    id: string;
    name: string;
    time: string;
    kind: "trash" | "snapshot" | "damaged";
    recoverable?: boolean;
  }[] {
    const result: ReturnType<Store["recovery"]> = [];
    for (const row of this.db
      .prepare("SELECT id,deleted_at,document FROM trash")
      .all() as { id: string; deleted_at: string; document: string }[]) {
      let name = row.id;
      let recoverable = true;
      try {
        name = this.parse(row.document).name;
      } catch {
        recoverable = false;
        /* Preserve the original bytes for manual recovery. */
      }
      result.push({
        id: row.id,
        name,
        time: row.deleted_at,
        kind: "trash",
        recoverable,
      });
    }
    for (const row of this.db
      .prepare("SELECT id,document FROM albums")
      .all() as { id: string; document: string }[]) {
      try {
        this.parse(row.document);
      } catch {
        result.push({
          id: row.id,
          name: `损坏工程 ${row.id.slice(0, 8)}`,
          time: "",
          kind: "damaged",
        });
      }
    }
    const directory = join(this.directory, "snapshots");
    mkdirSync(directory, { recursive: true });
    for (const file of readdirSync(directory).filter((n) =>
      /^[A-Za-z0-9_-]{1,80}\.\d+\.json$/.test(n),
    )) {
      try {
        const album = this.parse(readFileSync(join(directory, file), "utf8"));
        result.push({
          id: file,
          name: album.name,
          time: album.updatedAt,
          kind: "snapshot",
        });
      } catch (error) {
        health.report(
          `snapshot-file:${file}`,
          new DomainError("一个恢复副本损坏，已跳过。"),
        );
        result.push({
          id: file,
          name: "损坏的恢复副本",
          time: "",
          kind: "snapshot",
          recoverable: false,
        });
      }
    }
    return result.sort((a, b) => b.time.localeCompare(a.time));
  }
  recover(id: string, kind: "trash" | "snapshot"): Album {
    if (kind === "trash") {
      const row = this.db
        .prepare("SELECT document FROM trash WHERE id=?")
        .get(id) as { document: string } | undefined;
      if (!row) throw new DomainError("回收站工程不存在。");
      const album = this.parse(row.document);
      this.transaction(() => {
        this.create(album);
        this.db.prepare("DELETE FROM trash WHERE id=?").run(id);
      });
      return album;
    }
    if (!/^[A-Za-z0-9_-]{1,80}\.\d+\.json$/.test(id))
      throw new DomainError("恢复副本编号无效。");
    const album = this.parse(
      readFileSync(join(this.directory, "snapshots", id), "utf8"),
    );
    album.id = crypto.randomUUID();
    album.revision = 0;
    album.name = album.name.slice(0, 112) + "（恢复副本）";
    album.updatedAt = new Date().toISOString();
    return this.create(album);
  }
  checkpoint(path: string): void {
    this.db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  }
  rawRecovery(id: string, kind: "trash" | "snapshot" | "damaged"): Buffer {
    if (kind === "snapshot") {
      if (!/^[A-Za-z0-9_-]{1,80}\.\d+\.json$/.test(id))
        throw new DomainError("恢复副本编号无效。");
      return readFileSync(join(this.directory, "snapshots", id));
    }
    if (kind !== "trash" && kind !== "damaged")
      throw new DomainError("恢复记录类型无效。");
    const row = this.db
      .prepare(
        `SELECT document FROM ${kind === "trash" ? "trash" : "albums"} WHERE id=?`,
      )
      .get(id) as { document: string } | undefined;
    if (!row) throw new DomainError("恢复记录不存在。");
    return Buffer.from(row.document);
  }
  purgeRecovery(id: string, kind: "trash" | "snapshot"): void {
    if (kind === "trash") {
      this.db.prepare("DELETE FROM trash WHERE id=?").run(id);
      health.resolve(`album:${id}`);
      return;
    }
    if (kind !== "snapshot" || !/^[A-Za-z0-9_-]{1,80}\.\d+\.json$/.test(id))
      throw new DomainError("恢复记录无效。");
    unlinkSync(join(this.directory, "snapshots", id));
    health.resolve(`snapshot-file:${id}`);
  }
  databaseCopies(): { name: string; time: string; bytes: number }[] {
    return readdirSync(this.directory)
      .filter((name) =>
        /^(before-schema-v\d+|database-backup)-\d+\.sqlite$/.test(name),
      )
      .map((name) => {
        const info = statSync(join(this.directory, name));
        return { name, time: info.mtime.toISOString(), bytes: info.size };
      })
      .sort((a, b) => b.time.localeCompare(a.time));
  }
  purgeDatabaseCopy(name: string): void {
    if (!/^(before-schema-v\d+|database-backup)-\d+\.sqlite$/.test(name))
      throw new DomainError("数据库副本编号无效。");
    unlinkSync(join(this.directory, name));
    this.backupReferences.delete(join(this.directory, name));
  }
  // Include undo/redo, trash and recovery snapshots: these files remain recoverable.
  protectedAssets(): Set<string> {
    if (
      readdirSync(this.directory).some((name) =>
        name.startsWith("damaged-database-"),
      )
    )
      throw new DomainError(
        "隔离的损坏数据库仍可能引用原图，为避免误删暂不回收。请先完整备份并恢复相关资料。",
      );
    const ids = new Set<string>();
    const collect = (raw: string) => {
      for (const match of raw.matchAll(/[a-f0-9]{64}/g)) ids.add(match[0]);
    };
    for (const row of this.db
      .prepare(
        "SELECT document AS raw FROM albums UNION ALL SELECT document FROM trash UNION ALL SELECT before_doc FROM history UNION ALL SELECT after_doc FROM history",
      )
      .all() as { raw: string }[]) {
      try {
        JSON.parse(row.raw);
      } catch {
        throw new DomainError(
          "存在损坏工程或历史记录，为避免误删原图，暂不回收。请先备份并恢复异常资料。",
        );
      }
      collect(row.raw);
    }
    for (const row of this.db
      .prepare(
        "SELECT value AS raw FROM preferences UNION ALL SELECT value FROM quarantined_preferences",
      )
      .all() as { raw: string }[])
      collect(row.raw);
    const directory = join(this.directory, "snapshots");
    mkdirSync(directory, { recursive: true });
    for (const file of readdirSync(directory).filter((n) =>
      n.endsWith(".json"),
    )) {
      const raw = readFileSync(join(directory, file), "utf8");
      try {
        this.parse(raw);
      } catch {
        throw new DomainError(
          "存在损坏的恢复副本，暂不回收原图，请先保留备份并整理该副本。",
        );
      }
      collect(raw);
    }
    for (const file of readdirSync(this.directory).filter((n) =>
      /^(before-schema-v\d+|database-backup)-\d+\.sqlite$/.test(n),
    )) {
      const path = join(this.directory, file),
        info = statSync(path),
        signature = `${info.size}:${info.mtimeMs}`;
      let cached = this.backupReferences.get(path);
      if (!cached || cached.signature !== signature) {
        const references = new Set<string>(),
          backup = new DatabaseSync(path, { readOnly: true });
        try {
          for (const table of ["albums", "history", "preferences"]) {
            const exists = backup
              .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
              )
              .get(table);
            if (!exists) continue;
            const columns =
              table === "albums"
                ? ["document"]
                : table === "history"
                  ? ["before_doc", "after_doc"]
                  : ["value"];
            for (const column of columns)
              for (const row of backup
                .prepare(`SELECT ${column} AS raw FROM ${table}`)
                .iterate() as Iterable<{ raw: string }>) {
                for (const match of row.raw.matchAll(/[a-f0-9]{64}/g))
                  references.add(match[0]);
              }
          }
        } finally {
          backup.close();
        }
        cached = { signature, ids: references };
        this.backupReferences.set(path, cached);
      }
      for (const id of cached.ids) ids.add(id);
    }
    return ids;
  }
  trashAlbum(id: string): Album {
    const row = this.db
      .prepare("SELECT document FROM trash WHERE id=?")
      .get(id) as { document: string } | undefined;
    if (!row) throw new DomainError("最近删除的工程不存在。");
    return this.parse(row.document);
  }
  importTrash(album: Album): void {
    assertAlbum(album);
    this.db
      .prepare("INSERT INTO trash VALUES(?,?,?)")
      .run(album.id, new Date().toISOString(), JSON.stringify(album));
  }
  copyFrom(source: Store, id: string): Album {
    const album = source.get(id),
      row = source.db
        .prepare("SELECT cursor FROM albums WHERE id=?")
        .get(id) as { cursor: number };
    const history = source.db
      .prepare(
        "SELECT seq,before_doc,after_doc,origin FROM history WHERE album_id=?",
      )
      .all(id) as {
      seq: number;
      before_doc: string;
      after_doc: string;
      origin: string;
    }[];
    album.id = crypto.randomUUID();
    album.revision = 0;
    album.name = album.name.slice(0, 110) + "（资料恢复）";
    const valid = history.every((entry) => {
      try {
        return (
          Array.isArray(JSON.parse(entry.before_doc)) &&
          Array.isArray(JSON.parse(entry.after_doc))
        );
      } catch {
        return false;
      }
    });
    this.create(album);
    if (valid) {
      for (const entry of history)
        this.db
          .prepare("INSERT INTO history VALUES(?,?,?,?,?)")
          .run(
            album.id,
            entry.seq,
            entry.before_doc,
            entry.after_doc,
            entry.origin,
          );
      this.db
        .prepare("UPDATE albums SET cursor=? WHERE id=?")
        .run(row.cursor, album.id);
    } else
      health.report(
        `history:${album.id}`,
        new DomainError(
          "一个恢复工程的撤销历史损坏，已保留工程正文；原始历史保存在资料备份中。",
        ),
      );
    return album;
  }
  comparison(id: string): { before: Album; after: Album } | null {
    const cursor = this.db
      .prepare("SELECT cursor FROM albums WHERE id=?")
      .get(id) as { cursor: number } | undefined;
    if (!cursor) throw new DomainError("项目不存在。");
    const target = this.db
      .prepare(
        "SELECT seq,before_doc FROM history WHERE album_id=? AND origin='ai' AND seq<=? ORDER BY seq DESC LIMIT 1",
      )
      .get(id, cursor.cursor) as
      { seq: number; before_doc: string } | undefined;
    if (!target) return null;
    let after = this.get(id);
    const later = this.db
      .prepare(
        "SELECT before_doc FROM history WHERE album_id=? AND seq>? AND seq<=? ORDER BY seq DESC",
      )
      .all(id, target.seq, cursor.cursor) as { before_doc: string }[];
    for (const entry of later)
      after = applyPatch(
        after,
        JSON.parse(entry.before_doc),
        true,
        false,
        true,
      ).newDocument;
    const before = applyPatch(
      after,
      JSON.parse(target.before_doc),
      true,
      false,
      true,
    ).newDocument;
    assertAlbum(before);
    assertAlbum(after);
    return { before, after };
  }
  undoAi(id: string, revision: number): Album {
    const row = this.db
      .prepare(
        "SELECT h.origin FROM history h JOIN albums a ON a.id=h.album_id AND a.cursor=h.seq WHERE a.id=?",
      )
      .get(id) as { origin: string } | undefined;
    if (row?.origin !== "ai")
      throw new DomainError(
        "请先撤销 AI 完成之后的人工修改，再撤销本次 AI 修改。",
      );
    return this.history(id, "undo", revision);
  }
}
