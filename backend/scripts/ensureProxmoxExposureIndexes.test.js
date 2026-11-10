const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureIndexes } = require("./ensureProxmoxExposureIndexes");
test("index migration is additive, repeatable and read-only without apply", async () => {
  const created = new Map();
  const db = {
    collection: (name) => ({
      createIndex: async (key, options) => {
        assert.equal(options.unique, true);
        created.set(name, key);
      },
    }),
  };
  await ensureIndexes(db);
  assert.equal(created.size, 0);
  await ensureIndexes(db, true);
  await ensureIndexes(db, true);
  assert.deepEqual(
    [...created.keys()],
    ["routerexposuresnapshots", "guestexposures"],
  );
});
