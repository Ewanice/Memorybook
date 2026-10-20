import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import electron from "electron";
const info = JSON.parse(await readFile("dist/build-info.json", "utf8"));
if (!info.development) throw new Error("请使用 npm start 启动正式构建");
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: {
    ...process.env,
    MEMORY_USER_DATA: fileURLToPath(
      new URL("../.local/user-data", import.meta.url),
    ),
  },
});
child.on("exit", (code) => process.exit(code ?? 1));
