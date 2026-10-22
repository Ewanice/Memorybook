import { createHash, verify } from "node:crypto";
import { createReadStream } from "./update-fs";
import { lstat, realpath } from "./update-fs";
import { resolve, join, sep } from "node:path";
import { DomainError } from "../domain/model";

export type UpdateEntry = {
  offset: number;
  bytes: number;
  sha256: string;
  bundle: string;
  kind: "file" | "delta";
  baseSha256?: string;
  basePath?: string;
};
export type UpdateFile = {
  path: string;
  bytes: number;
  sha256: string;
  sources: UpdateEntry[];
};
export type UpdateManifest = {
  format: 1;
  version: string;
  notes: string;
  dataSchema: 4;
  preferencesSchema: 1;
  files: UpdateFile[];
  bundles: Record<string, { asset: string; bytes: number; sha256: string }>;
};
export type UpdateState = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "current"
    | "downloading"
    | "preparing"
    | "ready"
    | "cancelled"
    | "failed"
    | "installing";
  message: string;
  version?: string;
  notes?: string;
  received: number;
  total: number;
  changedFiles?: number;
  differential?: boolean;
};
export function programName(name: unknown): asserts name is string {
  if (
    typeof name !== "string" ||
    name.length > 220 ||
    !/^[A-Za-z0-9_. /-]+$/.test(name) ||
    name.includes("\\") ||
    name
      .split("/")
      .some(
        (p) =>
          !p || p === "." || p === ".." || p.endsWith(".") || p.endsWith(" "),
      ) ||
    /^(data|\.updates|\.git|\.local)(\/|$)/i.test(name) ||
    /^materials\/imported-fonts(\/|$)/i.test(name) ||
    /^(phrases\.txt|update-source\.json)$/i.test(name) ||
    name.includes(":") ||
    /(^|\/)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|\/|$)/i.test(name)
  )
    throw new DomainError("更新清单包含个人资料路径或无效程序路径。");
}
export async function safeProgramPath(
  root: string,
  name: string,
): Promise<string> {
  programName(name);
  const target = resolve(root, name),
    base = await realpath(root);
  if (!target.startsWith(resolve(root) + sep))
    throw new DomainError("更新路径超出软件目录。");
  let current = resolve(root);
  for (const part of name.split("/")) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (
        info.isSymbolicLink() ||
        !(await realpath(current)).startsWith(base + sep)
      )
        throw new DomainError("更新目标不能包含目录链接。");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return target;
}
export async function fileHash(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, {
    highWaterMark: 1024 * 1024,
    signal,
  })) {
    signal?.throwIfAborted();
    hash.update(chunk);
  }
  return hash.digest("hex");
}
export function compareVersion(a: string, b: string): number {
  if (
    ![a, b].every(
      (s) =>
        /^\d+\.\d+\.\d+$/.test(s) &&
        s.split(".").every((n) => Number.isSafeInteger(Number(n))),
    )
  )
    throw new DomainError("更新版本格式无效。");
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  return Math.sign(
    left[0]! - right[0]! || left[1]! - right[1]! || left[2]! - right[2]!,
  );
}
export function updateUrl(value: string, base?: string): URL {
  const url = new URL(value, base);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ))
  )
    throw new DomainError("更新源必须使用 HTTPS；本机测试地址除外。");
  return url;
}
const digest = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const size = (value: unknown) =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= 3 * 1024 ** 3;
export function signedManifest(
  envelope: unknown,
  publicKey: string,
): UpdateManifest {
  const e = envelope as { payload?: unknown; signature?: unknown };
  if (
    !e ||
    typeof e.payload !== "string" ||
    typeof e.signature !== "string" ||
    e.payload.length > 3 * 1024 ** 2 ||
    !verify(
      null,
      Buffer.from(e.payload, "base64"),
      publicKey,
      Buffer.from(e.signature, "base64"),
    )
  )
    throw new DomainError("更新签名无效，已拒绝安装。请使用作者发布的更新包。");
  const m = JSON.parse(
    Buffer.from(e.payload, "base64").toString(),
  ) as UpdateManifest;
  compareVersion(m.version, "0.0.0");
  if (
    m.format !== 1 ||
    m.dataSchema !== 4 ||
    m.preferencesSchema !== 1 ||
    typeof m.notes !== "string" ||
    m.notes.length > 12000 ||
    !Array.isArray(m.files) ||
    !m.files.length ||
    m.files.length > 2000 ||
    !m.bundles ||
    typeof m.bundles !== "object" ||
    Object.keys(m.bundles).length > 10
  )
    throw new DomainError("更新格式或资料版本不兼容，请手动下载完整新版。");
  for (const [key, b] of Object.entries(m.bundles))
    if (
      !/^[a-z0-9-]+$/.test(key) ||
      !/^[A-Za-z0-9_.-]+$/.test(b.asset) ||
      !size(b.bytes) ||
      !b.bytes ||
      !digest(b.sha256)
    )
      throw new DomainError("更新下载清单无效。");
  const names = new Set<string>();
  let total = 0;
  for (const f of m.files) {
    programName(f.path);
    if (
      names.has(f.path.toLowerCase()) ||
      !size(f.bytes) ||
      !digest(f.sha256) ||
      !Array.isArray(f.sources) ||
      !f.sources.length ||
      f.sources.length > 10
    )
      throw new DomainError("更新文件记录无效或重复。");
    names.add(f.path.toLowerCase());
    total += f.bytes;
    for (const s of f.sources) {
      if (s.basePath) programName(s.basePath);
      if (
        !m.bundles[s.bundle] ||
        !size(s.offset) ||
        !size(s.bytes) ||
        !s.bytes ||
        s.offset + s.bytes > m.bundles[s.bundle]!.bytes ||
        !digest(s.sha256) ||
        !["file", "delta"].includes(s.kind) ||
        (s.kind === "delta" && !digest(s.baseSha256))
      )
        throw new DomainError("二进制补丁记录无效。");
    }
    if (!f.sources.some((s) => s.kind === "file"))
      throw new DomainError("更新缺少完整文件恢复来源。");
  }
  if (
    total > 3 * 1024 ** 3 ||
    !names.has("memorybook.exe") ||
    !names.has("memorybook.app.exe") ||
    !names.has("resources/app.asar") ||
    !names.has("program-files.json")
  )
    throw new DomainError("更新程序不完整或超过大小限制。");
  return m;
}
