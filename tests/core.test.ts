import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAlbum } from "../src/domain/templates";
import { applyEdit } from "../src/domain/edit";
import { assertAlbum, assertSettings } from "../src/domain/validation";
import { defaultSettings, type Album } from "../src/domain/model";
import { Store } from "../src/infrastructure/store";
import { verifyLicense } from "../src/infrastructure/license";
import { applyProposal, AiCoordinator } from "../src/application/ai";
import { AlbumService } from "../src/application/service";

function album(): Album {
  return createAlbum("明日世界", "北京", "paper", "a5", []);
}
function database(t: { after: (fn: () => void) => void }): Store {
  const path = mkdtempSync(join(tmpdir(), "memorybook-test-"));
  const store = new Store(path);
  t.after(() => {
    store.close();
    rmSync(path, { recursive: true, force: true });
  });
  return store;
}

test("生成结构化封面，标题与城市独立，空项目可编辑", () => {
  const a = album();
  assertAlbum(a);
  assert.equal(a.pages.length, 2);
  assert.deepEqual(
    a.pages[0]!.elements.map((e) => (e.type === "text" ? e.text : "")),
    ["明日世界", "北京"],
  );
});
test("拒绝重复 ID、失效批注和非有限几何", () => {
  const a = album();
  a.pages[1]!.id = a.pages[0]!.id;
  assert.throws(() => assertAlbum(a));
  const b = album();
  b.pages[0]!.elements[0]!.frame.width = NaN;
  assert.throws(() => assertAlbum(b));
});
test("人工编辑不修改源快照，目标变化使批注需复核", () => {
  const a = album();
  const p = a.pages[0]!;
  const el = p.elements[0]!;
  const annotated = applyEdit(a, {
    type: "annotation",
    pageId: p.id,
    elementId: el.id,
    text: "移动一下",
    review: false,
  });
  const edited = applyEdit(annotated, {
    type: "replaceElement",
    pageId: p.id,
    element: { ...el, frame: { ...el.frame, x: 40 } },
  });
  assert.equal(a.annotations.length, 0);
  assert.equal(edited.annotations[0]!.status, "needsReview");
});
test("锁定元素不能移动，只能明确解锁", () => {
  const a = album();
  const p = a.pages[0]!;
  p.elements[0]!.locked = true;
  const el = p.elements[0]!;
  assert.throws(() =>
    applyEdit(a, {
      type: "replaceElement",
      pageId: p.id,
      element: { ...el, frame: { ...el.frame, x: 99 } },
    }),
  );
  assert.equal(
    applyEdit(a, {
      type: "replaceElement",
      pageId: p.id,
      element: { ...el, locked: false },
    }).pages[0]!.elements[0]!.locked,
    false,
  );
});
test("连续属性补丁只合并实际修改，不覆盖之前的位置或字号", () => {
  const a = album();
  const p = a.pages[0]!;
  const el = p.elements[0]!;
  const moved = applyEdit(a, {
    type: "patchElement",
    pageId: p.id,
    elementId: el.id,
    patch: { frame: { x: 40 } },
  });
  const styled = applyEdit(moved, {
    type: "patchElement",
    pageId: p.id,
    elementId: el.id,
    patch: { style: { fontSize: 20 } },
  });
  assert.equal(styled.pages[0]!.elements[0]!.frame.x, 40);
  assert.equal(
    (styled.pages[0]!.elements[0] as { style: { fontSize: number } }).style
      .fontSize,
    20,
  );
  assert.throws(() =>
    applyEdit(a, {
      type: "patchElement",
      pageId: p.id,
      elementId: el.id,
      patch: { style: { color: "invalid" } },
    }),
  );
});
test("AI 历史可持久化对比，后续人工修改必须先撤销", (t) => {
  const s = database(t);
  const a = s.create(album());
  const b = s.save({ ...a, name: "AI修改后" }, 0, "ai");
  assert.equal(s.comparison(a.id)!.before.name, a.name);
  const c = s.save({ ...b, name: "手动修改后" }, b.revision);
  assert.throws(() => s.undoAi(a.id, c.revision));
  const d = s.history(a.id, "undo", c.revision);
  assert.equal(s.undoAi(a.id, d.revision).name, a.name);
});
test("PDF 导出时允许人工编辑，但阻止并发 AI 与再次导出", (t) => {
  const s = database(t);
  const a = s.create(album());
  const service = new AlbumService(s);
  service.setTask(a.id, { status: "exporting", message: "" });
  assert.equal(
    service.edit(a.id, 0, { type: "rename", name: "导出中编辑" }).name,
    "导出中编辑",
  );
  assert.throws(() => service.assertTaskFree(a.id));
});
test("删除元素时移除批注，不能删除封面", () => {
  const a = album();
  const p = a.pages[0]!;
  const el = p.elements[0]!;
  const n = applyEdit(a, {
    type: "annotation",
    pageId: p.id,
    elementId: el.id,
    text: "修改",
    review: false,
  });
  assert.equal(
    applyEdit(n, { type: "removeElement", pageId: p.id, elementId: el.id })
      .annotations.length,
    0,
  );
  assert.throws(() => applyEdit(a, { type: "removePage", pageId: p.id }));
});
test("SQLite 版本冲突拒绝写入，历史跨保存保留且 revision 单调增加", (t) => {
  const s = database(t);
  const a = s.create(album());
  const changed = s.save({ ...a, name: "新版" }, a.revision);
  assert.throws(() => s.save({ ...a, name: "过期写入" }, a.revision));
  assert.equal(s.get(a.id).name, "新版");
  const undone = s.history(a.id, "undo", changed.revision);
  assert.equal(undone.name, a.name);
  assert.equal(undone.revision, 2);
  const redo = s.history(a.id, "redo", undone.revision);
  assert.equal(redo.name, "新版");
});
test("撤销后新编辑废弃旧 redo 分支", (t) => {
  const s = database(t);
  const a = s.create(album());
  const b = s.save({ ...a, name: "二" }, 0);
  const c = s.history(a.id, "undo", b.revision);
  const d = s.save({ ...c, name: "三" }, c.revision);
  assert.throws(() => s.history(a.id, "redo", d.revision));
});
test("设置校验拒绝未知字段，损坏设置只临时降级且保留原文", (t) => {
  const s = database(t);
  assertSettings(defaultSettings);
  assert.throws(() => assertSettings({ ...defaultSettings, unknown: true }));
  s.setValue("settings", "{broken");
  assert.deepEqual(s.settings(), defaultSettings);
  assert.equal(s.getValue("settings"), "{broken");
});
test("同一个签名卡密可重复验证，伪造与开发码不可进入正式版本", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key = publicKey.export({ type: "spki", format: "pem" }).toString();
  const payload = Buffer.from(
    JSON.stringify({
      productId: "memorybook-desktop",
      majorVersion: 1,
      edition: "personal",
      licenseId: "shared-v1",
      keyId: "release-v1",
    }),
  );
  const token =
    payload.toString("base64url") +
    "." +
    sign(null, payload, privateKey).toString("base64url");
  assert.deepEqual(
    verifyLicense(token, key, false),
    verifyLicense(token, key, false),
  );
  assert.throws(() => verifyLicense(token, key, true));
  const bad = Buffer.from(payload.toString().replace("personal", "business"));
  assert.throws(() =>
    verifyLicense(
      bad.toString("base64url") + "." + token.split(".")[1],
      key,
      false,
    ),
  );
});
function annotated(): Album {
  const a = album();
  return applyEdit(a, {
    type: "annotation",
    pageId: a.pages[0]!.id,
    elementId: a.pages[0]!.elements[0]!.id,
    text: "标题改颜色",
    review: true,
  });
}
test("AI 仅能修改提交目标，完整方案一次应用", () => {
  const a = annotated();
  const el = a.pages[0]!.elements[0]!;
  const result = applyProposal(a, {
    baseRevision: a.revision,
    results: [
      {
        annotationId: a.annotations[0]!.id,
        status: "proposed",
        message: "已改颜色",
        element:
          el.type === "text"
            ? { ...el, style: { ...el.style, color: "#eecc88" } }
            : el,
      },
    ],
  });
  assert.equal(result.annotations[0]!.status, "applied");
  assert.equal(a.annotations[0]!.status, "pending");
});
test("AI 非授权 ID、越界和非法结构整批拒绝", () => {
  const a = annotated();
  const el = a.pages[0]!.elements[0]!;
  assert.throws(() =>
    applyProposal(a, {
      baseRevision: a.revision,
      results: [
        {
          annotationId: a.annotations[0]!.id,
          status: "proposed",
          message: "修改",
          element: { ...el, id: "another" },
        },
      ],
    }),
  );
  assert.throws(() =>
    applyProposal(a, {
      baseRevision: a.revision,
      results: [
        {
          annotationId: a.annotations[0]!.id,
          status: "proposed",
          message: "修改",
          element: { ...el, frame: { ...el.frame, x: 999 } },
        },
      ],
    }),
  );
});
test("本地取消释放锁，晚到 AI 结果不会覆盖后续编辑", async (t) => {
  const s = database(t);
  const a = s.create(annotated());
  s.saveSettings({ ...defaultSettings, aiEnabled: true });
  const service = new AlbumService(s);
  let reply!: (value: unknown) => void;
  const ai = new AiCoordinator(service, {
    configured: () => true,
    propose: async () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  });
  t.after(() => ai.cancelAll());
  ai.start(a.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.throws(() =>
    service.edit(a.id, a.revision, { type: "rename", name: "不能写" }),
  );
  ai.cancel(a.id);
  const b = service.edit(a.id, a.revision, {
    type: "rename",
    name: "取消后新编辑",
  });
  reply({
    baseRevision: a.revision,
    results: [
      {
        annotationId: a.annotations[0]!.id,
        status: "needsInput",
        message: "稍后结果",
      },
    ],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.get(a.id).revision, b.revision);
  assert.equal(s.get(a.id).name, "取消后新编辑");
  assert.equal(service.state(a.id).status, "cancelled");
});
