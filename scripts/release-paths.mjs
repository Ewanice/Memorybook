import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export const releaseVersion = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
).version;
if (!/^\d+\.\d+\.\d+$/.test(releaseVersion)) throw new Error("版本号无效。");
export const packageRoot = resolve(
  `out/packages/${releaseVersion}/Memorybook-win32-x64`,
);
