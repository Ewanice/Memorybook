import { build } from "esbuild";
import { mkdtemp, open, writeFile, rm } from "node:fs/promises";
import { resolve, join, sep, basename } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const base = resolve(".local"),
  directory = await mkdtemp(join(base, "archive-stress-"));
const helper = join(directory, "archive.mjs");
await build({
  entryPoints: ["src/infrastructure/archive.ts"],
  outfile: helper,
  bundle: true,
  platform: "node",
  format: "esm",
});
const { writeArchive, readArchive } = await import(pathToFileURL(helper).href);
const file = await open(join(directory, "payload.bin"), "wx");
await file.truncate(24 * 1024 * 1024);
await file.close();
let peak = process.memoryUsage().rss;
const initial = peak,
  timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 20),
  start = Date.now();
try {
  const entries = [
    { name: "album.json", bytes: Buffer.from("{}") },
    ...Array.from({ length: 25 }, (_, i) => ({
      name: `assets/${i.toString(16).padStart(64, "0")}`,
      path: join(directory, "payload.bin"),
    })),
  ];
  await writeArchive(join(directory, "large.memorybook"), entries);
  const files = await readArchive(
    join(directory, "large.memorybook"),
    join(directory, "restored"),
  );
  peak = Math.max(peak, process.memoryUsage().rss);
  assert.equal(files.size, 27);
  assert(
    peak - initial < 256 * 1024 * 1024,
    "600 MB archive must not be retained in memory",
  );
  const result = {
    passed: true,
    payloadMiB: 600,
    initialRssMiB: Math.round(initial / 1048576),
    peakRssMiB: Math.round(peak / 1048576),
    growthMiB: Math.round((peak - initial) / 1048576),
    durationMs: Date.now() - start,
    syntheticData: true,
  };
  await writeFile(
    join(base, "archive-stress-result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  clearInterval(timer);
  if (
    !resolve(directory).startsWith(base + sep) ||
    !basename(directory).startsWith("archive-stress-")
  )
    throw new Error("Unsafe temporary directory");
  await rm(directory, { recursive: true, force: true });
}
