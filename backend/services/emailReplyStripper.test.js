// node --test services/emailReplyStripper.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  TICKET_SUBJECT_PREFIX,
  ticketSubjectTag,
  ticketNumFromSubject,
} = require("./emailReplyStripper");

test("the tag is built from the one prefix and parses back", () => {
  assert.equal(TICKET_SUBJECT_PREFIX, "F1-HD");
  assert.equal(ticketSubjectTag(51713), "[F1-HD-51713]");
  assert.equal(
    ticketNumFromSubject(
      `${ticketSubjectTag(51713)} Новый комментарий к Заявке 51713`,
    ),
    51713,
  );
});

test("replies and forwards keep the ticket number", () => {
  assert.equal(ticketNumFromSubject("Re: [F1-HD-45926] x"), 45926);
  assert.equal(
    ticketNumFromSubject("RE: Fwd: [F1-HD-57056] Не удаётся сформировать отчёт"),
    57056,
  );
  assert.equal(ticketNumFromSubject("[F1-HD-45926]"), 45926);
});

test("the first tag wins", () => {
  // Новая заявка из не принятого ответа хранит его тему — старая метка
  // стоит в уведомлениях после её собственной
  assert.equal(
    ticketNumFromSubject(
      "[F1-HD-60001] Заявка 60001 принята в работу. Re: [F1-HD-45926] x",
    ),
    60001,
  );
});

test("foreign tags and malformed numbers address no ticket", () => {
  for (const subject of [
    // прежний разбор брал любое «-<что угодно>]»: 123, 50123, 1000, 31
    "[JIRA-123] build",
    "Счёт [PO-50123]",
    "[ABC-1e3]",
    "[F1-HD-0x1F]",
    "[F1-HD-1e3]",
    "[F1-HD-]",
    "[F1-HD- 12]",
    "[F1-HD-12 ]",
    "[F1-HD-12a]",
    "[F1-HD--12]",
    "[f1-hd-12]",
    "F1-HD-12",
    "[XF1-HD-12]",
    "[F1-HD-99999999999999999999]",
    "",
    null,
    undefined,
  ]) {
    assert.equal(ticketNumFromSubject(subject), null, String(subject));
  }
});

test("ticket notifications take their tag from ticketSubjectTag", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../middleware/notifications.js"),
    "utf8",
  );
  // Префикс станет настройкой (W2): зашитая в тему метка отстала бы от разбора
  assert.equal(
    source.includes("F1-HD"),
    false,
    "notifications.js: метка идёт через ticketSubjectTag, не литералом",
  );
  const tagged =
    source.match(/title:\s*`\$\{ticketSubjectTag\([^)]*\)\}/g) || [];
  assert.ok(tagged.length >= 14, `тем с ticketSubjectTag: ${tagged.length}, нужно 14`);
  assert.ok(
    tagged.every((tag) => tag.includes("ticketSubjectTag(ticket.num)")),
    "метка строится от номера заявки (ticket.num)",
  );
  assert.doesNotMatch(source, /title:\s*`\[/, "тема с меткой, собранной вручную");
  assert.match(
    source,
    /const \{ ticketSubjectTag \} = require\("\.\.\/services\/emailReplyStripper"\);/,
    "ticketSubjectTag не импортирован",
  );
});

test("the number must be a safe integer, to the last unit", () => {
  assert.equal(ticketNumFromSubject("[F1-HD-9007199254740991]"), 9007199254740991);
  assert.equal(ticketNumFromSubject("[F1-HD-9007199254740992]"), null);
});
