// node --test services/emailReplyStripper.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  TICKET_SUBJECT_PREFIX,
  ticketSubjectTag,
  ticketNumFromSubject,
  buildSubjectTagging,
} = require("./emailReplyStripper");

// Окружение тестов не трогаем: разбор собирается фабрикой с явным префиксом
const hd = buildSubjectTagging({ prefix: "HD" });
// Установка, сменившая префикс: старый остаётся принятым в ответах
const renamed = buildSubjectTagging({ prefix: "HD", accepted: ["OLD-HD"] });

const INVALID_PREFIX =
  "TICKET_SUBJECT_PREFIX: допустимы латиница, цифры и дефис, 2–12 знаков";

test("the tag is built from the one prefix and parses back", () => {
  assert.equal(hd.prefix, "HD");
  assert.equal(hd.tag(7), "[HD-7]");
  assert.equal(hd.numFromSubject("Re: [HD-7] x"), 7);
  assert.equal(
    hd.numFromSubject(`${hd.tag(51713)} Новый комментарий к Заявке 51713`),
    51713,
  );
});

test("the prefix defaults to HD", () => {
  assert.equal(buildSubjectTagging().prefix, "HD");
  assert.equal(buildSubjectTagging({}).tag(7), "[HD-7]");
  assert.equal(buildSubjectTagging({ accepted: ["OLD-HD"] }).prefix, "HD");
});

test("the module exports follow the configured prefix", () => {
  assert.match(TICKET_SUBJECT_PREFIX, /^[A-Za-z0-9-]{2,12}$/);
  assert.equal(ticketSubjectTag(51713), `[${TICKET_SUBJECT_PREFIX}-51713]`);
  assert.equal(
    ticketNumFromSubject(`Re: ${ticketSubjectTag(51713)} Новый комментарий`),
    51713,
  );
});

test("replies and forwards keep the ticket number", () => {
  assert.equal(hd.numFromSubject("Re: [HD-45926] x"), 45926);
  assert.equal(
    hd.numFromSubject("RE: Fwd: [HD-57056] Не удаётся сформировать отчёт"),
    57056,
  );
  assert.equal(hd.numFromSubject("[HD-45926]"), 45926);
});

test("a reply with the old prefix still addresses its ticket when accepted", () => {
  assert.equal(renamed.prefix, "HD");
  assert.equal(renamed.tag(51713), "[HD-51713]", "новые письма — с новым префиксом");
  assert.equal(renamed.numFromSubject("[OLD-HD-51713] тема"), 51713);
  assert.equal(renamed.numFromSubject("Re: [HD-51713] тема"), 51713);
  assert.equal(renamed.numFromSubject("[JIRA-5] x"), null);
  // Принятых может быть несколько; повтор основного в списке не мешает
  const several = buildSubjectTagging({ prefix: "HD", accepted: ["OLD-HD", "SD", "HD"] });
  assert.equal(several.numFromSubject("[SD-12] x"), 12);
  assert.equal(several.numFromSubject("[OLD-HD-13] x"), 13);
  assert.equal(several.numFromSubject("[HD-14] x"), 14);
});

test("an old prefix that is not accepted addresses no ticket", () => {
  // «HD» — хвост «OLD-HD»: выражение держится за «[», а не ищет префикс где попало
  assert.equal(hd.numFromSubject("[OLD-HD-9]"), null);
  assert.equal(hd.numFromSubject("Re: [OLD-HD-9] [XHD-9]"), null);
  // и наоборот: принятый длинный не открывает короткий
  const long = buildSubjectTagging({ prefix: "OLD-HD" });
  assert.equal(long.tag(9), "[OLD-HD-9]");
  assert.equal(long.numFromSubject("[OLD-HD-9]"), 9);
  assert.equal(long.numFromSubject("[HD-9]"), null);
});

test("the first tag wins", () => {
  // Новая заявка из не принятого ответа хранит его тему — старая метка
  // стоит в уведомлениях после её собственной
  assert.equal(
    hd.numFromSubject("[HD-60001] Заявка 60001 принята в работу. Re: [HD-45926] x"),
    60001,
  );
  // Первая по месту в теме, каким бы из принятых префиксов она ни была
  assert.equal(
    renamed.numFromSubject("[HD-60001] Заявка принята. Re: [OLD-HD-45926] x"),
    60001,
  );
  assert.equal(
    renamed.numFromSubject("[OLD-HD-45926] x. Fwd: [HD-60001] y"),
    45926,
  );
  // Чужая метка впереди не в счёт
  assert.equal(renamed.numFromSubject("[JIRA-5] Re: [OLD-HD-45926] x"), 45926);
});

test("foreign tags and malformed numbers address no ticket", () => {
  for (const subject of [
    // прежний разбор брал любое «-<что угодно>]»: 123, 50123, 1000, 31
    "[JIRA-123] build",
    "Счёт [PO-50123]",
    "[ABC-1e3]",
    "[HD-0x1F]",
    "[HD-1e3]",
    "[HD-]",
    "[HD- 5]",
    "[HD- 12]",
    "[HD-12 ]",
    "[HD-12a]",
    "[HD--5]",
    "[HD--12]",
    "[hd-12]",
    "HD-12",
    "[XHD-12]",
    "[HD-99999999999999999999]",
    "[OLD-HD--12]",
    "[old-hd-12]",
    "",
    null,
    undefined,
  ]) {
    assert.equal(hd.numFromSubject(subject), null, String(subject));
    assert.equal(renamed.numFromSubject(subject), null, String(subject));
  }
});

test("an invalid prefix is refused", () => {
  for (const prefix of ["", "A", "A B", "x".repeat(13), "A]", "HD.", "ХД", " HD", null, 12]) {
    assert.throws(
      () => buildSubjectTagging({ prefix }),
      { message: INVALID_PREFIX },
      JSON.stringify(prefix),
    );
  }
  // Граница длины: 2 и 12 знаков допустимы
  assert.equal(buildSubjectTagging({ prefix: "A1" }).tag(1), "[A1-1]");
  assert.equal(buildSubjectTagging({ prefix: "x".repeat(12) }).prefix, "x".repeat(12));
});

test("an invalid accepted prefix is refused too", () => {
  for (const bad of ["A", "A B", "x".repeat(13), "A]", ".*", ""]) {
    assert.throws(
      () => buildSubjectTagging({ prefix: "HD", accepted: [bad] }),
      /^Error: TICKET_SUBJECT_PREFIXES_ACCEPTED: допустимы латиница, цифры и дефис, 2–12 знаков$/,
      JSON.stringify(bad),
    );
  }
});

// Модуль читает окружение один раз при загрузке — проверяем отдельным процессом
const loadWithEnv = (env) => {
  const { TICKET_SUBJECT_PREFIX: _p, TICKET_SUBJECT_PREFIXES_ACCEPTED: _a, ...clean } =
    process.env;
  return spawnSync(
    process.execPath,
    [
      "-e",
      `const m = require(${JSON.stringify(path.join(__dirname, "emailReplyStripper.js"))});
       process.stdout.write(JSON.stringify([
         m.TICKET_SUBJECT_PREFIX,
         m.ticketSubjectTag(7),
         m.ticketNumFromSubject("Re: [OLD-HD-51713] x"),
         m.ticketNumFromSubject("[SD-3] x"),
       ]));`,
    ],
    { env: { ...clean, ...env }, encoding: "utf8" },
  );
};

test("the environment sets the prefix and the accepted list at load", () => {
  const byDefault = loadWithEnv({});
  assert.equal(byDefault.status, 0, byDefault.stderr);
  assert.deepEqual(JSON.parse(byDefault.stdout), ["HD", "[HD-7]", null, null]);

  const empty = loadWithEnv({ TICKET_SUBJECT_PREFIX: "", TICKET_SUBJECT_PREFIXES_ACCEPTED: "" });
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout), ["HD", "[HD-7]", null, null]);

  const configured = loadWithEnv({
    TICKET_SUBJECT_PREFIX: "DESK",
    TICKET_SUBJECT_PREFIXES_ACCEPTED: " OLD-HD , ,SD,",
  });
  assert.equal(configured.status, 0, configured.stderr);
  assert.deepEqual(JSON.parse(configured.stdout), ["DESK", "[DESK-7]", 51713, 3]);
});

test("an invalid value in the environment stops the start with a clear message", () => {
  const badPrefix = loadWithEnv({ TICKET_SUBJECT_PREFIX: "A B" });
  assert.notEqual(badPrefix.status, 0);
  assert.ok(badPrefix.stderr.includes(INVALID_PREFIX), badPrefix.stderr);

  const badAccepted = loadWithEnv({ TICKET_SUBJECT_PREFIXES_ACCEPTED: "OLD-HD,A]" });
  assert.notEqual(badAccepted.status, 0);
  assert.ok(
    badAccepted.stderr.includes("TICKET_SUBJECT_PREFIXES_ACCEPTED: допустимы"),
    badAccepted.stderr,
  );
});

test("ticket notifications take their tag from ticketSubjectTag", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../middleware/notifications.js"),
    "utf8",
  );
  // Префикс задаётся при установке: зашитая в тему метка отстала бы от разбора
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
  assert.equal(hd.numFromSubject("[HD-9007199254740991]"), 9007199254740991);
  assert.equal(hd.numFromSubject("[HD-9007199254740992]"), null);
  assert.equal(renamed.numFromSubject("[OLD-HD-9007199254740992]"), null);
});
