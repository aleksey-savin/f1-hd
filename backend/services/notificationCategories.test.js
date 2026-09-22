// node --test services/notificationCategories.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CATEGORIES,
  parseCategories,
} = require("./notificationCategories");

test("каталог категорий — тот же, что в настройках уведомлений", () => {
  assert.deepEqual(CATEGORIES, [
    "newTicket",
    "respStateUpdate",
    "ticketStateUpdate",
    "ticketDeadlineUpdate",
    "ticketNewComment",
    "scheduledWorks",
    "absenceRequest",
    "absenceDecision",
    "reportApproval",
    "reportDecision",
  ]);
});

test("пусто — фильтра нет", () => {
  assert.equal(parseCategories(undefined), null);
  assert.equal(parseCategories(""), null);
  assert.equal(parseCategories([]), null);
});

test("строка через запятую и массив дают один и тот же список", () => {
  assert.deepEqual(parseCategories("ticketStateUpdate,respStateUpdate"), [
    "ticketStateUpdate",
    "respStateUpdate",
  ]);
  assert.deepEqual(parseCategories(["ticketNewComment"]), [
    "ticketNewComment",
  ]);
});

test("неизвестные категории отбрасываются, дубли схлопываются", () => {
  assert.deepEqual(parseCategories("newTicket, spam ,newTicket"), [
    "newTicket",
  ]);
  // Ничего допустимого — фильтра нет, а не пустая лента
  assert.equal(parseCategories("spam,eggs"), null);
});
