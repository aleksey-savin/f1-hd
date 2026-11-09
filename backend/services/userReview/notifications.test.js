const { test } = require("node:test");
const assert = require("node:assert/strict");
const { notifyReviewSummary } = require("./notifications");
test("one consolidated daily summary reaches only staff with review and user management rights", async () => {
  const users = [
    { _id: "full", isEndUser: false },
    { _id: "readOnly", isEndUser: false },
    { _id: "client", isEndUser: true },
    { _id: "deleted", isEndUser: false, deletedAt: new Date() },
  ];
  const rows = [],
    stamps = {};
  const dependencies = {
    users,
    prefs: { notify: { personal: { userReview: true } } },
    at: new Date("2026-11-09T12:00:00Z"),
    readStamp: (id) => stamps[id],
    writeStamp: async (id, at) => {
      stamps[id] = at;
    },
    canFor: async (u) => (q) =>
      u._id !== "readOnly" || !q.userReview?.includes("manage"),
    readSummary: async () => ({ pending: 25 }),
    upsert: async (row) => rows.push(row),
  };
  await notifyReviewSummary(dependencies);
  await notifyReviewSummary(dependencies);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, "full");
  assert.equal(rows[0].link, "/users/review");
  assert.match(rows[0].text, /25/);
});
test("history scan never floods the notification inbox while backlog is being analyzed", async () => {
  let calls = 0;
  await notifyReviewSummary({
    historyRunning: true,
    users: [{ _id: "u" }],
    upsert: async () => calls++,
  });
  assert.equal(calls, 0);
});
