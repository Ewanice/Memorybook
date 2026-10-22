import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createDelta, applyDelta } from "../src/infrastructure/binary-delta";
import {
  signedManifest,
  compareVersion,
  programName,
  fileHash,
  type UpdateManifest,
} from "../src/infrastructure/update-protocol";
import { UpdateManager } from "../src/infrastructure/update-manager";

const hash = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const pair = generateKeyPairSync("ed25519");
const publicKey = pair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
function envelope(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value));
  return {
    payload: payload.toString("base64"),
    signature: sign(null, payload, pair.privateKey).toString("base64"),
  };
}
async function directory(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "memory-update-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("二进制补丁重建修改、追加、截短和移动块；原版本不匹配、截断和越界被拒绝", async (t) => {
  const root = await directory(t),
    old = join(root, "old"),
    next = join(root, "next");
  const base = Buffer.concat([
    Buffer.alloc(65536, 1),
    Buffer.alloc(65536, 2),
    Buffer.alloc(65536, 3),
  ]);
  await writeFile(old, base);
  for (const [i, target] of [
    Buffer.concat([base.subarray(65536), Buffer.alloc(777, 4)]),
    base.subarray(0, 777),
    Buffer.alloc(0),
    Buffer.concat([base, Buffer.from("append")]),
  ].entries()) {
    await writeFile(next, target);
    const patch = join(root, `patch-${i}`),
      out = join(root, `out-${i}`);
    await createDelta(old, next, patch);
    await applyDelta(old, patch, out, {
      bytes: target.length,
      sha256: hash(target),
    });
    assert.deepEqual(await readFile(out), target);
  }
  await writeFile(next, Buffer.from("modified"));
  const patch = join(root, "invalid");
  await createDelta(old, next, patch);
  const bytes = await readFile(patch);
  await writeFile(patch, bytes.subarray(0, bytes.length - 1));
  await assert.rejects(
    applyDelta(old, patch, join(root, "truncated"), {
      bytes: 8,
      sha256: hash("modified"),
    }),
    /截断/,
  );
  await writeFile(patch, bytes);
  await writeFile(old, "wrong-base");
  await assert.rejects(
    applyDelta(old, patch, join(root, "wrong"), {
      bytes: 8,
      sha256: hash("modified"),
    }),
    /不匹配/,
  );
});

test("更新清单须通过固定公钥签名、程序路径与范围校验，版本按数字比较", () => {
  assert(compareVersion("1.10.0", "1.9.9") > 0);
  assert.throws(() => compareVersion("latest", "1.0.0"));
  for (const path of [
    "../data/a",
    "data/a",
    "DATA/a",
    "materials/imported-fonts/x",
    "phrases.txt",
    "update-source.json",
    "C:/a",
    "a/../b",
    "a\\b",
    ".updates/active.json",
  ])
    assert.throws(() => programName(path));
  const m = fixtureManifest();
  assert.equal(signedManifest(envelope(m), publicKey).version, "2.0.0");
  const altered = envelope(m);
  altered.payload = Buffer.from(
    JSON.stringify({ ...m, version: "9.0.0" }),
  ).toString("base64");
  assert.throws(() => signedManifest(altered, publicKey), /签名/);
  assert.throws(
    () =>
      signedManifest(
        envelope({
          ...m,
          files: [...m.files, { ...m.files[0], path: "data/private" }],
        }),
        publicKey,
      ),
    /个人资料/,
  );
  assert.throws(
    () =>
      signedManifest(
        envelope({
          ...m,
          files: [
            ...m.files,
            { ...m.files[0], path: m.files[0]!.path.toUpperCase() },
          ],
        }),
        publicKey,
      ),
    /重复/,
  );
});
function fixtureManifest(): UpdateManifest {
  const names = [
    "Memorybook.exe",
    "Memorybook.App.exe",
    "resources/app.asar",
    "program-files.json",
  ];
  const data = gzipSync("new program");
  return {
    format: 1,
    version: "2.0.0",
    notes: "Test",
    dataSchema: 4,
    preferencesSchema: 1,
    bundles: {
      full: { asset: "full.bin", bytes: data.length, sha256: hash(data) },
    },
    files: names.map((path) => ({
      path,
      bytes: 11,
      sha256: hash("new program"),
      sources: [
        {
          bundle: "full",
          offset: 0,
          bytes: data.length,
          sha256: hash(data),
          kind: "file",
        },
      ],
    })),
  };
}

test("手动检查才联网；取消、签名篡改、下载损坏均不改变程序或个人文件", async (t) => {
  const root = await directory(t);
  await mkdir(join(root, "resources"));
  await mkdir(join(root, "data"));
  await writeFile(join(root, "data", "private"), "private");
  await writeFile(join(root, "Memorybook.exe"), "old");
  await writeFile(join(root, "Memorybook.App.exe"), "old");
  await writeFile(join(root, "resources/app.asar"), "old");
  await writeFile(
    join(root, "program-files.json"),
    JSON.stringify([
      "Memorybook.exe",
      "Memorybook.App.exe",
      "resources/app.asar",
      "program-files.json",
    ]),
  );
  const seed = join(root, "seed.json");
  await writeFile(
    seed,
    JSON.stringify({
      provider: "static",
      manifestUrl: "http://127.0.0.1/update-manifest.json",
    }),
  );
  let requests = 0,
    broken = false,
    wait = false;
  const manifest = fixtureManifest();
  const transport: typeof fetch = async (input, init) => {
    requests++;
    if (String(input).endsWith("update-manifest.json"))
      return new Response(JSON.stringify(envelope(manifest)));
    if (wait)
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    return new Response(broken ? gzipSync("broken") : gzipSync("new program"));
  };
  const manager = new UpdateManager({
    root,
    version: "1.0.0",
    publicKey,
    seed,
    fetch: transport,
  });
  assert.equal(requests, 0);
  await manager.check();
  assert.equal(manager.state.status, "available");
  broken = true;
  await manager.prepare();
  assert.equal(manager.state.status, "failed");
  assert.equal(await readFile(join(root, "Memorybook.exe"), "utf8"), "old");
  broken = false;
  wait = true;
  const preparing = manager.prepare();
  while (manager.state.status !== "downloading")
    await new Promise((r) => setTimeout(r, 10));
  await manager.cancel();
  await preparing;
  assert.equal(manager.state.status, "cancelled");
  wait = false;
  await manager.check();
  await manager.prepare();
  assert.equal(manager.state.status, "ready");
  assert.equal(await readFile(join(root, "data/private"), "utf8"), "private");
  assert.equal(await readFile(join(root, "Memorybook.exe"), "utf8"), "old");
  const source = await readFile(join(root, "update-source.json"), "utf8");
  await manager.cancel();
  assert.equal(manager.state.status, "cancelled");
  assert.equal(
    await readFile(join(root, "update-source.json"), "utf8"),
    source,
  );
});

test("差分下载重建程序，只准备变化的程序文件，不触碰工程和已选更新源", async (t) => {
  const root = await directory(t);
  await mkdir(join(root, "resources"));
  const before = Buffer.alloc(1024 * 1024, 7),
    after = Buffer.from(before);
  after[123456] = 8;
  await writeFile(join(root, "Memorybook.exe"), before);
  await writeFile(join(root, "Memorybook.App.exe"), "new program");
  await writeFile(join(root, "resources/app.asar"), "new program");
  const names = [
      "Memorybook.exe",
      "Memorybook.App.exe",
      "resources/app.asar",
      "program-files.json",
    ],
    list = Buffer.from(JSON.stringify(names));
  await writeFile(join(root, "program-files.json"), list);
  await writeFile(join(root, "new"), after);
  await createDelta(
    join(root, "Memorybook.exe"),
    join(root, "new"),
    join(root, "patch"),
  );
  const compressed = gzipSync(await readFile(join(root, "patch")));
  const m = fixtureManifest();
  m.files[0] = {
    path: "Memorybook.exe",
    bytes: after.length,
    sha256: hash(after),
    sources: [
      {
        bundle: "previous",
        offset: 0,
        bytes: compressed.length,
        sha256: hash(compressed),
        kind: "delta",
        baseSha256: hash(before),
      },
      m.files[0]!.sources[0]!,
    ],
  };
  m.files[3] = { ...m.files[3]!, bytes: list.length, sha256: hash(list) };
  m.bundles.previous = {
    asset: "delta.bin",
    bytes: compressed.length,
    sha256: hash(compressed),
  };
  const seed = join(root, "seed.json");
  await writeFile(
    seed,
    JSON.stringify({
      provider: "static",
      manifestUrl: "http://127.0.0.1/update-manifest.json",
    }),
  );
  const urls: string[] = [];
  const transport: typeof fetch = async (input) => {
    urls.push(String(input));
    return new Response(
      String(input).endsWith("update-manifest.json")
        ? JSON.stringify(envelope(m))
        : compressed,
    );
  };
  const manager = new UpdateManager({
    root,
    version: "1.0.0",
    publicKey,
    seed,
    fetch: transport,
  });
  await manager.check();
  await manager.prepare();
  assert.equal(manager.state.status, "ready");
  assert(manager.state.differential);
  assert.equal(manager.state.changedFiles, 1);
  assert(manager.state.total < 1024 * 16);
  assert(!urls.some((url) => url.endsWith("full.bin")));
  const plan = await manager.installation([], []);
  const staged = join(plan.directory, "stage", "Memorybook.exe");
  assert.equal(await fileHash(staged), hash(after));
  assert.equal((await stat(join(root, "Memorybook.exe"))).size, before.length);
});
