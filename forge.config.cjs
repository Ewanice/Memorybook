const fs = require("node:fs");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const {
  publishProgram,
  clearPackageStage,
} = require("./scripts/package-output.cjs");
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("版本号无效。");
module.exports = {
  outDir: "out/.package-stage",
  packagerConfig: {
    electronZipDir: process.env.MEMORY_ELECTRON_ZIP_DIR || undefined,
    asar: true,
    name: "Memorybook",
    executableName: "Memorybook",
    ignore: [/^\/(?!dist(?:\/|$)|package\.json$)/],
    prune: false,
    icon: "./assets/icon.ico",
    windowsSign: process.env.MEMORY_SIGN_CERT
      ? {
          certificateFile: process.env.MEMORY_SIGN_CERT,
          certificatePassword: process.env.MEMORY_SIGN_PASSWORD,
          hashes: ["sha256"],
        }
      : undefined,
  },
  makers: [],
  plugins: [
    {
      name: "@electron-forge/plugin-fuses",
      config: {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
        [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
      },
    },
  ],
  hooks: {
    postPackage: async (_config, result) => {
      const path = require("node:path");
      for (const [index, directory] of result.outputPaths.entries()) {
        fs.cpSync(
          ".local/bundled-materials-ascii",
          path.join(directory, "materials"),
          {
            recursive: true,
          },
        );
        fs.copyFileSync(
          "assets/phrases.txt",
          path.join(directory, "phrases.txt"),
        );
        const target = path.resolve("out/packages/Memorybook-win32-x64");
        publishProgram(directory, target);
        result.outputPaths[index] = target;
        clearPackageStage(directory);
      }
    },
    prePackage: async () => {
      const path = require("node:path"),
        target = path.resolve("out/.package-stage/Memorybook-win32-x64");
      for (const name of ["data", "materials/imported-fonts"]) {
        const directory = path.join(target, name);
        if (fs.existsSync(directory) && fs.readdirSync(directory).length)
          throw new Error(
            "临时打包目录包含用户资料，请先移出资料。最终打包始终覆盖 out/packages/Memorybook-win32-x64。",
          );
      }
      const info = JSON.parse(fs.readFileSync("dist/build-info.json", "utf8"));
      if (info.development)
        throw new Error(
          "禁止打包开发构建。请设置 MEMORY_RELEASE=1 后重新构建。",
        );
      if (process.env.MEMORY_SIGN_CERT && !process.env.MEMORY_SIGN_PASSWORD)
        throw new Error("配置签名证书时还需提供证书密码。");
    },
  },
};
