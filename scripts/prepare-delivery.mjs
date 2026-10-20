import { packageRoot } from "./release-paths.mjs";
import { mkdir, readFile, writeFile, cp, rm, readdir } from "node:fs/promises";
import { openSync, readSync, writeSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { Zip, ZipDeflate } from "fflate";
import { resolve, relative, join, sep } from "node:path";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("版本号无效");
const source = packageRoot;
const verified = JSON.parse(
  await readFile(".local/release-verification.json", "utf8"),
);
const binary = JSON.parse(
  await readFile(".local/binary-verification.json", "utf8"),
);
const portable = JSON.parse(
  await readFile(".local/portable-verification.json", "utf8"),
);
const digest = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
if (
  !verified.passed ||
  !binary.passed ||
  !portable.passed ||
  portable.archiveSha256 !== verified.archiveSha256 ||
  verified.archiveSha256 !==
    (await digest(join(source, "resources/app.asar"))) ||
  binary.binarySha256 !== (await digest(join(source, "Memorybook.exe")))
)
  throw new Error("请先验证当前发布包与实际 exe。");
const base = resolve("out/delivery"),
  directory = resolve(base, version);
if (!directory.startsWith(base + sep)) throw new Error("交付目录超出输出目录");
for (const folder of [
  "Memorybook/data",
  "Memorybook/materials/imported-fonts",
]) {
  let entries;
  try {
    entries = await readdir(join(directory, folder));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (entries?.length)
    throw new Error("交付目标包含用户资料，已停止覆盖，请先保留该目录。");
}
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
await cp(source, join(directory, "Memorybook"), {
  recursive: true,
  filter: (path) => {
    const parts = relative(source, path).split(sep);
    return (
      parts[0] !== "data" &&
      !(parts[0] === "materials" && parts[1] === "imported-fonts")
    );
  },
});
await writeFile(
  join(directory, "license.txt"),
  (await readFile(".local/shared-v1.license", "utf8")).trim() + "\n",
);
await writeFile(
  join(directory, "README.txt"),
  `拾页 / Memorybook ${version}

Windows x64 完整文件夹版

1. 将整个压缩包解压到可写的目录，例如 D:\\Memorybook。不要只解压 EXE，也不要直接在压缩包内运行。
2. 进入“Memorybook”文件夹，运行 Memorybook.exe。保留旁边的 DLL、locales、resources、materials 与 phrases.txt。
3. 首次输入“license.txt”中的完整卡密。之后可离线使用。
4. 首页可管理贴纸、短语和排版。新建时选择照片、贴纸，全部排版自动随机使用；也可选择本地 Codex 生成。
   上传到贴纸库后，新建时需选中要自动排版的贴纸。编辑器“＋贴纸”可直接选用全局贴纸库；“＋照片”和“＋贴纸”分别显示对应素材。
5. 选择任何元素调整大小、位置、字体和内容；右侧“页面底色与纸张”可逐页更换背景。
6. 设置 → 字体库可导入 TTF/OTF。Delete 删除，方向键微调，Shift+方向键加速，Ctrl+D 复制，Ctrl+Z 撤销，Ctrl+Y 重做，Esc 取消选择。
7. 导出 PDF 时每张设计页对应一页 PDF；“备份可编辑工程”包含原图与使用的导入字体。

保存位置
工程、原图、贴纸、缓存与设置默认写入“Memorybook/data”；字体和内置纸张位于“Memorybook/materials”；phrases.txt 直接位于“Memorybook”根目录，可在软件中编辑。
预览采用压缩副本，透明贴纸保留透明度，高质量 PDF 使用原图。缓存约 256 MB 自动淘汰，可在设置中清理。
首次升级：新目录还没有数据库时，会复制旧版系统用户目录的数据并保留原目录。确认后请备份整个“Memorybook”文件夹。
以后更新：关闭软件，保留“data”“materials/imported-fonts”和“phrases.txt”，将新版程序文件替换到原位置。不要用默认短语库覆盖自己编辑的文件。
本机 AI Key 经过 Windows 加密，更换电脑需重新填写。建议通过工程备份迁移。

可选 AI
设置中填写自己购买的 AI API Base URL、协议、模型和 API Key。也可自动连接本机已安装并登录的 Codex；生成时通常联网消耗相应账户额度。普通编辑、保存和 PDF 导出均离线。
当前未作 Windows 发布者代码签名，请使用购买渠道提供的原始完整包。SHA256.json 列出各文件校验值。
`,
);
async function walk(path, prefix = "") {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (!/^[\x20-\x7e]+$/.test(name))
      throw new Error(`交付路径不是 ASCII：${name}`);
    if (entry.isDirectory())
      files.push(...(await walk(join(path, entry.name), name + "/")));
    else if (entry.isFile()) files.push(name);
    else throw new Error("交付目录不允许符号链接");
  }
  return files.sort();
}
const files = await walk(directory),
  hashes = {};
for (const name of files) hashes[name] = await digest(join(directory, name));
await writeFile(
  join(directory, "SHA256.json"),
  JSON.stringify(
    {
      version,
      platform: "win32-x64",
      distribution: "folder",
      codeSigned: false,
      files: hashes,
    },
    null,
    2,
  ),
);
files.push("SHA256.json");
const output = resolve(`out/Memorybook-${version}-Windows-x64.zip`),
  fd = openSync(output, "w");
try {
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    writeSync(fd, chunk);
  });
  const chunk = Buffer.alloc(1024 * 1024);
  for (const name of files) {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    const input = openSync(join(directory, name), "r");
    try {
      let count;
      while ((count = readSync(input, chunk)) > 0)
        file.push(chunk.subarray(0, count), false);
      file.push(new Uint8Array(), true);
    } finally {
      closeSync(input);
    }
  }
  zip.end();
} finally {
  closeSync(fd);
}
console.log(
  `完整目录已生成：${directory}\nZIP：${output}\n共 ${files.length} 个文件；不包含用户工程、导入字体、私钥或开发卡密。`,
);
