import { useEffect, useState } from "react";
import type { AiConfig, Bootstrap } from "../domain/model";
export function AiSettings({
  data,
  action,
  onDirty,
}: {
  data: Bootstrap;
  onDirty?: (value: boolean) => void;
  action: (fn: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  const [config, setConfig] = useState(data.aiConfig);
  const [savedConfig, setSavedConfig] = useState(data.aiConfig);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(data.hasAiToken);
  const [busy, setBusy] = useState(false);
  const dirty =
    JSON.stringify(config) !== JSON.stringify(savedConfig) || Boolean(key);
  useEffect(() => {
    setHasKey(data.hasAiToken);
    if (!dirty) {
      setConfig(data.aiConfig);
      setSavedConfig(data.aiConfig);
    }
  }, [data.aiConfig, data.hasAiToken]);
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  async function save(): Promise<void> {
    await window.memorybook.configureAi(
      config,
      key.trim() ? key : null,
      savedConfig,
    );
    setSavedConfig(config);
    if (key.trim()) setHasKey(true);
    setKey("");
  }
  async function perform(fn: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action(fn, success);
    } finally {
      setBusy(false);
    }
  }
  function change(value: Partial<AiConfig>) {
    setConfig((c) => ({ ...c, ...value }));
  }
  return (
    <>
      <h3>连接你自己的 AI 平台</h3>
      {JSON.stringify(savedConfig) !== JSON.stringify(data.aiConfig) && (
        <p role="status">
          另一个副本更新了 AI 设置，当前未保存的输入已保留。
          <button
            disabled={busy}
            onClick={() => {
              if (
                !dirty ||
                window.confirm("放弃当前未保存的 AI 输入，读取最新设置？")
              ) {
                setConfig(data.aiConfig);
                setSavedConfig(data.aiConfig);
                setKey("");
              }
            }}
          >
            读取最新设置
          </button>
        </p>
      )}
      <p>
        填写平台提供的 API 地址、模型名称和
        Key。请求直接发送到该平台，费用由你的平台账户承担。
      </p>
      <p className="muted">
        AI
        批注可调整现有元素的位置、尺寸、裁切、文字与字体，暂不增删元素或替换照片。开启图片预览后，批注相关页面的缩略图会发送给所填平台。连接成功不代表所有模型都支持图片与结构化修改。
      </p>
      <label className="field">
        API 协议
        <select
          disabled={busy}
          value={config.protocol}
          onChange={(e) =>
            change({
              protocol: e.target.value as AiConfig["protocol"],
              structuredOutput: false,
            })
          }
        >
          <option value="chat-completions">
            OpenAI 兼容 · Chat Completions
          </option>
          <option value="responses">OpenAI 兼容 · Responses</option>
          <option value="anthropic">Anthropic · Messages</option>
        </select>
      </label>
      <label className="field">
        API Base URL
        <input
          aria-label="API Base URL"
          disabled={busy}
          value={config.baseUrl}
          onChange={(e) => change({ baseUrl: e.target.value })}
          placeholder="https://你的平台地址/v1"
        />
        <small>
          填写基础地址，不包含 /chat/completions、/responses 或
          /messages。远程地址需要 HTTPS。
        </small>
      </label>
      <label className="field">
        模型名称
        <input
          aria-label="模型名称"
          disabled={busy}
          value={config.model}
          onChange={(e) => change({ model: e.target.value })}
          placeholder="按平台文档填写模型 ID"
        />
      </label>
      <label className="field">
        API Key
        <input
          aria-label="API Key"
          type="password"
          autoComplete="off"
          disabled={busy}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={
            hasKey ? "已加密保存；留空保留当前 Key" : "粘贴你自己的 API Key"
          }
        />
        <small>
          Key
          只加密保存在本机，不进入工程包或诊断信息。更换地址或协议需要重新输入
          Key。
        </small>
      </label>
      <details>
        <summary>模型能力与隐私</summary>
        <label className="check">
          <input
            type="checkbox"
            disabled={busy}
            checked={config.sendImages}
            onChange={(e) => change({ sendImages: e.target.checked })}
          />
          发送批注相关页面的缩略预览（最多 100 张）
        </label>
        <p className="muted">
          仅当模型支持图片输入时开启。关闭时只发送元素位置、文字和批注；AI
          无法判断照片中的人物或主体。
        </p>
        <label className="check">
          <input
            type="checkbox"
            disabled={busy || config.protocol === "anthropic"}
            checked={config.structuredOutput}
            onChange={(e) => change({ structuredOutput: e.target.checked })}
          />
          严格结构化输出（JSON Schema）
        </label>
        <p className="muted">
          只有平台与模型支持时开启。关闭时仍要求
          JSON，并在本机严格校验修改方案。
        </p>
      </details>
      <div className="button-row">
        <button
          className="primary"
          disabled={busy}
          onClick={() => void perform(save, "AI 连接设置已保存在本机。")}
        >
          {dirty ? "保存连接设置" : "已保存"}
        </button>
        <button
          disabled={
            busy ||
            !data.settings.aiEnabled ||
            (!hasKey && !key.trim()) ||
            !config.model.trim()
          }
          onClick={() =>
            void perform(async () => {
              if (dirty) await save();
              const result = await window.memorybook.testAiConnection();
              return result;
            }).then(() => undefined)
          }
        >
          保存并测试连接
        </button>
        <button
          disabled={busy || !hasKey}
          onClick={() =>
            void perform(async () => {
              await window.memorybook.removeAiKey();
              setHasKey(false);
            }, "本机 API Key 已移除。")
          }
        >
          移除 Key
        </button>
      </div>
      <p className="muted">
        连接测试会实际调用模型，可能消耗少量 API
        额度。平台账单与剩余额度请到对应平台查看。取消任务会阻止本地修改，已发生的模型调用费用由平台计费规则决定。
      </p>
    </>
  );
}
