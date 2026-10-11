const test = require("node:test");
const assert = require("node:assert/strict");

const { rescanNoteDerived } = require("./knowledgeNoteDerived");
const { scanNote } = require("../services/secretsScanner");

const SECRET_TEXT = "password = R00tP@ss123";
const CLEAN_TEXT = "Обычный текст без секретов";

const makeNote = (text, extra = {}) => ({
  title: "Заметка",
  plainText: text,
  content: text,
  ...extra,
});

const off = { loadKbConfig: async () => ({ scanForSecrets: false }) };
const on = { loadKbConfig: async () => ({ scanForSecrets: true }) };

test("сканирование выключено, заметка человека: secretsScan не трогаем", async () => {
  const note = makeNote(SECRET_TEXT);
  await rescanNoteDerived(note, off);
  assert.equal(note.secretsScan, undefined);
});

test("сканирование выключено, заметка агента с секретом: флаг и находки", async () => {
  const note = makeNote(SECRET_TEXT, { agent: { keyId: "k1", keyName: "Агент" } });
  await rescanNoteDerived(note, off);
  assert.equal(note.secretsScan.flagged, true);
  assert.ok(note.secretsScan.findings.length >= 1);
  assert.ok(note.secretsScan.scannedAt instanceof Date);
});

test("сканирование выключено, заметка агента без секрета: не помечена", async () => {
  const note = makeNote(CLEAN_TEXT, { agent: { keyId: "k1", keyName: "Агент" } });
  await rescanNoteDerived(note, off);
  assert.equal(note.secretsScan.flagged, false);
  assert.deepEqual(note.secretsScan.findings, []);
});

test("заметка агента: ignoredHashes сохраняются и гасят находку", async () => {
  const hash = scanNote(makeNote(SECRET_TEXT))[0].hash;
  const note = makeNote(SECRET_TEXT, {
    agent: { keyId: "k1", keyName: "Агент" },
    secretsScan: { ignoredHashes: [hash] },
  });
  await rescanNoteDerived(note, off);
  assert.equal(note.secretsScan.flagged, false);
  assert.deepEqual(note.secretsScan.ignoredHashes, [hash]);
});

test("сканирование включено, заметка человека: помечена (прежнее поведение)", async () => {
  const note = makeNote(SECRET_TEXT);
  await rescanNoteDerived(note, on);
  assert.equal(note.secretsScan.flagged, true);
});

test("метка агента без keyId — заметка человека, не трогаем", async () => {
  const note = makeNote(SECRET_TEXT, { agent: {} });
  await rescanNoteDerived(note, off);
  assert.equal(note.secretsScan, undefined);
});

// Пометки портала ([скрыто], [e-mail] …) в заметке агента — не секрет: скан видит
// ту же копию без пометок, что и инструмент записи (services/portalMarkers.js).
const MARKED_TEXT = "Доступ: password: [скрыто], логин: [e-mail]";
const AGENT = { agent: { keyId: "k1", keyName: "Агент" } };

test("заметка агента с пометками портала: не помечена", async () => {
  const note = makeNote(MARKED_TEXT, AGENT);
  await rescanNoteDerived(note, off);
  assert.equal(note.secretsScan.flagged, false);
  assert.deepEqual(note.secretsScan.findings, []);
  assert.equal(note.plainText, MARKED_TEXT); // сам текст не меняется
});

test("заметка человека с теми же пометками: как раньше, помечена", async () => {
  const note = makeNote(MARKED_TEXT);
  await rescanNoteDerived(note, on);
  assert.equal(note.secretsScan.flagged, true);
  assert.deepEqual(
    note.secretsScan.findings.map((finding) => [finding.category, finding.location, finding.maskedSnippet]),
    [
      ["generic-api-key", "content", "[скр•то],"],
      ["generic-api-key", "content", "[•••••••"],
    ],
  );
});

test("заметка агента: значение, приклеенное к пометке, помечено", async () => {
  const note = makeNote("password: [скрыто]R00tP@ss123", AGENT);
  await rescanNoteDerived(note, off);
  assert.equal(note.secretsScan.flagged, true);
});

test("заметка агента: пометка в заголовке не помечена, ignoredHashes на месте", async () => {
  const note = makeNote(CLEAN_TEXT, { ...AGENT, title: "Роутер: password: [скрыто]",secretsScan: { ignoredHashes: ["abc"] } });
  await rescanNoteDerived(note, off);
  assert.equal(note.secretsScan.flagged, false);
  assert.deepEqual(note.secretsScan.ignoredHashes, ["abc"]);
});
