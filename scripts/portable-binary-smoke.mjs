import { packageRoot } from "./release-paths.mjs";
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, cp, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const source = packageRoot,
  root = resolve(`.local/portable-binary-${Date.now()}/Memorybook`),
  data = join(root, "data");
await cp(source, root, {
  recursive: true,
  filter: (path) =>
    !path.includes("imported-fonts") && !path.startsWith(join(source, "data")),
});
await mkdir(data, { recursive: true });
// An empty target database prevents this isolated check from copying the operator's legacy profile.
await writeFile(join(data, "memorybook.sqlite"), new Uint8Array());
const child = spawn(
  join(root, "Memorybook.exe"),
  ["--remote-debugging-port=0"],
  { windowsHide: true, stdio: "ignore" },
);
let browser;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("完整目录程序启动后退出");
    try {
      port = (
        await readFile(
          join(data, "browser-cache", "DevToolsActivePort"),
          "utf8",
        )
      ).split("\n")[0];
      break;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(port, "调试标记必须写到软件根目录的数据文件夹");
  browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().startsWith("memory://app/"));
  assert(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  const paths = await page.evaluate(() => window.memorybook.storageInfo());
  assert.equal(resolve(paths.root), root);
  assert.equal(resolve(paths.data), data);
  assert.equal(resolve(paths.fonts), join(root, "materials", "imported-fonts"));
  assert.equal(resolve(paths.phrases), join(root, "phrases.txt"));
  await stat(join(root, "materials", "papers", "rice.svg"));
  await stat(join(root, "materials", "fonts"));
  await page.getByRole("button", { name: "＋ 新建纪念册" }).click();
  await page.getByPlaceholder("例如：明日世界").fill("完整目录验收");
  await page.getByRole("button", { name: "生成纪念册 →" }).click();
  await page.getByText("已保存在本机", { exact: true }).waitFor();
  assert((await stat(join(data, "memorybook.sqlite"))).size > 0);
  assert.deepEqual(errors, []);
  await writeFile(
    ".local/portable-verification.json",
    JSON.stringify(
      {
        passed: true,
        root,
        data,
        paths,
        defaultDirectoryVerified: true,
        externalMaterialsVerified: true,
        archiveSha256: createHash("sha256")
          .update(await readFile(join(source, "resources/app.asar")))
          .digest("hex"),
      },
      null,
      2,
    ),
  );
  console.log(
    "实际完整文件夹版通过：未指定 profile 参数，工程、缓存、字体与短语路径均位于软件目录。",
  );
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) child.kill();
}
