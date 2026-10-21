const fs = require("node:fs");
const path = require("node:path");
function sameFile(input, output) {
  if (!fs.existsSync(output)) return false;
  const info = fs.lstatSync(output);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("程序目标不是普通文件。");
  if (info.size !== fs.statSync(input).size) return false;
  const a = fs.openSync(input, "r"),
    b = fs.openSync(output, "r");
  const left = Buffer.alloc(262144),
    right = Buffer.alloc(262144);
  try {
    let count;
    while ((count = fs.readSync(a, left)) > 0) {
      if (
        fs.readSync(b, right, 0, count) !== count ||
        !left.subarray(0, count).equals(right.subarray(0, count))
      )
        return false;
    }
    return true;
  } finally {
    fs.closeSync(a);
    fs.closeSync(b);
  }
}
function checkedOutput(value) {
  const root = path.resolve(__dirname, ".."),
    out = path.join(root, "out"),
    target = path.resolve(value);
  if (!target.startsWith(out + path.sep))
    throw new Error("打包路径超出 out 目录。");
  let existing = target;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const canonical = fs.realpathSync(existing);
  if (
    existing !== root &&
    canonical !== out &&
    !canonical.startsWith(out + path.sep)
  )
    throw new Error("打包路径不能指向输出目录外部。");
  for (let part = existing; part !== root; part = path.dirname(part))
    if (fs.lstatSync(part).isSymbolicLink())
      throw new Error("打包路径不能包含链接。");
  return target;
}
function checkedName(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name.includes("\\") ||
    path.posix.isAbsolute(name) ||
    name.split("/").some((p) => !p || p === "." || p === "..") ||
    !/^[\x20-\x7e]+$/.test(name) ||
    name.startsWith("data/") ||
    name.startsWith("materials/imported-fonts/")
  )
    throw new Error("程序文件清单包含无效路径。");
  return name;
}
function walk(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error("打包目录不允许链接。");
    if (entry.isDirectory())
      return walk(path.join(directory, entry.name), name + "/");
    if (!entry.isFile()) throw new Error("打包目录包含特殊文件。");
    return [checkedName(name)];
  });
}
function readManifest(directory) {
  const file = path.join(directory, "program-files.json");
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink())
    throw new Error("程序清单不能使用链接。");
  const files = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(files) || new Set(files).size !== files.length)
    throw new Error("程序文件清单损坏。");
  return files.map(checkedName);
}
function publishProgram(
  sourceValue,
  targetValue,
  { preservePhrases = true } = {},
) {
  const source = checkedOutput(sourceValue),
    target = checkedOutput(targetValue);
  if (source === target) throw new Error("程序来源与目标相同。");
  const names = (readManifest(source) ?? walk(source)).filter(
    (name) => name !== "program-files.json",
  );
  const previous = readManifest(target) ?? [];
  fs.mkdirSync(target, { recursive: true });
  for (const name of names) {
    const input = path.join(source, name),
      output = path.join(target, name);
    if (!fs.realpathSync(input).startsWith(source + path.sep))
      throw new Error("程序来源含外部链接。");
    if (name === "phrases.txt" && preservePhrases && fs.existsSync(output))
      continue;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const parent = fs.realpathSync(path.dirname(output));
    if (parent !== target && !parent.startsWith(target + path.sep))
      throw new Error("程序目标含外部链接。");
    if (sameFile(input, output)) continue;
    const temporary = output + ".package-next";
    try {
      fs.copyFileSync(input, temporary);
      fs.renameSync(temporary, output);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  for (const name of previous)
    if (
      name !== "program-files.json" &&
      !names.includes(name) &&
      name !== "phrases.txt"
    ) {
      const file = path.join(target, name);
      if (fs.existsSync(file)) {
        if (
          !fs.realpathSync(file).startsWith(target + path.sep) ||
          !fs.statSync(file).isFile()
        )
          throw new Error("旧程序文件路径无效。");
        fs.unlinkSync(file);
      }
    }
  const files = [...names, "program-files.json"].sort();
  fs.writeFileSync(
    path.join(target, "program-files.json"),
    JSON.stringify(files, null, 2) + "\n",
  );
  return files;
}
function clearPackageStage(directory) {
  const checked = checkedOutput(directory);
  if (
    !checked.startsWith(
      path.resolve(__dirname, "../out/.package-stage") + path.sep,
    )
  )
    throw new Error("不是本次打包临时目录。");
  fs.rmSync(checked, { recursive: true, force: true });
}
module.exports = { publishProgram, checkedOutput, clearPackageStage };
