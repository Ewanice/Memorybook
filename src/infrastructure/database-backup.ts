import { Worker } from "node:worker_threads";
import { readdir, rename, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { requireSpace } from "./archive";
import { health } from "./health";
const running = new Map<string, Promise<void>>();

export function backupDatabase(directory: string): Promise<void> {
  const existing = running.get(directory);
  if (existing) return existing;
  const work = (async () => {
    const names = (await readdir(directory))
      .filter((n) => /^database-backup-\d+\.sqlite$/.test(n))
      .sort();
    const last = names.at(-1);
    if (
      last &&
      Date.now() - (await stat(join(directory, last))).mtimeMs < 300000
    )
      return;
    const source = join(directory, "memorybook.sqlite");
    await requireSpace(directory, (await stat(source)).size);
    const path = join(directory, `database-backup-${Date.now()}.sqlite`),
      temp = path + ".tmp";
    try {
      await new Promise<void>((resolve, reject) => {
        const worker = new Worker(
          `const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');let db;try{db=new DatabaseSync(workerData.source,{readOnly:true});db.exec("PRAGMA busy_timeout=3000");db.exec("VACUUM INTO '"+workerData.destination.replace(/'/g,"''")+"'");parentPort.postMessage({ok:true});}catch(error){parentPort.postMessage({ok:false,message:error.message});}finally{db?.close();}`,
          { eval: true, workerData: { source, destination: temp } },
        );
        let received = false;
        worker.on("message", (result: { ok: boolean; message?: string }) => {
          received = true;
          result.ok ? resolve() : reject(new Error(result.message));
        });
        worker.once("error", reject);
        worker.once("exit", (code) => {
          if (!received) reject(new Error(`数据库备份进程退出（${code}）。`));
        });
      });
      await rename(temp, path);
      const files = (await readdir(directory))
        .filter((n) => /^database-backup-\d+\.sqlite$/.test(n))
        .sort();
      for (const name of files.slice(0, -3))
        await unlink(join(directory, name));
      health.resolve("database-backup");
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  })();
  running.set(directory, work);
  void work.then(
    () => running.delete(directory),
    () => running.delete(directory),
  );
  return work;
}
