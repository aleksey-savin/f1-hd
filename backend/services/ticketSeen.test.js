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
