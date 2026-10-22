import { build } from "esbuild";
import { build as buildWeb } from "vite";
import { mkdir, writeFile, readFile, copyFile, cp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
const production = process.env.MEMORY_RELEASE === "1";
const config = { development: !production };
await mkdir("dist", { recursive: true });
await rm("dist/短语库.txt", { force: true });
await copyFile("assets/icon.png", "dist/icon.png");
await copyFile("assets/phrases.txt", "dist/phrases.txt");
await copyFile(
  "assets/update-source.default.json",
  "dist/update-source.default.json",
);
const { execFileSync } = await import("node:child_process");
const { resolve } = await import("node:path");
execFileSync(
  "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  [
    "/nologo",
    "/target:winexe",
    "/platform:x64",
    "/codepage:65001",
    "/win32icon:" + resolve("assets/icon.ico"),
    "/reference:System.Windows.Forms.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.Web.Extensions.dll",
    "/out:" + resolve(".local/MemorybookLauncher.exe"),
    resolve("tools/MemorybookLauncher.cs"),
  ],
  { windowsHide: true, stdio: "inherit" },
);
const fontDirectory = ".local/runtime-public/fonts";
await mkdir(fontDirectory, { recursive: true });
let fontCss = "";
for (const family of ["noto-sans-sc", "noto-serif-sc"])
  for (const weight of [400, 700]) {
    let css = await readFile(
      `node_modules/@fontsource/${family}/${weight}.css`,
      "utf8",
    );
    css = css
      .replace(/, url\([^)]+\.woff\) format\('woff'\)/g, "")
      .replace(/font-display: swap/g, "font-display: block");
    for (const match of css.matchAll(/url\(\.\/files\/([^)]+)\)/g))
      await copyFile(
        `node_modules/@fontsource/${family}/files/${match[1]}`,
        `${fontDirectory}/${match[1]}`,
      );
    fontCss += css.replaceAll("./files/", "./fonts/") + "\n";
  }
await writeFile(".local/runtime-public/fonts.css", fontCss);
await build({
  entryPoints: ["src/renderer/PageBackground.tsx"],
  outfile: ".local/page-background.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime"],
});
const require = createRequire(import.meta.url),
  { PageBackground } = require("../.local/page-background.cjs");
await mkdir(".local/runtime-public/papers", { recursive: true });
for (const style of [
  "fiber",
  "rice",
  "kraft",
  "linen",
  "grid",
  "dots",
  "wash",
]) {
  const content = renderToStaticMarkup(
    createElement(
      "svg",
      { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 192 192" },
      createElement(PageBackground, {
        page: { id: style, background: "transparent", backgroundStyle: style },
        size: { width: 192, height: 192 },
      }),
    ),
  );
  await writeFile(`.local/runtime-public/papers/${style}.svg`, content);
}
await buildWeb({
  base: "./",
  publicDir: ".local/runtime-public",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    rolldownOptions: { input: { app: "index.html", export: "export.html" } },
  },
});
await mkdir(".local/bundled-materials-ascii", { recursive: true });
await cp(
  ".local/runtime-public/fonts",
  ".local/bundled-materials-ascii/fonts",
  {
    recursive: true,
  },
);
await cp(
  ".local/runtime-public/papers",
  ".local/bundled-materials-ascii/papers",
  {
    recursive: true,
  },
);
if (production) {
  // Public default materials live next to the executable, outside the ASAR.
  await rm("dist/renderer/fonts", { recursive: true });
  await rm("dist/renderer/papers", { recursive: true });
}
const lockfile = JSON.parse(await readFile("package-lock.json", "utf8"));
let notices = "Memorybook — Third-party notices\n\n";
for (const [path, entry] of Object.entries(lockfile.packages)) {
  if (!path || entry.dev) continue;
  let licenseText = "";
  for (const filename of [
    "LICENSE",
    "LICENSE.txt",
    "LICENSE.md",
    "license",
    "LICENSE-MIT",
  ]) {
    try {
      licenseText = await readFile(`${path}/${filename}`, "utf8");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!licenseText) throw new Error(`缺少第三方许可文件：${path}`);
  notices += `${"=".repeat(60)}\n${path} @ ${entry.version}\nSPDX: ${entry.license || "See license below"}\n\n${licenseText}\n\n`;
}
await writeFile("dist/renderer/third-party-notices.txt", notices);
for (const name of ["main", "preload"]) {
  await build({
    entryPoints: [`src/desktop/${name}.ts`],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    outfile: `dist/${name}.cjs`,
    external: ["electron", "node:sqlite"],
    define: { __BUILD_CONFIG__: JSON.stringify(config) },
    minify: production,
    sourcemap: false,
  });
}
await writeFile(
  "dist/build-info.json",
  JSON.stringify({
    development: !production,
    createdAt: new Date().toISOString(),
  }),
);
