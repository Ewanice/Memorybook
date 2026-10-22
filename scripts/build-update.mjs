import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  readFile,
  writeFile,
  mkdir,
  open,
  stat,
  copyFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { register } from "tsx/esm/api";
import { spawnSync } from "node:child_process";
register();
const { createDelta } = await import("../src/infrastructure/binary-delta.ts");
const { fileHash, programName, signedManifest } =
  await import("../src/infrastructure/update-protocol.ts");
const { packageRoot: defaultRoot } = await import("./release-paths.mjs");
const packageRoot =
  process.argv.find((a) => a.startsWith("--target="))?.slice(9) ?? defaultRoot;
const outputRoot =
  process.argv.find((a) => a.startsWith("--output="))?.slice(9) ?? "out";
await mkdir(outputRoot, { recursive: true });
const testOnly = process.argv.includes("--test-only");
const version =
  process.argv.find((a) => a.startsWith("--version="))?.slice(10) ??
  JSON.parse(await readFile("package.json", "utf8")).version;
const key = createPrivateKey(
  await readFile(
    process.env.MEMORY_UPDATE_SIGNING_KEY ?? ".local/update-signing-key.pem",
  ),
);
const trust = JSON.parse(
  await readFile("assets/update-public-key.json", "utf8"),
);
if (
  createPublicKey(key).export({ type: "spki", format: "pem" }) !==
  trust.publicKey
)
  throw new Error(
    "Signing key does not match the public verification key. Do not regenerate it for an existing product.",
  );
await mkdir(".local", { recursive: true });
const temp = await mkdtemp(resolve(".local/update-build-"));
const base = join(temp, "base");
await mkdir(base);
const baseZip =
  process.argv.find((a) => a.startsWith("--base="))?.slice(7) ??
  "releases/Memorybook-Windows-x64.zip";
// Extract only a prior published program ZIP, never developer data or settings.
const python =
  process.env.MEMORY_PYTHON ??
  "C:/Users/Ewanice/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
const extracted = spawnSync(
  python,
  [
    "-c",
    `import zipfile,sys,pathlib
with zipfile.ZipFile(sys.argv[1]) as z:
 for i in z.infolist():
  p=pathlib.PurePosixPath(i.filename)
  if p.is_absolute() or '..' in p.parts or '\\\\' in i.filename: raise ValueError('invalid prior archive path')
  if p.parts[0]=='Memorybook': z.extract(i,sys.argv[2])`,
    resolve(baseZip),
    base,
  ],
  { windowsHide: true, encoding: "utf8" },
);
if (extracted.status !== 0)
  throw new Error("Previous full ZIP unavailable: " + extracted.stderr);
const prior = join(base, "Memorybook"),
  names = JSON.parse(
    await readFile(join(packageRoot, "program-files.json"), "utf8"),
  );
const full = await open(
    join(outputRoot, "Memorybook-update-full.bin.package-next"),
    "w",
  ),
  delta = await open(
    join(outputRoot, "Memorybook-update-delta.bin.package-next"),
    "w",
  );
let fullOffset = 0,
  deltaOffset = 0,
  patchCount = 0;
async function append(file, handle, bundle, offset, kind = "file", extra = {}) {
  const bytes = (await stat(file)).size,
    sha256 = await fileHash(file);
  for await (const chunk of createReadStream(file))
    await handle.writeFile(chunk);
  return { bundle, offset, bytes, sha256, kind, ...extra };
}
async function gzip(input, output) {
  await pipeline(
    createReadStream(input),
    createGzip({ level: 9 }),
    createWriteStream(output, { flags: "wx" }),
  );
}
const files = [];
try {
  let index = 0;
  for (const path of names) {
    programName(path);
    const current = join(packageRoot, path),
      info = await stat(current),
      sha256 = await fileHash(current),
      packed = join(temp, `${index}.gz`);
    await gzip(current, packed);
    const source = await append(packed, full, "full", fullOffset);
    fullOffset += source.bytes;
    const sources = [source];
    let basePath = path;
    if (path === "Memorybook.App.exe")
      try {
        await stat(join(prior, path));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        basePath = "Memorybook.exe";
      }
    let oldSha256 = "";
    try {
      oldSha256 = await fileHash(join(prior, basePath));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (oldSha256 !== sha256) {
      let payload = packed,
        kind = "file",
        extra = {};
      if (oldSha256 && info.size > 65536) {
        const raw = join(temp, `${index}.delta`),
          compressed = raw + ".gz";
        await createDelta(join(prior, basePath), current, raw);
        await gzip(raw, compressed);
        if ((await stat(compressed)).size < source.bytes) {
          payload = compressed;
          kind = "delta";
          extra = {
            baseSha256: oldSha256,
            ...(basePath !== path ? { basePath } : {}),
          };
          patchCount++;
        }
      }
      const d = await append(
        payload,
        delta,
        "previous",
        deltaOffset,
        kind,
        extra,
      );
      deltaOffset += d.bytes;
      sources.unshift(d);
    }
    files.push({ path, bytes: info.size, sha256, sources });
    index++;
  }
  await full.sync();
  await delta.sync();
} finally {
  await full.close();
  await delta.close();
}
const { rename } = await import("node:fs/promises");
await rename(
  join(outputRoot, "Memorybook-update-full.bin.package-next"),
  join(outputRoot, "Memorybook-update-full.bin"),
);
await rename(
  join(outputRoot, "Memorybook-update-delta.bin.package-next"),
  join(outputRoot, "Memorybook-update-delta.bin"),
);
const bundles = {};
for (const [name, asset] of [
  ["full", "Memorybook-update-full.bin"],
  ["previous", "Memorybook-update-delta.bin"],
])
  bundles[name] = {
    asset,
    bytes: (await stat(join(outputRoot, asset))).size,
    sha256: await fileHash(join(outputRoot, asset)),
  };
const notesPath = process.argv.find((a) => a.startsWith("--notes="))?.slice(8);
const manifest = {
  format: 1,
  version,
  notes: await readFile(notesPath ?? "docs/release-notes.md", "utf8"),
  dataSchema: 4,
  preferencesSchema: 1,
  files,
  bundles,
};
const payload = Buffer.from(JSON.stringify(manifest)),
  envelope = {
    payload: payload.toString("base64"),
    signature: sign(null, payload, key).toString("base64"),
  };
signedManifest(envelope, trust.publicKey);
await writeFile(
  join(outputRoot, "update-manifest.json"),
  JSON.stringify(envelope, null, 2) + "\n",
);
if (!testOnly)
  await copyFile(
    join(outputRoot, "update-manifest.json"),
    "releases/update-manifest.json",
  );
if (!testOnly)
  await writeFile(
    ".local/update-build-verification.json",
    JSON.stringify(
      {
        passed: true,
        version,
        binaryPatches: patchCount,
        fullBytes: fullOffset,
        differentialBytes: deltaOffset,
        manifestSha256: createHash("sha256")
          .update(await readFile(join(outputRoot, "update-manifest.json")))
          .digest("hex"),
        archiveSha256: await fileHash(join(packageRoot, "resources/app.asar")),
      },
      null,
      2,
    ),
  );
const canonical = resolve(temp);
if (
  !canonical.startsWith(resolve(".local") + "\\update-build-") &&
  !canonical.startsWith(resolve(".local") + "/update-build-")
)
  throw new Error("Invalid temporary cleanup path");
await rm(canonical, { recursive: true, force: true });
console.log(
  JSON.stringify({
    version,
    binaryPatches: patchCount,
    fullMiB: (fullOffset / 1048576).toFixed(2),
    differentialMiB: (deltaOffset / 1048576).toFixed(2),
  }),
);
