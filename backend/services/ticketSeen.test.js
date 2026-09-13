// node --test services/ticketSeen.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { shouldBumpActivity } = require("./ticketSeen");

// Заглушка документа Mongoose: только то, что читает предикат
const doc = ({ isNew = false, modified = [], pending } = {}) => ({
  isNew,
  notifications: { lastAction: "process ticket", pending },
  isModified: (path) => modified.includes(path),
});

test("новая заявка — движение", () => {
  assert.equal(shouldBumpActivity(doc({ isNew: true, pending: true })), true);
});

test("событие жизненного цикла (notifications переприсвоены целиком) — движение", () => {
  assert.equal(
    shouldBumpActivity(
      doc({
        modified: ["notifications", "notifications.lastAction", "notifications.pending"],
        pending: true,
      }),
    ),
    true,
  );
});

test("то же событие подряд: изменился только pending → true — движение", () => {
  assert.equal(
    shouldBumpActivity(doc({ modified: ["notifications.pending"], pending: true })),
    true,
  );
});

test("крон снял pending — не движение", () => {
  assert.equal(
    shouldBumpActivity(doc({ modified: ["notifications.pending"], pending: false })),
    false,
  );
});

test("правка без события (чек-лист, ИИ, защёлка уведомлений) — не движение", () => {
  assert.equal(
    shouldBumpActivity(
      doc({ modified: ["checklist", "aiGuide", "responsibles"], pending: false }),
    ),
    false,
  );
});

const { latestByTicket } = require("./ticketSeen");

test("прочитанные уведомления дают водяной знак заявки — время последнего из них", () => {
  const map = latestByTicket([
    { ticketId: "t1", createdAt: "2026-09-12T10:00:00Z" },
    { ticketId: "t1", createdAt: "2026-09-12T12:00:00Z" },
    { ticketId: "t2", createdAt: new Date("2026-09-12T09:00:00Z") },
    { ticketId: null, createdAt: "2026-09-12T13:00:00Z" }, // отсутствие — не заявка
  ]);
  assert.deepEqual(
    [...map.entries()].map(([id, at]) => [id, at.toISOString()]),
    [
      ["t1", "2026-09-12T12:00:00.000Z"],
      ["t2", "2026-09-12T09:00:00.000Z"],
    ],
  );
});

test("пустой список уведомлений — пустая карта", () => {
  assert.equal(latestByTicket([]).size, 0);
});
