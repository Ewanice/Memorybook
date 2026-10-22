import { createRequire } from "node:module";

// Electron treats *.asar as virtual directories. Updating the archive itself
// must use byte-for-byte filesystem operations without changing global noAsar.
const fs: typeof import("node:fs") = createRequire(process.execPath)(
  process.versions.electron ? "original-fs" : "node:fs",
);
export const { createReadStream, createWriteStream } = fs;
export const {
  readFile,
  writeFile,
  mkdir,
  open,
  lstat,
  realpath,
  rm,
  copyFile,
  stat,
  unlink,
  readdir,
} = fs.promises;
