import test from "node:test";
import assert from "node:assert/strict";
import {
  nodeSecurityProgress,
  shouldClearBulkSelection,
} from "./fleet-presentation.js";
test("unavailable node security is a finished refusal, not a running scan", () => {
  assert.equal(
    nodeSecurityProgress({ status: "unavailable" }),
    "Проверка недоступна",
  );
  assert.equal(
    nodeSecurityProgress({ status: "checking" }),
    "Проверяем CVE и обновления",
  );
  assert.equal(
    nodeSecurityProgress({ status: "error" }),
    "Не удалось обновить проверку",
  );
  assert.equal(
    nodeSecurityProgress({ status: "partial", checkedAt: "2026-11-10" }),
    null,
  );
});
test("monitoring changes and errors do not discard a bulk company selection", () => {
  assert.equal(
    shouldClearBulkSelection({
      intent: "resourceMonitoring",
      item: { id: "vm" },
    }),
    false,
  );
  assert.equal(
    shouldClearBulkSelection({ intent: "bulkCompany", error: true }),
    false,
  );
  assert.equal(
    shouldClearBulkSelection({ intent: "bulkCompany", items: [] }),
    true,
  );
});
