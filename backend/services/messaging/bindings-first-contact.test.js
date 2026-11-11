require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const sift = require("sift").default;
const stub = (path, exports) => {
  const id = require.resolve(path), entry = new Module(id);
  Object.assign(entry, { filename: id, loaded: true, exports }); require.cache[id] = entry;
};
let live, lines = 0;
stub("@/models/conversation", { updateOne: async (filter, update) => {
  if (!sift(filter)(live)) return { matchedCount: 0 };
  Object.assign(live, update.$set); return { matchedCount: 1 };
} });
stub("@/services/pulse", { bus: { bump() {} } });
stub("./conversationStore", { addSystemLine: async () => { lines++; }, userTalksHere: async () => false });
const { bindConversation } = require("./bindings");
test("first-contact auto-bind cannot overwrite a newer foreign binding even with a stale conversation snapshot", async () => {
  const snapshot = { _id: "chat", binding: {} };
  live = { _id: "chat", binding: { ticketId: "another-ticket", endedAt: null } };
  const result = await bindConversation({ conversation: snapshot, ticket: { _id: "this-ticket", num: 42 }, onlyIfUnbound: true, attachPending: false });
  assert.equal(result, false);
  assert.equal(live.binding.ticketId, "another-ticket");
  assert.equal(lines, 0);
  live.binding.endedAt = new Date();
  await bindConversation({ conversation: snapshot, ticket: { _id: "this-ticket", num: 42 }, onlyIfUnbound: true, attachPending: false });
  assert.equal(live.binding.ticketId, "this-ticket");
  assert.equal(lines, 1);
});
