import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  realpath,
  mkdir,
  copyFile,
  readdir,
  stat,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { extractAll, createPackage, getRawHeader } from "@electron/asar";
import { NtExecutable, NtExecutableResource } from "resedit";
import { packageRoot } from "./release-paths.mjs";
import assert from "node:assert/strict";
const base = await mkdtemp(resolve(".local/update-e2e-")),
  source = join(base, "app with spaces"),
  target = join(base, "target"),
  feed = join(base, "feed");
const names = JSON.parse(
  await readFile(join(packageRoot, "program-files.json"), "utf8"),
);
for (const root of [source, target])
  for (const file of names) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(join(packageRoot, file), join(root, file));
  }
const unpacked = join(base, "unpacked");
extractAll(join(target, "resources/app.asar"), unpacked);
const pkg = JSON.parse(await readFile(join(unpacked, "package.json"), "utf8")),
  from = pkg.version;
pkg.version = "1.8.1";
await writeFile(join(unpacked, "package.json"), JSON.stringify(pkg));
await createPackage(unpacked, join(target, "resources/app.asar"));
// Construct a future real Electron build with a matching embedded ASAR integrity resource.
const exe = NtExecutable.from(
    await readFile(join(target, "Memorybook.App.exe")),
  ),
  resources = NtExecutableResource.from(exe),
  header = getRawHeader(join(target, "resources/app.asar"));
const integrity = resources.entries.find(
  (e) => e.type === "INTEGRITY" && e.id === "ELECTRONASAR",
);
assert(integrity);
const metadata = Buffer.from(
  JSON.stringify([
    {
      file: "resources\\app.asar",
      alg: "sha256",
      value: createHash("sha256").update(header.headerString).digest("hex"),
    },
  ]),
);
integrity.bin = metadata.buffer.slice(
  metadata.byteOffset,
  metadata.byteOffset + metadata.length,
);
resources.outputResource(exe);
await writeFile(
  join(target, "Memorybook.App.exe"),
  Buffer.from(exe.generate()),
);
const python =
    "C:/Users/Ewanice/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe",
  zip = join(base, "base.zip");
const archive = spawnSync(
  python,
  [
    "-c",
    `import zipfile,json,sys,pathlib
r=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'w') as z:
 for n in json.loads((r/'program-files.json').read_text()):z.write(r/n,'Memorybook/'+n)`,
    source,
    zip,
  ],
  { windowsHide: true, encoding: "utf8" },
);
assert.equal(archive.status, 0, archive.stderr);
const build = spawnSync(
  process.execPath,
  [
    "scripts/build-update.mjs",
    "--test-only",
    "--target=" + target,
    "--version=1.8.1",
    "--base=" + zip,
    "--output=" + feed,
  ],
  { windowsHide: true, encoding: "utf8", maxBuffer: 1024 * 1024 },
);
assert.equal(build.status, 0, build.stdout + build.stderr);
let requests = 0,
  slow = true;
const server = createServer(async (req, res) => {
  requests++;
  const file = join(feed, String(req.url).split("?")[0].slice(1));
  if (
    ![
      "update-manifest.json",
      "Memorybook-update-full.bin",
      "Memorybook-update-delta.bin",
    ].includes(String(req.url).slice(1))
  ) {
    res.writeHead(404);
    res.end();
    return;
  }
  const bytes = await readFile(file);
  res.writeHead(200, { "Content-Length": bytes.length });
  if (!slow || file.endsWith(".json")) {
    res.end(bytes);
    return;
  }
  let offset = 0;
  const timer = setInterval(() => {
    if (res.destroyed) {
      clearInterval(timer);
      return;
    }
    res.write(bytes.subarray(offset, offset + 1024));
    offset += 1024;
    if (offset >= bytes.length) {
      clearInterval(timer);
      res.end();
    }
  }, 100);
  res.on("close", () => clearInterval(timer));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const config = JSON.stringify({
  provider: "static",
  manifestUrl: `http://127.0.0.1:${server.address().port}/update-manifest.json`,
});
await writeFile(join(source, "update-source.json"), config);
const child = spawn(
  join(source, "Memorybook.exe"),
  [
    "--user-data-dir=" + join(source, "data"),
    "--settings-dir=" + join(base, "settings"),
    "--remote-debugging-port=0",
    "--update-headless",
  ],
  { windowsHide: true, stdio: "ignore" },
);
let browser,
  newBrowser,
  newPid,
  passed = false;
async function connect(except = "") {
  for (let i = 0; i < 200; i++) {
    try {
      const port = (
        await readFile(
          join(source, "data/browser-cache/DevToolsActivePort"),
          "utf8",
        )
      ).split("\n")[0];
      if (port && port !== except)
        return {
          browser: await chromium.connectOverCDP("http://127.0.0.1:" + port),
          port,
        };
    } catch (e) {
      if (e.code !== "ENOENT" && !String(e).includes("ECONNREFUSED")) throw e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("No debug port for updater smoke");
}
try {
  const initial = await connect();
  browser = initial.browser;
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().startsWith("memory://app/"));
  page.setDefaultTimeout(30000);
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  await page.getByRole("button", { name: "＋ 新建纪念册" }).click();
  await page
    .getByPlaceholder("例如：明日世界")
    .fill("Update preserves this book");
  await page.getByRole("button", { name: "生成纪念册 →" }).click();
  await page.getByText("已保存在本机", { exact: true }).waitFor();
  const before = await page.evaluate(() => window.memorybook.bootstrap());
  await page.evaluate(async () => {
    const doc = await window.memorybook.phraseDocument();
    await window.memorybook.savePhrases("My private phrases\n", doc.hash);
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "关于", exact: true }).click();
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(requests, 0, "启动和打开关于不能主动请求更新源");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByRole("button", { name: "下载更新", exact: true }).waitFor();
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  await page.getByRole("button", { name: "取消更新", exact: true }).click();
  await page
    .getByText("已取消，原程序和个人资料未改变。", { exact: true })
    .waitFor();
  assert.equal(
    (await page.evaluate(() => window.memorybook.bootstrap())).albums[0].id,
    before.albums[0].id,
  );
  slow = false;
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  for (let i = 0; i < 600; i++) {
    const value = await page.evaluate(() => window.memorybook.updateState());
    if (value.status === "failed")
      throw new Error(
        JSON.stringify({
          state: value,
          health: await page.evaluate(() => window.memorybook.health()),
        }),
      );
    if (value.status === "ready") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await page.getByRole("button", { name: "重启并更新", exact: true }).waitFor();
  const state = await page.evaluate(() => window.memorybook.updateState());
  assert(state.differential);
  assert(state.total < 5 * 1024 * 1024);
  await page.getByRole("button", { name: "重启并更新", exact: true }).click();
  let transaction;
  for (let i = 0; i < 600; i++) {
    const dirs = (await readdir(join(source, ".updates"))).filter((n) =>
      /^[a-f0-9]{32}$/.test(n),
    );
    for (const id of dirs) {
      try {
        await stat(join(source, ".updates", id, "committed.json"));
        transaction = id;
        break;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    if (transaction) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(transaction, "实际新版必须成功启动并提交更新事务");
  const health = JSON.parse(
    await readFile(
      join(source, ".updates", transaction, "health-ready.json"),
      "utf8",
    ),
  );
  newPid = health.pid;
  const connected = await connect(initial.port);
  newBrowser = connected.browser;
  const updated = newBrowser
    .contexts()[0]
    .pages()
    .find((p) => p.url().startsWith("memory://app/"));
  await updated.getByRole("heading", { name: "我的纪念册" }).waitFor();
  const after = await updated.evaluate(() => window.memorybook.bootstrap());
  assert.equal(after.version, "1.8.1");
  assert.equal(after.albums[0].id, before.albums[0].id);
  assert.equal(
    await readFile(join(source, "phrases.txt"), "utf8"),
    "My private phrases\n",
  );
  assert.equal(
    await readFile(join(source, "update-source.json"), "utf8"),
    config,
  );
  await writeFile(
    ".local/update-ui-verification.json",
    JSON.stringify(
      {
        passed: true,
        from,
        to: after.version,
        noAutomaticRequests: true,
        cancelledFromUi: true,
        realDifferentialBytes: state.total,
        actualRestartAndCommit: true,
        projectAndPhrasesPreserved: true,
        customSourcePreserved: true,
        archiveSha256: createHash("sha256")
          .update(await readFile(join(packageRoot, "resources/app.asar")))
          .digest("hex"),
      },
      null,
      2,
    ),
  );
  passed = true;
  console.log(
    "真实界面通过：不自动联网、手动检查、取消、二进制差分、重启到新版、工程和自定义更新源保留。",
  );
} finally {
  for (const b of [browser, newBrowser]) if (b) await b.close().catch(() => {});
  if (newPid)
    try {
      process.kill(newPid);
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  if (child.exitCode === null && child.signalCode === null) child.kill();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  if (passed) {
    const directory = await realpath(base);
    if (
      dirname(directory) !== resolve(".local") ||
      !directory.includes("update-e2e-")
    )
      throw new Error("Invalid test cleanup path");
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 50,
      retryDelay: 100,
    });
  }
}
