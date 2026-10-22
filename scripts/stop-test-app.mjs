import { readFile, open } from "node:fs/promises";
import { join } from "node:path";
// The stable bootstrap waits for Electron. Test cleanup must stop its own child,
// rather than orphaning Electron by killing only the bootstrap process.
export async function stopTestApp(child, root, browser) {
  let pid;
  try {
    pid = Number(
      await readFile(
        join(root, ".updates", `launcher-${child.pid}.pid`),
        "utf8",
      ),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (browser) await browser.close();
  if (Number.isSafeInteger(pid) && pid > 0)
    try {
      process.kill(pid);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  for (
    let i = 0;
    i < 100 && child.exitCode === null && child.signalCode === null;
    i++
  )
    await new Promise((r) => setTimeout(r, 50));
  if (child.exitCode === null && child.signalCode === null) child.kill();
  for (let i = 0; i < 100; i++) {
    try {
      const handle = await open(join(root, "Memorybook.App.exe"), "r+");
      await handle.close();
      break;
    } catch (error) {
      if (error.code === "ENOENT") break;
      if (!["EBUSY", "EPERM"].includes(error.code) || i === 99) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
