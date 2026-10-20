import { packageRoot } from "./release-paths.mjs";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const profile = resolve(".local/binary-smoke-" + Date.now());
await mkdir(profile, { recursive: true });
const child = spawn(
  resolve(packageRoot, "Memorybook.exe"),
  ["--user-data-dir=" + profile, "--remote-debugging-port=0"],
  { windowsHide: true, stdio: "ignore" },
);
let browser;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("发布程序启动后退出。");
    try {
      port = (
        await readFile(
          resolve(profile, "browser-cache", "DevToolsActivePort"),
          "utf8",
        )
      ).split("\n")[0];
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!port) throw new Error("没有收到测试调试端口。");
  browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().startsWith("memory://app/"));
  assert(page);
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  const library = await page.evaluate(() => window.memorybook.resources());
  assert(!library.phraseError && library.phrases.length > 0);
  assert.equal(
    resolve(library.phrasePath),
    resolve(packageRoot, "phrases.txt"),
  );
  assert((await readFile(library.phrasePath, "utf8")).includes("把这一刻"));
  await page.screenshot({ path: resolve(".local/shipped-library.png") });
  await writeFile(
    ".local/binary-verification.json",
    JSON.stringify(
      {
        passed: true,
        binarySha256: createHash("sha256")
          .update(await readFile(resolve(packageRoot, "Memorybook.exe")))
          .digest("hex"),
        exactShippedExecutable: true,
        directStartupWithoutActivation: true,
        libraryRendered: true,
        profile,
      },
      null,
      2,
    ),
  );
  console.log("Exact shipped executable rendered directly without activation.");
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) child.kill();
}
