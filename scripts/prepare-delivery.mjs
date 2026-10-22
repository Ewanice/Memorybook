import { packageRoot } from "./release-paths.mjs";
import { createRequire } from "node:module";
const { publishProgram } = createRequire(import.meta.url)(
  "./package-output.cjs",
);
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  openSync,
  readSync,
  writeSync,
  closeSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { Zip, ZipDeflate } from "fflate";
import { resolve, join } from "node:path";
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
const shared = JSON.parse(
  await readFile(".local/shared-settings-verification.json", "utf8"),
);
const digest = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
if (
  !verified.passed ||
  !binary.passed ||
  !portable.passed ||
  !shared.passed ||
  shared.archiveSha256 !== verified.archiveSha256 ||
  portable.archiveSha256 !== verified.archiveSha256 ||
  verified.archiveSha256 !==
    (await digest(join(source, "resources/app.asar"))) ||
  binary.binarySha256 !== (await digest(join(source, "Memorybook.exe")))
)
  throw new Error("请先验证当前发布包与实际 exe。");
const base = resolve("out/delivery"),
  directory = base;
await mkdir(directory, { recursive: true });
const defaultPhrases = await readFile("assets/phrases.txt");
await mkdir(join(directory, "Memorybook"), { recursive: true });
try {
  await writeFile(join(directory, "Memorybook/phrases.txt"), defaultPhrases, {
    flag: "wx",
  });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
const programFiles = publishProgram(source, join(directory, "Memorybook"), {
  preservePhrases: true,
});
await writeFile(
  join(directory, "README.txt"),
  `拾页 / Memorybook ${version}

Windows x64 完整文件夹版

1. 将整个压缩包解压到可写的目录，例如 D:\\Memorybook。不要只解压 EXE，也不要直接在压缩包内运行。
2. 进入“Memorybook”文件夹，运行 Memorybook.exe。保留旁边的 DLL、locales、resources 与 materials；phrases.txt 首次使用时自动创建。
3. 打开即用，无需卡密、激活或登录；普通编辑与导出可离线使用。
4. 首页可管理贴纸、短语和排版。排版支持编辑、删除与恢复默认，封面单独标注。新建时贴纸默认全选，可按需取消；可从排版库选择封面，其余内页排版随机轮用，也可选择本地 Codex 生成。
   两个默认封面均可自定义，完整图片封面带顶部居中文字框。编辑器“封面排版”可预览替换；“＋贴纸”直接选用全局贴纸库；照片与贴纸分别显示对应素材。
5. 选择任何元素调整大小、位置、字体和内容；右侧“页面底色与纸张”可逐页更换背景。文字“文字描边”默认关闭，可设颜色与粗细；图片“边缘与边框”可选圆角、椭圆、拱形、票根、撕纸、波浪及细线、虚线、双线、拍立得留白，也可用于自建排版。
6. 设置 → 字体库可导入 TTF/OTF；设置 → 外观可修改首页名称、全局主题色与首页背景。编辑器操作条提供裁切、复制、图层与锁定；单个元素可对齐到页面。Delete 删除，方向键微调，Shift+方向键加速，Ctrl+D 复制，Ctrl+Z 撤销，Ctrl+Y 重做，Ctrl+] / Ctrl+[ 调整图层，Esc 取消选择。
7. 导出 PDF 时每张设计页对应一页 PDF；“备份可编辑工程”包含原图与使用的导入字体。

保存位置
工程、原图、贴纸和缓存默认写入“Memorybook/data”；字体和内置纸张位于“Memorybook/materials”；phrases.txt 直接位于“Memorybook”根目录，可在软件中编辑。
预览采用压缩副本，透明贴纸保留透明度，高质量 PDF 使用原图。缓存约 256 MB 自动淘汰，可在设置中清理。
设置：同一 Windows 用户下的新版副本共用设置（%APPDATA%/Memorybook/shared-settings），包含导出目录、外观、AI 与 Codex 配置；删除程序文件夹后仍保留。首次升级只在共享设置不存在时采用当前目录旧设置，之后不会被其他副本的旧值覆盖。工程和素材库不共享，不从系统旧数据库自动复制。
以后更新：先关闭各个软件窗口，将完整新版解压覆盖到原位置。更新包不含 data、导入字体或根目录 phrases.txt，不覆盖已有个人资料；首次启动时才在根目录创建默认 phrases.txt。工程留在各自软件文件夹：删除整个软件文件夹也会删除其中的工程，请先备份。
本机 AI Key 经过 Windows 加密，更换电脑需重新填写。建议通过工程备份迁移。设置 → 文件与导出 → 清除默认导出目录，可清除旧路径而不影响工程。

可选 AI
设置中填写自己购买的 AI API Base URL、协议、模型和 API Key。也可自动连接本机已安装并登录的 Codex；生成时通常联网消耗相应账户额度。普通编辑、保存和 PDF 导出均离线。
当前未作 Windows 发布者代码签名，请使用作者发布的原始完整包。SHA256.json 列出各文件校验值。
`,
);
const files = [
    ...programFiles.map((name) => "Memorybook/" + name),
    "README.txt",
  ].sort(),
  hashes = {};
for (const name of files) hashes[name] = await digest(join(directory, name));
const integrity = {
  version,
  platform: "win32-x64",
  distribution: "folder",
  codeSigned: false,
  files: hashes,
};
await writeFile(
  join(directory, "SHA256.json"),
  JSON.stringify(integrity, null, 2),
);
// Personal phrases are created on first use, never shipped as an overwrite target.
const archiveIntegrity = Buffer.from(JSON.stringify(integrity, null, 2));
files.push("SHA256.json");
const output = resolve("out/Memorybook-Windows-x64.zip"),
  temporary = output + ".package-next",
  fd = openSync(temporary, "w");
let completed = false;
try {
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    writeSync(fd, chunk);
  });
  const chunk = Buffer.alloc(1024 * 1024);
  for (const name of files) {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    if (name === "SHA256.json") {
      file.push(archiveIntegrity, true);
      continue;
    }
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
  completed = true;
} finally {
  closeSync(fd);
  if (!completed) unlinkSync(temporary);
}
renameSync(temporary, output);
console.log(
  `完整目录已生成：${directory}\nZIP：${output}\n共 ${files.length} 个文件；不包含用户工程、导入字体、本机凭证。`,
);
