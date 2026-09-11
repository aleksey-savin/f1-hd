const test = require("node:test");
const assert = require("node:assert/strict");

const { isMachineMail } = require("./machineMail");

/** Письмо так, как его отдаёт mailparser: заголовки — Map с ключами в нижнем. */
const mail = (entries = {}) => ({ headers: new Map(Object.entries(entries)) });

test("живое письмо роботом не считается", () => {
  assert.equal(isMachineMail(mail()), false);
  assert.equal(
    isMachineMail(
      mail({
        subject: "Re: [F1-HD-57056] Не удаётся сформировать отчёт",
        "return-path": { text: "<olga@clinic.ru>" },
        // Outlook ставит его на обычных письмах — в роботы за это не берём
        "x-auto-response-suppress": "OOF",
      }),
    ),
    false,
  );
});

test("Auto-Submitted: no — это явное «писал человек»", () => {
  assert.equal(isMachineMail(mail({ "auto-submitted": "no" })), false);
});

test("автоответ по RFC 3834", () => {
  assert.equal(isMachineMail(mail({ "auto-submitted": "auto-replied" })), true);
  assert.equal(
    isMachineMail(mail({ "auto-submitted": "auto-generated" })),
    true,
  );
});

test("до-RFC-овские автоответчики", () => {
  assert.equal(isMachineMail(mail({ "x-autoreply": "yes" })), true);
  assert.equal(isMachineMail(mail({ "x-autorespond": "replied" })), true);
});

test("рассылки и автоматика по Precedence", () => {
  for (const value of ["bulk", "junk", "list", "auto_reply"]) {
    assert.equal(isMachineMail(mail({ precedence: value })), true, value);
  }
  // «normal» — обычное письмо
  assert.equal(isMachineMail(mail({ precedence: "normal" })), false);
});

test("письмо из списка рассылки", () => {
  assert.equal(isMachineMail(mail({ "list-id": "<news.example.com>" })), true);
  assert.equal(
    isMachineMail(mail({ "list-unsubscribe": "<mailto:off@example.com>" })),
    true,
  );
});

test("отбойник о недоставке: пустой конверт", () => {
  assert.equal(isMachineMail(mail({ "return-path": { text: "<>" } })), true);
  assert.equal(isMachineMail(mail({ "return-path": "<>" })), true);
});

test("письма без заголовков переживают проверку", () => {
  assert.equal(isMachineMail(null), false);
  assert.equal(isMachineMail({}), false);
  assert.equal(isMachineMail({ headers: {} }), false);
});
