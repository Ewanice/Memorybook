import { verify } from "node:crypto";
import { DomainError, type LicenseInfo } from "../domain/model";
export function verifyLicense(
  token: string,
  publicKey: string,
  development: boolean,
): LicenseInfo {
  if (token.length > 8192) throw new DomainError("卡密长度无效。");
  const parts = token.trim().split(".");
  if (parts.length !== 2 || !parts.every((p) => /^[\w-]+$/.test(p)))
    throw new DomainError("卡密格式不正确，请粘贴完整卡密。");
  const payload = Buffer.from(parts[0]!, "base64url");
  const signature = Buffer.from(parts[1]!, "base64url");
  if (!verify(null, payload, publicKey, signature))
    throw new DomainError("卡密签名无效。");
  let data: unknown;
  try {
    data = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new DomainError("卡密内容不是合法数据。");
  }
  if (!data || typeof data !== "object")
    throw new DomainError("卡密内容无效。");
  const value = data as Record<string, unknown>;
  if (
    value.productId !== "memorybook-desktop" ||
    value.majorVersion !== 1 ||
    value.edition !== "personal" ||
    value.keyId !== (development ? "dev" : "release-v1") ||
    value.licenseId !== (development ? "development" : "shared-v1")
  )
    throw new DomainError("卡密与当前产品或版本不匹配。");
  return { valid: true, id: String(value.licenseId), development };
}
