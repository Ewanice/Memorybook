import { packageRoot } from "./release-paths.mjs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { listPackage, extractFile } from "@electron/asar";
import { getCurrentFuseWire, FuseV1Options, FuseState } from "@electron/fuses";
import { _electron as electron } from "@playwright/test";
const root = packageRoot;
const archive = resolve(root, "resources/app.asar");
const files = listPackage(archive);
assert(
  files.every((path) => /^[\x20-\x7e]+$/.test(path)),
  "发布包内部路径必须全为 ASCII",
);
assert(
  files.every(
    (path) => !/\/(src|scripts|tests|\.local|node_modules)(\/|$)/.test(path),
  ),
);
assert(files.every((path) => !/\.(pem|license|map)$/.test(path)));
assert.equal(
  JSON.parse(extractFile(archive, "dist/build-info.json").toString())
    .development,
  false,
);
const main = extractFile(archive, "dist/main.cjs").toString();
const privateKey = (await readFile(".local/release/private.pem", "utf8")).split(
  "\n",
)[1];
assert(!main.includes(privateKey));
const fuse = await getCurrentFuseWire(resolve(root, "Memorybook.exe"));
assert.equal(fuse[FuseV1Options.RunAsNode], FuseState.DISABLE);
assert.equal(
  fuse[FuseV1Options.EnableEmbeddedAsarIntegrityValidation],
  FuseState.ENABLE,
);
assert.equal(fuse[FuseV1Options.OnlyLoadAppFromAsar], FuseState.ENABLE);
const profile = resolve(".local/release-smoke-" + Date.now());
await mkdir(profile, { recursive: true });
// Use the stock Electron test runner against the exact packaged ASAR; the shipped binary disables Node inspector.
const application = await electron.launch({
  args: [archive, "--user-data-dir=" + profile],
  timeout: 60000,
});
try {
  const page = await application.firstWindow();
  const actual = await application.evaluate(({ app }) =>
    app.getPath("userData"),
  );
  assert.equal(resolve(actual), profile, "发布包验证必须使用隔离数据目录");
  await page
    .getByPlaceholder("在这里粘贴完整卡密")
    .fill(await readFile(".local/shared-v1.license", "utf8"));
  await page.getByRole("button", { name: "验证并开始" }).click();
  await page.getByRole("heading", { name: "我的纪念册" }).waitFor();
  await page.getByRole("button", { name: "＋ 新建纪念册" }).click();
  await page.getByPlaceholder("例如：明日世界").fill("发布包验收");
  await page.getByRole("button", { name: "生成纪念册 →" }).click();
  await page.getByText("已保存在本机", { exact: true }).waitFor();
  const boot = await page.evaluate(() => window.memorybook.bootstrap());
  assert.equal(boot.license.development, false);
  assert.equal(boot.license.valid, true);
  const library = await page.evaluate(() => window.memorybook.resources());
  assert(!library.phraseError && library.phrases.length > 0);
  assert(!library.phrasePath.includes("app.asar"));
  assert((await readFile(library.phrasePath, "utf8")).includes("把这一刻"));
  await page.screenshot({ path: resolve(".local/release-editor.png") });
  await writeFile(
    ".local/release-verification.json",
    JSON.stringify(
      {
        passed: true,
        archiveSha256: createHash("sha256")
          .update(await readFile(archive))
          .digest("hex"),
        files: files.length,
        privateKeyExcluded: true,
        developerLicenseExcluded: true,
        integrityEnabled: true,
        packagedAsarStartup: true,
        sharedLicenseValidated: true,
        projectCreated: true,
        profile,
      },
      null,
      2,
    ),
  );
  console.log("Packaged ASAR and production license verified.");
} finally {
  await application.close();
}
