// node --test services/approvalActionResult.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { approvalActionResult } = require("./approvalActionResult");

/**
 * Действия с отчётом согласования отвечают `{ ok, id }`: документ отчёта несёт
 * персональные токены согласующих, и нажавший кнопку не должен их получить.
 */

// Модель-зонд: достаточно формы документа, к базе тест не подключается
const ReportProbe = mongoose.model(
  "ApprovalActionResultProbe",
  new mongoose.Schema({
    status: String,
    accessTokens: [{ token: String, userId: mongoose.Schema.Types.ObjectId }],
  }),
);

test("a report document becomes { ok, id } and nothing else", () => {
  const report = new ReportProbe({
    status: "pendingApproval",
    accessTokens: [
      { token: "sibling-branch-token", userId: new mongoose.Types.ObjectId() },
      { token: "final-approver-token", userId: new mongoose.Types.ObjectId() },
    ],
  });

  const result = approvalActionResult(report);

  assert.deepEqual(result, { ok: true, id: String(report._id) });
  assert.deepEqual(Object.keys(result), ["ok", "id"]);
});

test("no access token survives serialisation of the response", () => {
  const report = new ReportProbe({
    accessTokens: [{ token: "sibling-branch-token" }],
  });

  const wire = JSON.stringify(approvalActionResult(report));

  assert.doesNotMatch(wire, /token/i);
  assert.equal(JSON.parse(wire).id, String(report._id));
});

test("a plain object with an ObjectId works the same way", () => {
  const _id = new mongoose.Types.ObjectId();
  assert.deepEqual(approvalActionResult({ _id, accessTokens: [] }), {
    ok: true,
    id: String(_id),
  });
});
