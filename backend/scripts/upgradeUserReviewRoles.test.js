require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { upgradeUserReviewRoles } = require("./upgradeUserReviewRoles");
const { staffAccessStatements } = require("../auth/access");
test("review migration upgrades previous full roles once and leaves restricted administrators untouched", async () => {
  const full = staffAccessStatements();
  delete full.userReview;
  const rows = [
    { _id: "null", role: "malformed", permission: "null" },
    { _id: "1", role: "full", permission: JSON.stringify(full) },
    {
      _id: "2",
      role: "restricted",
      permission: JSON.stringify({
        user: ["manageAccess", "manage"],
        settings: ["manage"],
        role: ["manage"],
      }),
    },
    {
      _id: "3",
      role: "client",
      audience: "client",
      permission: JSON.stringify(full),
    },
  ];
  const writes = [];
  const db = {
    collection: () => ({
      find: () => ({ toArray: async () => rows }),
      updateOne: async (q, u) => {
        const row = rows.find((r) => r._id === q._id);
        row.permission = u.$set.permission;
        writes.push(row.role);
        return { matchedCount: 1 };
      },
    }),
  };
  assert.deepEqual(await upgradeUserReviewRoles(db, "org"), ["full"]);
  assert.deepEqual(writes, []);
  assert.deepEqual(await upgradeUserReviewRoles(db, "org", { apply: true }), [
    "full",
  ]);
  assert.deepEqual(writes, ["full"]);
  assert.deepEqual(
    await upgradeUserReviewRoles(db, "org", { apply: true }),
    [],
  );
  assert.deepEqual(writes, ["full"]);
});
