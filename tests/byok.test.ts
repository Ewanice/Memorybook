import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/infrastructure/store";
import { AiPreferences } from "../src/infrastructure/ai-preferences";
import { requestModel, aiIdentity } from "../src/infrastructure/ai-transport";
import { defaultAiConfig, type AiConfig } from "../src/domain/model";
import { boundedJson } from "../src/shared/http";
import { createAlbum } from "../src/domain/templates";

test("API 地址必须安全，规范化身份不包含模型名", () => {
  assert.throws(() =>
    aiIdentity({ ...defaultAiConfig, baseUrl: "http://api.example.com/v1" }),
  );
  assert.throws(() =>
    aiIdentity({
      ...defaultAiConfig,
      baseUrl: "https://user:password@example.com/v1",
    }),
  );
  assert.equal(
    aiIdentity({ ...defaultAiConfig, baseUrl: "https://api.example.com/v1/" }),
    aiIdentity({
      ...defaultAiConfig,
      baseUrl: "https://api.example.com/v1",
      model: "another",
    }),
  );
  assert.doesNotThrow(() =>
    aiIdentity({ ...defaultAiConfig, baseUrl: "http://127.0.0.1:11434/v1" }),
  );
});
test("切换 API 目的地址必须重新填 Key，错误配置不覆盖原有 Key", () => {
  const path = mkdtempSync(join(tmpdir(), "memory-ai-"));
  const store = new Store(path);
  try {
    const preferences = new AiPreferences(store, {
      encrypt: (s) => Buffer.from(s).toString("base64"),
      decrypt: (s) => Buffer.from(s, "base64").toString(),
    });
    preferences.configure(defaultAiConfig, "private-test-key");
    assert.equal(preferences.key(), "private-test-key");
    assert.throws(() =>
      preferences.configure(
        { ...defaultAiConfig, baseUrl: "https://other.example/v1" },
        null,
      ),
    );
    assert.equal(preferences.key(), "private-test-key");
    preferences.configure({ ...defaultAiConfig, model: "new-model" }, null);
    assert.equal(preferences.key(), "private-test-key");
    preferences.removeKey();
    assert.equal(preferences.key(), "");
    assert.equal(preferences.hasKey(), false);
  } finally {
    store.close();
    rmSync(path, { recursive: true, force: true });
  }
});
for (const protocol of ["chat-completions", "responses", "anthropic"] as const)
  test(`BYOK ${protocol} 请求转换、授权头与响应解析`, async (t) => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      const headers = init?.headers as Record<string, string>;
      assert.equal(init?.redirect, "error");
      assert.equal(
        headers[protocol === "anthropic" ? "x-api-key" : "Authorization"],
        protocol === "anthropic" ? "test-key" : "Bearer test-key",
      );
      assert(String(url).startsWith("https://chosen.example/v1/"));
      assert.equal(body.model, "my-model");
      const text = '{"ok":true}';
      return new Response(
        JSON.stringify(
          protocol === "responses"
            ? {
                status: "completed",
                output: [
                  { type: "message", content: [{ type: "output_text", text }] },
                ],
              }
            : protocol === "anthropic"
              ? { stop_reason: "end_turn", content: [{ type: "text", text }] }
              : {
                  choices: [
                    { finish_reason: "stop", message: { content: text } },
                  ],
                },
        ),
      );
    };
    t.after(() => {
      globalThis.fetch = original;
    });
    const config: AiConfig = {
      ...defaultAiConfig,
      protocol,
      baseUrl: "https://chosen.example/v1",
      model: "my-model",
    };
    assert.deepEqual(
      await requestModel(
        config,
        "test-key",
        "Return JSON",
        "test",
        [],
        {},
        AbortSignal.timeout(1000),
      ),
      { ok: true },
    );
    assert.equal(calls, 1);
  });
test("平台拒绝调用时不自动重试，也不回显 API Key", async (t) => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("private-key-not-for-logs", { status: 401 });
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  await assert.rejects(
    () =>
      requestModel(
        { ...defaultAiConfig, model: "test" },
        "private-key-not-for-logs",
        "JSON",
        "test",
        [],
        {},
        AbortSignal.timeout(1000),
      ),
    (error) =>
      error instanceof Error &&
      !error.message.includes("private-key-not-for-logs"),
  );
  assert.equal(calls, 1);
});
test("超限响应流被中止", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(50));
      controller.enqueue(new Uint8Array(50));
      controller.close();
    },
  });
  await assert.rejects(() => boundedJson(new Response(body), 60));
});
test("已知 v2 数据库迁移为增量历史并保留撤销能力", () => {
  const directory = mkdtempSync(join(tmpdir(), "memory-migrate-"));
  const path = join(directory, "memorybook.sqlite");
  const database = new DatabaseSync(path);
  const before = createAlbum("迁移前", "", "paper", "a5", []);
  const after = { ...before, name: "迁移后", revision: 1 };
  database.exec(
    "CREATE TABLE albums(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,document TEXT NOT NULL,cursor INTEGER NOT NULL DEFAULT 0); CREATE TABLE history(album_id TEXT NOT NULL,seq INTEGER NOT NULL,before_doc TEXT NOT NULL,after_doc TEXT NOT NULL,origin TEXT NOT NULL); CREATE TABLE preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL); PRAGMA user_version=2;",
  );
  database
    .prepare("INSERT INTO albums VALUES(?,?,?,?)")
    .run(after.id, 1, JSON.stringify(after), 1);
  database
    .prepare("INSERT INTO history VALUES(?,?,?,?,?)")
    .run(after.id, 1, JSON.stringify(before), JSON.stringify(after), "manual");
  database.close();
  const store = new Store(directory);
  try {
    assert.equal(store.history(after.id, "undo", 1).name, "迁移前");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
