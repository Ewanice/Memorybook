import { type AiConfig, defaultAiConfig, DomainError } from "../domain/model";
import { assertAiConfig } from "../domain/validation";
import { aiIdentity } from "./ai-transport";
import type { Store } from "./store";
import { health } from "./health";
export class AiPreferences {
  constructor(
    private store: Store,
    private cipher: {
      encrypt: (text: string) => string;
      decrypt: (encoded: string) => string;
    },
  ) {}
  config(): AiConfig {
    const raw = this.store.getValue("aiConfig");
    if (raw === null) return structuredClone(defaultAiConfig);
    try {
      const value: unknown = JSON.parse(raw);
      assertAiConfig(value);
      health.resolve("ai-config");
      return value;
    } catch {
      this.store.archivePreference("aiConfig", raw);
      health.report(
        "ai-config",
        new DomainError(
          "AI 设置损坏，请重新配置；离线编辑不受影响，原配置已保留。",
        ),
      );
      return structuredClone(defaultAiConfig);
    }
  }
  hasKey(): boolean {
    return Boolean(this.store.getValue("providerCredential"));
  }
  key(config = this.config()): string {
    const raw = this.store.getValue("providerCredential");
    if (!raw) return "";
    let value: { identity: string; key: string };
    try {
      value = JSON.parse(this.cipher.decrypt(raw));
    } catch {
      throw new DomainError("本机 API Key 无法解密，请在设置中重新输入。");
    }
    if (value.identity !== aiIdentity(config) || typeof value.key !== "string")
      throw new DomainError("API 地址已改变，请为该地址重新输入 Key。");
    return value.key;
  }
  configure(input: unknown, key: string | null, expected?: AiConfig): void {
    this.store.preferencesTransaction(() =>
      this.configureLocked(input, key, expected),
    );
  }
  private configureLocked(
    input: unknown,
    key: string | null,
    expected?: AiConfig,
  ): void {
    if (expected && JSON.stringify(expected) !== JSON.stringify(this.config()))
      throw new DomainError("AI 设置已被另一个副本修改，请重新读取后再保存。");
    assertAiConfig(input);
    if (
      key !== null &&
      (typeof key !== "string" ||
        !key.trim() ||
        key.length > 4096 ||
        /[\r\n]/.test(key))
    )
      throw new DomainError("请输入有效的 API Key。");
    if (
      key === null &&
      this.hasKey() &&
      aiIdentity(input) !== aiIdentity(this.config())
    )
      throw new DomainError("更换 API 地址或协议时，请重新输入该平台的 Key。");
    const encoded =
      key === null
        ? null
        : this.cipher.encrypt(
            JSON.stringify({ identity: aiIdentity(input), key: key.trim() }),
          );
    this.store.setValue("aiConfig", JSON.stringify(input));
    if (encoded !== null) this.store.setValue("providerCredential", encoded);
  }
  removeKey(): void {
    this.store.setValue("providerCredential", "");
  }
}
