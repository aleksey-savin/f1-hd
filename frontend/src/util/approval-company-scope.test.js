import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeApprovalPipeline } from "./approval-company-scope.ts";

test("company slice filters reports and previews and counts only the selected company", () => {
  const data = {
    scope: { kind: "all" },
    stages: { approved: { count: 99, total: 999, oldestDays: 99 } },
    preview: [
      { company: { _id: "c1" }, total: 10, unrelatedWorksCount: 0 },
      { company: { _id: "c2" }, total: 200, unrelatedWorksCount: 0 },
    ],
    reports: [
      { company: { _id: "c1" }, status: "approved", total: 20 },
      { company: { _id: "c1" }, status: "paid", total: 30 },
      { company: { _id: "c2" }, status: "approved", total: 900 },
    ],
  };
  const result = scopeApprovalPipeline(data, "c1");
  assert.equal(result.preview.length, 1);
  assert.equal(result.reports.length, 2);
  assert.deepEqual(result.stages.approved, { count: 1, total: 20 });
  assert.equal(result.stages.paid.count, 1);
  assert.equal(result.stages.preview.total, 10);
  assert.equal(scopeApprovalPipeline(data, ""), data);
  assert.equal(scopeApprovalPipeline(null, "c1"), null);
});
