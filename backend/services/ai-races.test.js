const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

function load(file, deps) {
  const exports = {};
  new Function(
    "require",
    "exports",
    fs.readFileSync(`${__dirname}/${file}`, "utf8"),
  )((id) => {
    if (id in deps) return deps[id];
    return require(id);
  }, exports);
  return exports;
}
function fixture() {
  const row = {
    _id: "t",
    num: 1,
    title: "original",
    description: "request",
    categoryId: null,
    comments: [],
    attachments: [],
    aiTitle: { status: "pending" },
    aiGuide: { status: "idle" },
  };
  const get = (key) => key.split(".").reduce((v, k) => v?.[k], row);
  const matches = (filter) =>
    Object.entries(filter).every(([key, v]) => {
      if (key === "$or") return v.some(matches);
      const actual = get(key);
      if (v && typeof v === "object" && !(v instanceof Date)) {
        if ("$ne" in v) return actual !== v.$ne;
        if ("$lt" in v) return actual != null && actual < v.$lt;
        if ("$lte" in v) return actual != null && actual <= v.$lte;
      }
      return v === null ? actual == null : String(actual) === String(v);
    });
  const apply = (patch) => {
    for (const [key, value] of Object.entries(patch.$set || patch)) {
      if (key.startsWith("$")) continue;
      const parts = key.split(".");
      let target = row;
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      target[parts.at(-1)] = value;
    }
    for (const key of Object.keys(patch.$unset || {})) {
      const parts = key.split(".");
      const target = parts.slice(0, -1).reduce((v, k) => v?.[k], row);
      if (target) delete target[parts.at(-1)];
    }
  };
  const chain = () => ({
    populate() {
      return this;
    },
    select() {
      return this;
    },
    then(resolve) {
      return Promise.resolve(structuredClone(row)).then(resolve);
    },
  });
  const Ticket = {
    findById: chain,
    findByIdAndUpdate: async (_id, patch) => {
      apply(patch);
      return structuredClone(row);
    },
    findOneAndUpdate: async (filter, patch) => {
      if (!matches(filter)) return null;
      apply(patch);
      return structuredClone(row);
    },
    updateOne: async (filter, patch) => {
      if (!matches(filter)) return { matchedCount: 0 };
      apply(patch);
      return { matchedCount: 1 };
    },
  };
  const deps = {
    "@/models/ticket": { Ticket },
    "./aiService": {},
    "@/models/company": {},
    "@/models/work": {},
    "@/utils/logger": { log() {} },
    "@/helpers/textScan": { stripTags: (x) => x },
    "./aiRules": { rulesFor: async () => "" },
    "./aiTicketLog": { logAiTicketEvent: async () => {} },
    "@/helpers/deriveTicketTitle": { MAX_TITLE_LENGTH: 200 },
    "@/models/ticketCategory": {
      find: () => ({
        select: async () => [{ _id: "ai", title: "AI", description: "match" }],
      }),
    },
    "@/prompts/ticketCategory": () => ({ system: "", user: "" }),
    "@/prompts/ticketGuide": "",
    "./attachmentExtractor": {
      collectAttachments: () => [],
      extractAttachments: async () => ({ images: [], documents: [] }),
    },
    "./knowledgeBaseContext": {
      collectRelevantNotes: async () => [],
      buildKnowledgeContext: () => "",
    },
    "./aiErrors": { humanizeAiError: (e) => e.message },
    "./ticketQuestionnaire": { formatAnswer: String, hasAnswer: () => false },
    "node:crypto": { randomUUID },
  };
  return { row, deps };
}

test("AI category and title never overwrite edits made during generation", async () => {
  const { row, deps } = fixture();
  deps["./aiService"] = {
    generateJson: async () => {
      row.categoryId = "human";
      row.title = "Human title";
      return { data: { categoryId: "ai", title: "AI title" } };
    },
  };
  await load("ticketCategoryService.js", deps).detectTicketCategory("t");
  assert.equal(row.categoryId, "human");
  assert.equal(row.title, "Human title");
});

for (const failOld of [false, true])
  test(`expired guide run cannot overwrite replacement (${failOld ? "error" : "success"})`, async () => {
    const { row, deps } = fixture();
    let finish;
    let calls = 0;
    const first = new Promise((resolve, reject) => {
      finish = failOld
        ? () => reject(new Error("old failed"))
        : () => resolve({ data: { summary: "old", items: [] } });
    });
    deps["./aiService"] = {
      generateJson: async () =>
        ++calls === 1 ? first : { data: { summary: "new", items: [] } },
    };
    const service = load("ticketAiGuide.js", deps);
    const older = service.generateTicketAiGuide("t");
    await new Promise(setImmediate);
    row.aiGuide.startedAt = new Date(0);
    await service.generateTicketAiGuide("t");
    finish();
    await older;
    assert.equal(row.aiGuide.summary, "new");
    assert.equal(row.aiGuide.status, "ready");
  });

test("two simultaneous guide requests issue only one provider call", async () => {
  const { deps } = fixture();
  let finish;
  let calls = 0;
  deps["./aiService"] = {
    generateJson: () => {
      calls++;
      return new Promise((resolve) => {
        finish = () => resolve({ data: { summary: "one", items: [] } });
      });
    },
  };
  const service = load("ticketAiGuide.js", deps);
  const first = service.generateTicketAiGuide("t");
  await new Promise(setImmediate);
  const second = service.generateTicketAiGuide("t");
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  finish();
  await Promise.all([first, second]);
});

test("guide vision fallback shares the original deadline", async () => {
  const { deps } = fixture();
  deps["./attachmentExtractor"].extractAttachments = async () => ({
    images: [{ data: "image" }],
    documents: [],
  });
  const signals = [];
  deps["./aiService"] = {
    generateJson: async ({ signal }) => {
      signals.push(signal);
      if (signals.length === 1) throw new Error("vision unsupported");
      return { data: { summary: "text fallback", items: [] } };
    },
  };
  await load("ticketAiGuide.js", deps).generateTicketAiGuide("t");
  assert.equal(signals.length, 2);
  assert.ok(signals[0] instanceof AbortSignal);
  assert.equal(signals[1], signals[0]);
});

test("a stale read cannot expire a replacement guide claim", async () => {
  const { row, deps } = fixture();
  row.aiGuide = { status: "pending", startedAt: new Date(0), runId: "old" };
  const snapshot = structuredClone(row);
  row.aiGuide = { status: "pending", startedAt: new Date(), runId: "new" };
  await load("ticketAiGuide.js", deps).expireStalePendingGuide(snapshot);
  assert.equal(row.aiGuide.status, "pending");
  assert.equal(row.aiGuide.runId, "new");
});
