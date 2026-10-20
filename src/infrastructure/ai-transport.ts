import { DomainError, type AiConfig } from "../domain/model";
import { assertAiConfig } from "../domain/validation";
import { boundedJson } from "../shared/http";
export function aiIdentity(config: AiConfig): string {
  assertAiConfig(config);
  const url = new URL(config.baseUrl);
  return `${config.protocol}:${url.href.replace(/\/+$/, "")}`;
}
export async function requestModel(
  config: AiConfig,
  apiKey: string,
  instructions: string,
  text: string,
  images: { assetId: string; dataUrl: string }[],
  schema: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  assertAiConfig(config);
  if (!config.model.trim() || !apiKey)
    throw new DomainError("请填写模型名称和 API Key。");
  const base = config.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const selected = config.sendImages ? images : [];
  const imageCaption = selected.length
    ? "\n预览顺序对应素材：" + selected.map((i) => i.assetId).join(", ")
    : "\n未提供图片预览，不要猜测照片中的人物或主体。";
  let body: unknown;
  let endpoint: string;
  if (config.protocol === "responses") {
    endpoint = base + "/responses";
    headers.Authorization = `Bearer ${apiKey}`;
    body = {
      model: config.model,
      store: false,
      max_output_tokens: 6000,
      instructions,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: text + imageCaption },
            ...selected.map((i) => ({
              type: "input_image",
              image_url: i.dataUrl,
              detail: "low",
            })),
          ],
        },
      ],
      ...(config.structuredOutput
        ? {
            text: {
              format: {
                type: "json_schema",
                name: "album_edits",
                strict: true,
                schema,
              },
            },
          }
        : {}),
    };
  } else if (config.protocol === "anthropic") {
    endpoint = base + "/messages";
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: config.model,
      max_tokens: 6000,
      system: instructions,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: text + imageCaption },
            ...selected.map((i) => {
              const comma = i.dataUrl.indexOf(",");
              return {
                type: "image",
                source: {
                  type: "base64",
                  media_type: i.dataUrl.slice(5, i.dataUrl.indexOf(";")),
                  data: i.dataUrl.slice(comma + 1),
                },
              };
            }),
          ],
        },
      ],
    };
  } else {
    endpoint = base + "/chat/completions";
    headers.Authorization = `Bearer ${apiKey}`;
    body = {
      model: config.model,
      stream: false,
      messages: [
        { role: "system", content: instructions },
        {
          role: "user",
          content: selected.length
            ? [
                { type: "text", text: text + imageCaption },
                ...selected.map((i) => ({
                  type: "image_url",
                  image_url: { url: i.dataUrl },
                })),
              ]
            : text + imageCaption,
        },
      ],
      ...(config.structuredOutput
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "album_edits", strict: true, schema },
            },
          }
        : {}),
    };
  }
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    signal,
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const reasons: Record<number, string> = {
      400: "请检查协议、模型名称、图片支持与结构化输出选项",
      401: "API Key 无效或已失效",
      403: "当前 Key 没有访问该模型的权限",
      404: "API 地址或模型不存在",
      429: "平台额度不足或请求频率受限",
    };
    throw new DomainError(
      `AI 平台返回 ${response.status}：${reasons[response.status] ?? "平台服务未完成请求，请稍后重试"}。`,
    );
  }
  const result = (await boundedJson(response)) as Record<string, unknown>;
  let output: string | undefined;
  if (config.protocol === "responses") {
    const value = result as {
      status: string;
      output?: { type: string; content?: { type: string; text?: string }[] }[];
    };
    if (value.status !== "completed")
      throw new DomainError("AI 输出未完成，原稿未修改。");
    output = value.output
      ?.filter((o) => o.type === "message")
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text ?? "")
      .join("");
  } else if (config.protocol === "anthropic") {
    const value = result as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    };
    if (!["end_turn", "stop_sequence"].includes(value.stop_reason ?? ""))
      throw new DomainError("AI 输出未完成，原稿未修改。");
    output = value.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
  } else {
    const value = result as {
      choices?: { finish_reason?: string; message?: { content?: string } }[];
    };
    const choice = value.choices?.[0];
    if (choice?.finish_reason && choice.finish_reason !== "stop")
      throw new DomainError("AI 输出被截断或未正常结束，原稿未修改。");
    output = choice?.message?.content;
  }
  if (typeof output !== "string" || !output.trim())
    throw new DomainError("AI 平台没有返回文本修改方案。");
  try {
    return JSON.parse(output);
  } catch {
    throw new DomainError(
      "模型未按要求返回 JSON。请换用支持结构化排版指令的模型，或开启严格结构化输出。",
    );
  }
}
