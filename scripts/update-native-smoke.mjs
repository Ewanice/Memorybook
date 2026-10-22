import { spawn, spawnSync } from "node:child_process";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  mkdtemp,
  stat,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const base = await mkdtemp(resolve(".local/native-update-"));
const launcher = resolve(".local/MemorybookLauncher.exe");
const csc = "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe";
const digest = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const fixture = `using System;using System.IO;using System.Linq;using System.Web.Script.Serialization;using System.Threading;class Fixture{static void Main(string[] args){var id=args.FirstOrDefault(a=>a.StartsWith("--update-health="));if(id!=null&&VERSION){var root=AppDomain.CurrentDomain.BaseDirectory;File.WriteAllText(Path.Combine(root,".updates",id.Substring(16),"health-ready.json"),new JavaScriptSerializer().Serialize(new{id=id.Substring(16),version="2.0.0"}));}Thread.Sleep(600);}}`;
async function compile(name, health) {
  const source = join(base, name + ".cs"),
    exe = join(base, name + ".exe");
  await writeFile(source, fixture.replace("VERSION", String(health)));
  const result = spawnSync(
    csc,
    [
      "/nologo",
      "/target:winexe",
      "/reference:System.Web.Extensions.dll",
      "/out:" + exe,
      source,
    ],
    { windowsHide: true, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return exe;
}
const oldApp = await compile("old", false),
  newApp = await compile("new", true),
  badApp = await compile("bad", false);
async function setup(name, newExe) {
  const root = join(base, name),
    id = randomUUID().replaceAll("-", ""),
    tx = join(root, ".updates", id);
  await mkdir(join(root, "resources"), { recursive: true });
  await mkdir(join(tx, "stage", "resources"), { recursive: true });
  await mkdir(join(root, "data"));
  await writeFile(join(root, "data/private"), "keep-my-project");
  await writeFile(join(root, "phrases.txt"), "keep-my-phrases");
  await copyFile(launcher, join(root, "Memorybook.exe"));
  await copyFile(oldApp, join(root, "Memorybook.App.exe"));
  await writeFile(join(root, "resources/app.asar"), "old-asar");
  await copyFile(newExe, join(tx, "stage/Memorybook.App.exe"));
  await writeFile(join(tx, "stage/resources/app.asar"), "new-asar");
  const files = [];
  for (const path of ["Memorybook.App.exe", "resources/app.asar"])
    files.push({
      path,
      existed: true,
      oldSha256: await digest(join(root, path)),
      sha256: await digest(join(tx, "stage", path)),
    });
  const plan = {
    id,
    root,
    version: "2.0.0",
    arguments: [],
    waitPids: [],
    files,
  };
  await writeFile(join(tx, "plan.json"), JSON.stringify(plan));
  return { root, id, tx, plan };
}
async function run(file, args) {
  return await new Promise((resolve, reject) => {
    const p = spawn(file, args, { windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error("Native updater timed out"));
    }, 20000);
    p.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    p.on("error", reject);
  });
}
async function personal(root) {
  assert.equal(
    await readFile(join(root, "data/private"), "utf8"),
    "keep-my-project",
  );
  assert.equal(
    await readFile(join(root, "phrases.txt"), "utf8"),
    "keep-my-phrases",
  );
}
const success = await setup("success", newApp);
assert.equal(
  await run(launcher, [
    "--apply-update=" + success.id,
    "--root=" + success.root,
    "--headless",
  ]),
  0,
);
assert.equal(
  await digest(join(success.root, "Memorybook.App.exe")),
  await digest(newApp),
);
await stat(join(success.tx, "committed.json"));
await personal(success.root);
const failure = await setup("failure", badApp);
assert.equal(
  await run(launcher, [
    "--apply-update=" + failure.id,
    "--root=" + failure.root,
    "--headless",
  ]),
  2,
);
assert.equal(
  await digest(join(failure.root, "Memorybook.App.exe")),
  await digest(oldApp),
);
assert.equal(
  await readFile(join(failure.root, "resources/app.asar"), "utf8"),
  "old-asar",
);
await personal(failure.root);
const cancelled = await setup("cancel", newApp);
await writeFile(join(cancelled.tx, "cancel"), "cancel");
assert.equal(
  await run(launcher, [
    "--apply-update=" + cancelled.id,
    "--root=" + cancelled.root,
    "--headless",
  ]),
  2,
);
assert.equal(
  await digest(join(cancelled.root, "Memorybook.App.exe")),
  await digest(oldApp),
);
await personal(cancelled.root);
const during = await setup("cancel-during-write", newApp);
await writeFile(
  join(during.tx, "stage/resources/app.asar"),
  Buffer.alloc(40 * 1024 * 1024, 7),
);
during.plan.files[1].sha256 = await digest(
  join(during.tx, "stage/resources/app.asar"),
);
await writeFile(join(during.tx, "plan.json"), JSON.stringify(during.plan));
const applying = run(launcher, [
  "--apply-update=" + during.id,
  "--root=" + during.root,
  "--headless",
]);
for (let i = 0; i < 10000; i++) {
  try {
    await stat(join(during.tx, "backup/Memorybook.App.exe"));
    await writeFile(join(during.tx, "cancel"), "cancel");
    break;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await new Promise((r) => setTimeout(r, 1));
}
assert.equal(await applying, 2);
assert.equal(
  await digest(join(during.root, "Memorybook.App.exe")),
  await digest(oldApp),
);
assert.equal(
  await readFile(join(during.root, "resources/app.asar"), "utf8"),
  "old-asar",
);
await personal(during.root);
const interrupted = await setup("interrupted", newApp);
await mkdir(join(interrupted.tx, "backup", "resources"), { recursive: true });
await copyFile(oldApp, join(interrupted.tx, "backup/Memorybook.App.exe"));
await copyFile(newApp, join(interrupted.root, "Memorybook.App.exe"));
await writeFile(
  join(interrupted.root, ".updates/active.json"),
  JSON.stringify({ id: interrupted.id }),
);
assert.equal(
  await run(join(interrupted.root, "Memorybook.exe"), ["--headless"]),
  0,
);
assert.equal(
  await digest(join(interrupted.root, "Memorybook.App.exe")),
  await digest(oldApp),
);
await personal(interrupted.root);
await writeFile(
  ".local/update-native-verification.json",
  JSON.stringify(
    {
      passed: true,
      successfulCommit: true,
      failedStartupRollback: true,
      cancelRollback: true,
      cancelDuringWriteRollback: true,
      interruptedBootstrapRecovery: true,
      personalFilesPreserved: true,
      launcherSha256: await digest(launcher),
    },
    null,
    2,
  ),
);
console.log(
  "独立更新器：成功替换、启动失败回退、取消回退、中断后启动恢复、个人文件保留均通过。",
);

const cleanup = await realpath(base);
if (
  dirname(cleanup) !== resolve(".local") ||
  !cleanup.includes("native-update-")
)
  throw new Error("Invalid test cleanup path");
await rm(cleanup, {
  recursive: true,
  force: true,
  maxRetries: 50,
  retryDelay: 100,
});
