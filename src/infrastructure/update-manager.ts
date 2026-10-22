import {
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
} from "./update-fs";
import { createReadStream, createWriteStream } from "./update-fs";
import { join, dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createGunzip } from "node:zlib";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readFile as readSeed } from "node:fs/promises";
import { health } from "./health";
import { DomainError } from "../domain/model";
import { writeAtomic } from "./atomic-file";
import { requireSpace } from "./archive";
import { applyDelta } from "./binary-delta";
import {
  type UpdateState,
  type UpdateManifest,
  type UpdateEntry,
  fileHash,
  compareVersion,
  signedManifest,
  updateUrl,
  safeProgramPath,
  programName,
} from "./update-protocol";

export type UpdateOptions = {
  root: string;
  version: string;
  publicKey: string;
  seed: string;
  fetch: typeof fetch;
};
export class UpdateManager {
  state: UpdateState = {
    status: "idle",
    message: "仅在点击检查更新时联网。",
    received: 0,
    total: 0,
  };
  private controller?: AbortController;
  private manifest?: UpdateManifest;
  private urls = new Map<string, string>();
  private ready?: {
    id: string;
    directory: string;
    files: {
      path: string;
      sha256: string;
      oldSha256: string;
      existed: boolean;
    }[];
  };
  constructor(private options: UpdateOptions) {}
  private async pruneCompleted() {
    const work = join(resolve(this.options.root), ".updates");
    let names: string[];
    try {
      names = await readdir(work);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if ((await lstat(work)).isSymbolicLink() || (await realpath(work)) !== work)
      throw new DomainError("更新目录不能使用链接。");
    const completed: { directory: string; time: number }[] = [];
    for (const name of names.filter((n) => /^[a-f0-9]{32}$/.test(n))) {
      const directory = join(work, name);
      if ((await lstat(directory)).isSymbolicLink()) continue;
      try {
        const info = await stat(join(directory, "committed.json"));
        const plan = JSON.parse(
          await readFile(join(directory, "plan.json"), "utf8"),
        );
        if (
          plan.id === name &&
          resolve(plan.root) === resolve(this.options.root)
        )
          completed.push({ directory, time: info.mtimeMs });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    completed.sort((a, b) => b.time - a.time);
    for (const { directory } of completed.slice(1))
      if (
        dirname(directory) === work &&
        (await realpath(directory)) === directory
      )
        await rm(directory, { recursive: true, force: true });
  }
  private begin(status: UpdateState["status"], message: string) {
    if (this.controller || this.state.status === "installing")
      throw new DomainError("请先完成或取消当前更新任务。");
    this.controller = new AbortController();
    this.state = { ...this.state, status, message, received: 0, total: 0 };
    return this.controller;
  }
  async cancel() {
    if (this.state.status === "installing")
      throw new DomainError("请在独立更新窗口中取消，程序会先恢复原版本。");
    this.controller?.abort();
    if (this.state.status === "ready") {
      const directory = this.ready?.directory;
      this.ready = undefined;
      if (
        directory &&
        dirname(directory) === join(resolve(this.options.root), ".updates")
      )
        await rm(directory, { recursive: true, force: true });
      this.state = {
        ...this.state,
        status: "cancelled",
        message: "已取消，原程序和个人资料未改变。",
      };
    }
  }
  private async json(
    url: string,
    signal: AbortSignal,
    limit = 3 * 1024 ** 2,
  ): Promise<unknown> {
    const response = await this.options.fetch(updateUrl(url), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: { Accept: "application/json" },
    });
    if (!response.ok || !response.body)
      throw new DomainError(
        `更新源暂不可用（${response.status}），可稍后重试或手动下载。`,
      );
    let size = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new DomainError("更新清单超过限制。");
      signal.throwIfAborted();
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  async check(): Promise<UpdateState> {
    if (this.ready) await this.cancel();
    const controller = this.begin("checking", "正在检查更新…");
    this.ready = undefined;
    this.manifest = undefined;
    this.urls.clear();
    try {
      await this.pruneCompleted();
      const configPath = join(this.options.root, "update-source.json");
      try {
        await writeFile(configPath, await readSeed(this.options.seed), {
          flag: "wx",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      if ((await stat(configPath)).size > 16384)
        throw new DomainError("更新源配置文件过大。");
      const config = JSON.parse(await readFile(configPath, "utf8")) as {
        provider: string;
        apiBase?: string;
        repository?: string;
        manifestAsset?: string;
        manifestUrl?: string;
      };
      let manifestUrl: string;
      let assets: { name: string; browser_download_url: string }[] | undefined;
      let releaseVersion: string | undefined;
      if (config.provider === "github") {
        if (
          !config.apiBase ||
          !config.repository ||
          !/^[-\w.]+\/[-\w.]+$/.test(config.repository) ||
          !config.manifestAsset
        )
          throw new DomainError(
            "update-source.json 中的 GitHub 更新源配置无效。",
          );
        const release = (await this.json(
          new URL(
            `repos/${config.repository}/releases/latest`,
            updateUrl(config.apiBase.replace(/\/?$/, "/")),
          ).href,
          controller.signal,
        )) as {
          tag_name: string;
          assets: { name: string; browser_download_url: string }[];
        };
        releaseVersion = release.tag_name?.replace(/^v/, "");
        if (compareVersion(releaseVersion, this.options.version) <= 0) {
          this.state = {
            ...this.state,
            status: "current",
            message: "当前已是最新版本。",
          };
          return this.state;
        }
        assets = release.assets;
        if (!Array.isArray(assets))
          throw new DomainError("GitHub 发布信息不完整。");
        const asset = assets.find((a) => a.name === config.manifestAsset);
        if (!asset)
          throw new DomainError(
            "该版本尚未发布自动更新附件，请稍后重试或手动下载。",
          );
        manifestUrl = updateUrl(asset.browser_download_url).href;
      } else if (config.provider === "static" && config.manifestUrl)
        manifestUrl = updateUrl(config.manifestUrl).href;
      else
        throw new DomainError(
          "更新源配置无效，请检查软件目录的 update-source.json。",
        );
      const manifest = signedManifest(
        await this.json(manifestUrl, controller.signal),
        this.options.publicKey,
      );
      if (releaseVersion && manifest.version !== releaseVersion)
        throw new DomainError("发布版本与签名更新清单不一致。");
      if (compareVersion(manifest.version, this.options.version) <= 0) {
        this.state = {
          ...this.state,
          status: "current",
          message: "当前已是最新版本。",
        };
        return this.state;
      }
      for (const [key, bundle] of Object.entries(manifest.bundles)) {
        const asset = assets?.find((a) => a.name === bundle.asset);
        if (assets && !asset)
          throw new DomainError("更新附件尚未上传完整，请稍后再试。");
        this.urls.set(
          key,
          updateUrl(asset?.browser_download_url ?? bundle.asset, manifestUrl)
            .href,
        );
      }
      this.manifest = manifest;
      this.state = {
        status: "available",
        message: "发现新版本，可下载后选择重启更新。",
        version: manifest.version,
        notes: manifest.notes,
        received: 0,
        total: 0,
      };
    } catch (error) {
      this.failure(error, controller.signal);
    } finally {
      this.controller = undefined;
    }
    return this.state;
  }
  private failure(error: unknown, signal: AbortSignal) {
    if (!signal.aborted) health.report("software-update", error);
    this.state = {
      ...this.state,
      status: signal.aborted ? "cancelled" : "failed",
      message: signal.aborted
        ? "已取消，原程序和个人资料未改变。"
        : error instanceof DomainError
          ? error.message
          : "更新未完成，请检查网络、磁盘空间和更新源配置；原程序仍可使用。",
    };
  }
  private async download(
    url: string,
    path: string,
    expected: { bytes: number; sha256: string },
    signal: AbortSignal,
  ) {
    const response = await this.options.fetch(updateUrl(url), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15 * 60 * 1000)]),
    });
    if (!response.ok || !response.body)
      throw new DomainError(`更新包下载失败（${response.status}）。`);
    const output = await open(path, "wx"),
      hash = createHash("sha256");
    let size = 0;
    try {
      for await (const chunk of response.body) {
        signal.throwIfAborted();
        size += chunk.length;
        if (size > expected.bytes)
          throw new DomainError("更新包超过签名清单中的大小。");
        hash.update(chunk);
        await output.writeFile(chunk);
        this.state = {
          ...this.state,
          received: this.state.received + chunk.length,
        };
      }
      await output.sync();
    } finally {
      await output.close();
    }
    if (size !== expected.bytes || hash.digest("hex") !== expected.sha256)
      throw new DomainError("更新包下载不完整或校验失败，已拒绝安装。");
  }
  async prepare(): Promise<void> {
    if (!this.manifest) throw new DomainError("请先检查更新。");
    const controller = this.begin("preparing", "正在比较程序文件…"),
      signal = controller.signal,
      root = resolve(this.options.root),
      id = randomUUID().replaceAll("-", ""),
      work = join(root, ".updates"),
      directory = join(work, id);
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await mkdir(work, { recursive: true });
      if (
        (await lstat(work)).isSymbolicLink() ||
        (await realpath(work)) !== work
      )
        throw new DomainError("更新临时目录不能使用链接。");
      const lockPath = join(work, "prepare.lock");
      try {
        lock = await open(lockPath, "wx");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const pid = Number(await readFile(lockPath, "utf8"));
        let alive = true;
        try {
          process.kill(pid, 0);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false;
          else throw e;
        }
        if (alive)
          throw new DomainError("另一个窗口正在准备更新，请等待或取消它。");
        await unlink(lockPath);
        lock = await open(lockPath, "wx");
      }
      await lock.writeFile(String(process.pid));
      await mkdir(join(directory, "stage"), { recursive: true });
      const chosen: {
        file: UpdateManifest["files"][number];
        source: UpdateEntry;
        oldSha256: string;
      }[] = [];
      for (const file of this.manifest.files) {
        signal.throwIfAborted();
        const path = await safeProgramPath(root, file.path);
        let hash = "";
        try {
          hash = await fileHash(path, signal);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        if (hash === file.sha256) continue;
        let source: UpdateEntry | undefined;
        for (const candidate of file.sources.filter(
          (s) => s.kind === "delta",
        )) {
          let baseHash = hash;
          if (candidate.basePath && candidate.basePath !== file.path) {
            try {
              baseHash = await fileHash(
                await safeProgramPath(root, candidate.basePath),
                signal,
              );
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
              baseHash = "";
            }
          }
          if (candidate.baseSha256 === baseHash) {
            source = candidate;
            break;
          }
        }
        source ??=
          file.sources.find((s) => s.kind === "file" && s.bundle !== "full") ??
          file.sources.find((s) => s.kind === "file")!;
        chosen.push({ file, source, oldSha256: hash });
      }
      // If the full container is required anyway, avoid additionally downloading a differential container.
      if (chosen.some((c) => c.source.bundle === "full"))
        for (const c of chosen)
          c.source =
            c.file.sources.find(
              (s) => s.kind === "file" && s.bundle === "full",
            ) ?? c.source;
      const bundles = [...new Set(chosen.map((c) => c.source.bundle))];
      await requireSpace(
        work,
        chosen.reduce((n, c) => n + c.file.bytes * 3, 0) +
          bundles.reduce((n, key) => n + this.manifest!.bundles[key]!.bytes, 0),
      );
      this.state = {
        ...this.state,
        status: "downloading",
        message: "正在下载更新，期间可以继续编辑。",
        total: bundles.reduce(
          (n, key) => n + this.manifest!.bundles[key]!.bytes,
          0,
        ),
        changedFiles: chosen.length,
        differential: chosen.some((c) => c.source.kind === "delta"),
      };
      for (const key of bundles)
        await this.download(
          this.urls.get(key)!,
          join(directory, key + ".bin"),
          this.manifest.bundles[key]!,
          signal,
        );
      this.state = {
        ...this.state,
        status: "preparing",
        message: "正在重建并校验新版程序…",
      };
      const files: {
        path: string;
        sha256: string;
        oldSha256: string;
        existed: boolean;
      }[] = [];
      for (const { file, source, oldSha256 } of chosen) {
        signal.throwIfAborted();
        const stage = join(directory, "stage", file.path);
        await mkdir(dirname(stage), { recursive: true });
        const extracted = source.kind === "delta" ? stage + ".delta" : stage;
        let bytes = 0;
        const hash = createHash("sha256");
        const compressedHash = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            hash.update(chunk);
            callback(null, chunk);
          },
        });
        const limit = file.bytes + Math.ceil(file.bytes / 65536) * 14 + 8192;
        const bounded = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.length;
            callback(
              bytes > limit ? new DomainError("更新解压数据超限。") : null,
              chunk,
            );
          },
        });
        await pipeline(
          createReadStream(join(directory, source.bundle + ".bin"), {
            start: source.offset,
            end: source.offset + source.bytes - 1,
          }),
          compressedHash,
          createGunzip(),
          bounded,
          createWriteStream(extracted, { flags: "wx" }),
          { signal },
        );
        if (hash.digest("hex") !== source.sha256)
          throw new DomainError("更新文件分段校验失败。");
        if (source.kind === "delta") {
          await applyDelta(
            await safeProgramPath(root, source.basePath ?? file.path),
            extracted,
            stage,
            file,
            signal,
          );
          await unlink(extracted);
        }
        if (
          (await stat(stage)).size !== file.bytes ||
          (await fileHash(stage, signal)) !== file.sha256
        )
          throw new DomainError("新版程序文件校验失败。");
        files.push({
          path: file.path,
          sha256: file.sha256,
          oldSha256,
          existed: !!oldSha256,
        });
      }
      const existing = JSON.parse(
        await readFile(join(root, "program-files.json"), "utf8"),
      ) as string[];
      if (!Array.isArray(existing) || existing.length > 2000)
        throw new DomainError("本机程序清单无效，请手动重新解压完整程序。");
      const target = new Set(
        this.manifest.files.map((f) => f.path.toLowerCase()),
      );
      for (const path of existing) {
        if (path === "phrases.txt" || path === "update-source.json") continue;
        programName(path);
        if (target.has(path.toLowerCase())) continue;
        let hash = "";
        try {
          hash = await fileHash(await safeProgramPath(root, path), signal);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        if (hash)
          files.push({ path, sha256: "", oldSha256: hash, existed: true });
      }
      signal.throwIfAborted();
      this.ready = { id, directory, files };
      this.state = {
        ...this.state,
        status: "ready",
        message: "新版已准备完成。保存工程后，可重启并更新；也可以取消。",
      };
    } catch (error) {
      this.failure(error, signal);
      if (directory.startsWith(work + "/") || dirname(directory) === work)
        await rm(directory, { recursive: true, force: true }).catch(() => {
          this.state.message +=
            " 临时更新文件未能清理，可关闭软件后整理 .updates 中的失败下载。";
        });
    } finally {
      if (lock) {
        await lock.close();
        await unlink(join(work, "prepare.lock"));
      }
      this.controller = undefined;
    }
  }
  async installation(arguments_: string[], waitPids: number[]) {
    if (this.state.status !== "ready" || !this.ready || !this.manifest)
      throw new DomainError("请先下载并准备更新。");
    const { id, directory, files } = this.ready;
    await writeAtomic(
      join(directory, "plan.json"),
      Buffer.from(
        JSON.stringify({
          id,
          root: resolve(this.options.root),
          version: this.manifest.version,
          arguments: arguments_,
          waitPids,
          files,
        }),
      ),
    );
    const helper = join(directory, "Memorybook.Update.exe");
    await copyFile(join(this.options.root, "Memorybook.exe"), helper);
    this.state = {
      ...this.state,
      status: "installing",
      message: "正在打开更新窗口，替换期间仍可在该窗口取消。",
    };
    return { helper, id, directory };
  }
}
