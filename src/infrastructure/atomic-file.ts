import { open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { requireSpace } from "./archive";
export async function writeAtomic(
  path: string,
  bytes: Uint8Array,
  durable = true,
): Promise<void> {
  if (bytes.byteLength > 1024 * 1024)
    await requireSpace(dirname(path), bytes.byteLength);
  const temporary = path + "." + crypto.randomUUID() + ".tmp";
  const file = await open(temporary, "wx");
  try {
    await file.writeFile(bytes);
    if (durable) await file.sync();
    await file.close();
    await rename(temporary, path);
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
