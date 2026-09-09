// node --test src/components/Ticket/ticket-draft.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

// Модуль берёт хранилище из globalThis: в браузере это localStorage, здесь —
// подделка. Ставим её ДО импорта, иначе модуль решит, что хранилища нет.
const store = new Map();
let throwOnWrite = false;
globalThis.localStorage = {
  get length() {
    return store.size;
  },
  key: (index) => [...store.keys()][index] ?? null,
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => {
    if (throwOnWrite) throw new Error("quota");
    store.set(key, String(value));
  },
  removeItem: (key) => void store.delete(key),
};

const {
  DRAFT_PREFIX,
  DRAFT_TTL_MS,
  clearAllDrafts,
  clearDraft,
  readDraft,
  saveDraft,
} = await import("./ticket-draft.js");

const reset = () => {
  store.clear();
  throwOnWrite = false;
};
const data = { title: "", description: "<p>Текст</p>", customFields: [] };

test("save → read: тот же слепок и метка времени", () => {
  reset();
  const before = Date.now();
  saveDraft({ userId: "u1", templateId: "t1", data });
  const draft = readDraft({ userId: "u1", templateId: "t1" });
  assert.deepEqual(draft.data, data);
  assert.ok(draft.savedAt >= before && draft.savedAt <= Date.now());
  assert.equal(draft.hadFiles, false);
});

test("черновики не смешиваются: свой у каждого человека и каждой заготовки", () => {
  reset();
  saveDraft({ userId: "u1", templateId: "t1", data: { title: "A" } });
  saveDraft({ userId: "u1", templateId: "t2", data: { title: "B" } });
  saveDraft({ userId: "u2", templateId: "t1", data: { title: "C" } });
  assert.equal(readDraft({ userId: "u1", templateId: "t1" }).data.title, "A");
  assert.equal(readDraft({ userId: "u1", templateId: "t2" }).data.title, "B");
  assert.equal(readDraft({ userId: "u2", templateId: "t1" }).data.title, "C");
});

test("заявка без шаблона — свой черновик, а не общий с шаблонами", () => {
  reset();
  saveDraft({ userId: "u1", templateId: null, data: { title: "свободная" } });
  assert.equal(readDraft({ userId: "u1", templateId: null }).data.title, "свободная");
  assert.equal(readDraft({ userId: "u1", templateId: "t1" }), null);
});

test("просроченный черновик не возвращается и удаляется", () => {
  reset();
  saveDraft({ userId: "u1", templateId: "t1", data });
  const key = [...store.keys()][0];
  const stored = JSON.parse(store.get(key));
  stored.savedAt = Date.now() - DRAFT_TTL_MS - 1000;
  store.set(key, JSON.stringify(stored));
  assert.equal(readDraft({ userId: "u1", templateId: "t1" }), null);
  assert.equal(store.size, 0);
});

test("чтение попутно чистит чужие просроченные черновики", () => {
  reset();
  saveDraft({ userId: "u1", templateId: "t1", data });
  saveDraft({ userId: "u1", templateId: "t2", data });
  const stale = `${DRAFT_PREFIX}u1.t2`;
  store.set(
    stale,
    JSON.stringify({ savedAt: Date.now() - DRAFT_TTL_MS - 1, data }),
  );
  store.set("hd.unrelated", "не трогать");
  assert.ok(readDraft({ userId: "u1", templateId: "t1" }));
  assert.equal(store.has(stale), false);
  assert.equal(store.get("hd.unrelated"), "не трогать");
});

test("испорченная запись — как будто черновика нет", () => {
  reset();
  store.set(`${DRAFT_PREFIX}u1.t1`, "{не json");
  assert.equal(readDraft({ userId: "u1", templateId: "t1" }), null);
  assert.equal(store.size, 0);
});

test("запись без слепка данных черновиком не считается", () => {
  reset();
  store.set(`${DRAFT_PREFIX}u1.t1`, JSON.stringify({ savedAt: Date.now() }));
  assert.equal(readDraft({ userId: "u1", templateId: "t1" }), null);
});

test("hadFiles запоминается: вложения черновик не хранит", () => {
  reset();
  saveDraft({ userId: "u1", templateId: "t1", data, hadFiles: true });
  assert.equal(readDraft({ userId: "u1", templateId: "t1" }).hadFiles, true);
});

test("clearDraft убирает только свой черновик", () => {
  reset();
  saveDraft({ userId: "u1", templateId: "t1", data });
  saveDraft({ userId: "u1", templateId: "t2", data });
  clearDraft({ userId: "u1", templateId: "t1" });
  assert.equal(readDraft({ userId: "u1", templateId: "t1" }), null);
  assert.ok(readDraft({ userId: "u1", templateId: "t2" }));
});

test("clearAllDrafts уносит черновики всех, чужие ключи не трогает", () => {
  reset();
  saveDraft({ userId: "u1", templateId: "t1", data });
  saveDraft({ userId: "u2", templateId: null, data });
  store.set("token", "секрет");
  clearAllDrafts();
  assert.equal(store.size, 1);
  assert.equal(store.get("token"), "секрет");
});

test("отказ хранилища не роняет форму", () => {
  reset();
  throwOnWrite = true;
  assert.doesNotThrow(() => saveDraft({ userId: "u1", templateId: "t1", data }));
  assert.equal(readDraft({ userId: "u1", templateId: "t1" }), null);
});

test("без хранилища вовсе — тихие пустышки", async () => {
  reset();
  const saved = globalThis.localStorage;
  globalThis.localStorage = undefined;
  try {
    assert.doesNotThrow(() => saveDraft({ userId: "u1", templateId: "t1", data }));
    assert.equal(readDraft({ userId: "u1", templateId: "t1" }), null);
    assert.doesNotThrow(() => clearAllDrafts());
  } finally {
    globalThis.localStorage = saved;
  }
});

test("без пользователя черновик не пишется: перепутать чужой хуже, чем потерять", () => {
  reset();
  saveDraft({ userId: "", templateId: "t1", data });
  assert.equal(store.size, 0);
  assert.equal(readDraft({ userId: "", templateId: "t1" }), null);
});
