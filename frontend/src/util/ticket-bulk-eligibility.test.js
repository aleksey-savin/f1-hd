import { test } from "node:test";
import assert from "node:assert/strict";
import { takeToWorkReason } from "./ticket-bulk-eligibility.js";

const context = (permissions) => ({
  userId: "u1",
  can: (request) => request.ticket.every((action) => permissions.includes(action)),
});
const fresh = { num: 1, state: "Новая", responsibles: [] };

test("take new and pending tickets together with join permission", () => {
  assert.equal(takeToWorkReason([fresh, { ...fresh, num: 2, state: "Не в работе" }], context(["join"])), null);
  assert.equal(takeToWorkReason([fresh], context(["manage"])), null);
});

test("new tickets still require assignment permission and closed tickets are excluded", () => {
  assert.match(takeToWorkReason([fresh], context([])), /назначенные на вас/);
  assert.match(takeToWorkReason([fresh, { ...fresh, num: 2, state: "Закрыта" }], context(["join"])), /#2/);
  assert.equal(takeToWorkReason([], context(["join"])), "Не выбрано ни одной заявки");
});
