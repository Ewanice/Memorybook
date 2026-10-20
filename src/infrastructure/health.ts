import { mkdirSync, appendFileSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";
export type ResourceIssue = {
  key: string;
  message: string;
  time: string;
};

// A bounded, local incident registry. A failed optional resource must not hide
// healthy resources, and must never be silently replaced on disk.
export class Health {
  private entries = new Map<string, ResourceIssue>();
  private directory = "";
  configure(directory: string): void {
    this.directory = directory;
    try {
      mkdirSync(directory, { recursive: true });
    } catch (error) {
      this.entries.set("logs", {
        key: "logs",
        message: "诊断日志目录不可写，其他功能可继续使用。",
        time: new Date().toISOString(),
      });
    }
  }
  report(key: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (this.entries.get(key)?.message === message) return;
    this.entries.set(key, {
      key,
      message,
      time: new Date().toISOString(),
    });
    if (this.entries.size > 200)
      this.entries.delete(this.entries.keys().next().value!);
    if (this.directory)
      try {
        const path = join(this.directory, "resources.jsonl");
        try {
          if (statSync(path).size > 1024 * 1024)
            renameSync(path, join(this.directory, "resources.previous.jsonl"));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        appendFileSync(path, JSON.stringify(this.entries.get(key)) + "\n");
      } catch {
        this.entries.set("logs", {
          key: "logs",
          message: "诊断日志无法写入，请检查空间或目录权限。",
          time: new Date().toISOString(),
        });
      }
  }
  resolve(key: string): void {
    this.entries.delete(key);
  }
  list(): ResourceIssue[] {
    return [...this.entries.values()];
  }
}

export const health = new Health();
