import { DomainError } from "../domain/model";
export async function boundedJson(
  response: Response,
  maxBytes = 2_000_000,
): Promise<unknown> {
  if (
    Number(response.headers.get("content-length") || 0) > maxBytes ||
    !response.body
  )
    throw new DomainError("服务返回内容过大或为空。");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > maxBytes) throw new DomainError("服务返回内容超出限制。");
      parts.push(part.value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(joined));
  } catch {
    throw new DomainError("服务未返回有效 JSON。");
  }
}
