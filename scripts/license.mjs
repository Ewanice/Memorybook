import { generateKeyPairSync, sign, createPublicKey } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
const mode = process.argv[2];
if (!["dev", "issue", "keygen"].includes(mode))
  throw new Error("使用 dev、keygen 或 issue");
await mkdir(".local", { recursive: true });
if (mode === "keygen") {
  const directory = process.env.MEMORY_KEY_DIRECTORY || ".local/release";
  await mkdir(directory, { recursive: true });
  const pair = generateKeyPairSync("ed25519");
  await writeFile(
    `${directory}/private.pem`,
    pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    { flag: "wx" },
  );
  await writeFile(
    `${directory}/public.pem`,
    pair.publicKey.export({ type: "spki", format: "pem" }),
    { flag: "wx" },
  );
  console.log("正式授权密钥已生成。请离线备份私钥，只把公钥用于构建。");
  process.exit(0);
}
let privateKey;
if (mode === "dev") {
  try {
    await access(".local/private.pem");
    privateKey = await readFile(".local/private.pem", "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const pair = generateKeyPairSync("ed25519");
    privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" });
    await writeFile(".local/private.pem", privateKey, { flag: "wx" });
  }
  await writeFile(
    ".local/public.pem",
    createPublicKey(privateKey).export({ type: "spki", format: "pem" }),
  );
} else {
  if (!process.env.MEMORY_PRIVATE_KEY)
    throw new Error("请提供 MEMORY_PRIVATE_KEY 指向受控环境中的正式私钥");
  privateKey = await readFile(process.env.MEMORY_PRIVATE_KEY, "utf8");
}
const payload = Buffer.from(
  JSON.stringify({
    productId: "memorybook-desktop",
    majorVersion: 1,
    edition: "personal",
    licenseId: mode === "dev" ? "development" : "shared-v1",
    keyId: mode === "dev" ? "dev" : "release-v1",
  }),
);
const token =
  payload.toString("base64url") +
  "." +
  sign(null, payload, privateKey).toString("base64url");
await writeFile(
  `.local/${mode === "dev" ? "development" : "shared-v1"}.license`,
  token,
);
console.log("卡密已保存到 .local 目录；私钥和卡密均不得提交到仓库。");
