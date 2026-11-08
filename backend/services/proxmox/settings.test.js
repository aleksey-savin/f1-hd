const test = require("node:test");
const assert = require("node:assert/strict");
const { validateSettings, DEFAULTS } = require("./settings");
const applicantId = "64aa00000000000000000001",
  categoryId = "64aa00000000000000000002";
const valid = {
  accountExists: async () => true,
  categoryExists: async () => true,
};
test("partial threshold patch preserves ticket configuration and writes only supplied fields", async () => {
  const current = {
    ...DEFAULTS,
    cpuThreshold: 80,
    autoTickets: true,
    applicantId,
    categoryId,
    thresholdMinutes: 20,
  };
  const result = await validateSettings(
    { memoryThreshold: "92", isActive: true },
    current,
    valid,
  );
  assert.deepEqual(result.changes, { memoryThreshold: 92 });
  assert.equal(result.data.autoTickets, true);
  assert.equal(result.data.thresholdMinutes, 20);
  assert.equal(result.data.applicantId, applicantId);
  assert.equal(result.data.isActive, undefined);
});
test("storage thresholds are validated after merging partial request", async () => {
  await assert.rejects(
    validateSettings({ storageWarning: 96 }, { ...DEFAULTS }),
    /Критический порог/,
  );
  await assert.rejects(
    validateSettings({ storageCritical: 85 }, { ...DEFAULTS }),
    /Критический порог/,
  );
  assert.equal(
    (await validateSettings({ storageWarning: 92, storageCritical: 98 })).data
      .storageCritical,
    98,
  );
});
test("enabling tickets requires service account and active category", async () => {
  await assert.rejects(
    validateSettings({ autoTickets: true }),
    /Выберите сервисный/,
  );
  await assert.rejects(
    validateSettings(
      { autoTickets: true, applicantId, categoryId },
      {},
      { ...valid, accountExists: async () => false },
    ),
    /существующий сервисный/,
  );
  await assert.rejects(
    validateSettings(
      { autoTickets: true, applicantId, categoryId },
      {},
      { ...valid, categoryExists: async () => false },
    ),
    /действующую категорию/,
  );
  const result = await validateSettings(
    { autoTickets: true, applicantId, categoryId },
    {},
    valid,
  );
  assert.equal(result.data.autoTickets, true);
});
test("disabled automation can be cleared without stale references blocking other settings", async () => {
  const result = await validateSettings(
    { autoTickets: false, applicantId: null, categoryId: null },
    { ...DEFAULTS, autoTickets: true, applicantId, categoryId },
    {},
  );
  assert.equal(result.data.applicantId, null);
  assert.equal(
    (await validateSettings({ cpuThreshold: 91 }, { ...DEFAULTS, categoryId }))
      .data.cpuThreshold,
    91,
  );
});
test("malformed payloads and coercion traps are rejected", async () => {
  for (const patch of [
    null,
    [],
    { cpuThreshold: "" },
    { cpuThreshold: null },
    { cpuThreshold: true },
    { autoTickets: "false" },
    { thresholdMinutes: 1.5 },
    { thresholdMinutes: 0 },
    { applicantId: "not-id" },
  ])
    await assert.rejects(validateSettings(patch));
});
test("full disabled payload retains unchanged inactive references without hiding changed invalid references", async () => {
  let calls = 0;
  const missing = {
    accountExists: async () => {
      calls++;
      return false;
    },
    categoryExists: async () => {
      calls++;
      return false;
    },
  };
  const current = { ...DEFAULTS, applicantId, categoryId };
  const result = await validateSettings(
    { ...current, cpuThreshold: 88 },
    current,
    missing,
  );
  assert.equal(result.data.categoryId, categoryId);
  assert.equal(calls, 0);
  await assert.rejects(
    validateSettings(
      { categoryId: "64aa00000000000000000003" },
      current,
      missing,
    ),
    /действующую категорию/,
  );
});
