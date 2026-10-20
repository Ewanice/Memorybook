import { app } from "electron";
import { spawn } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
export function handleInstallerEvent(): boolean {
  if (process.platform !== "win32") return false;
  const event = process.argv.find((value) =>
    [
      "--squirrel-install",
      "--squirrel-updated",
      "--squirrel-uninstall",
      "--squirrel-obsolete",
    ].includes(value),
  );
  if (!event) return false;
  if (event === "--squirrel-obsolete") {
    app.quit();
    return true;
  }
  const update = resolve(dirname(process.execPath), "..", "Update.exe");
  const command =
    event === "--squirrel-uninstall" ? "--removeShortcut" : "--createShortcut";
  const helper = spawn(update, [command, basename(process.execPath)], {
    windowsHide: true,
  });
  helper.once("error", () => app.exit(1));
  helper.once("exit", (code) => app.exit(code ?? 1));
  return true;
}
