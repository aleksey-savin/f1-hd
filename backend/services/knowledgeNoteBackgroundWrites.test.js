// node --test services/knowledgeNoteBackgroundWrites.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { Types } = require("mongoose");

/**
 * Фоновые проходы по заметкам базы знаний не должны трогать `updatedAt`.
 *
 * Mongoose по умолчанию ставит метку времени в каждый `bulkWrite` и
 * `updateMany`. Почасовой скан секретов переписывал так «Обновлено» у всех
 * заметок разом: 17.09.2026 у всех 172 заметок дева стояло время последнего
 * прохода, и список базы знаний, сортировка связанных заметок в заявке и
 * даты в строках показывали не правки людей, а работу крона.
 *
 * Запросы к базе подменены на уровне драйвера (коллекции): приведение типов и
 * расстановка меток — настоящие, Mongoose, проверяется то, что ушло бы в базу.
 */

// Файловый логгер не открывается на хосте (logs/ принадлежит root) — модуль
// подменяется до загрузки задач.
const loggerPath = require.resolve("../utils/logger");
const loggerStub = new Module(loggerPath);
loggerStub.filename = loggerPath;
loggerStub.loaded = true;
loggerStub.exports = {
  log: () => {},
  logDirect: () => {},
  addNoAuthContext: () => ({ log: () => {} }),
  addContext: async () => ({ log: () => {} }),
};
require.cache[loggerPath] = loggerStub;

const KnowledgeNote = require("../models/knowledgeNote");
const Preferences = require("../models/preferences");
const { runSecretsScan } = require("./secretsScanRun");
const { runServiceExpiryScan } = require("./serviceExpiryScanRun");
const { runKnowledgeApprovalExpiry } = require("./knowledgeApprovalExpiry");

const leanQuery = (value) => ({ lean: async () => value });

const withPreferences = (t, knowledgeBase) =>
  t.mock.method(Preferences, "findOne", () => leanQuery({ knowledgeBase }));

const captureBulkWrite = (t) => {
  const calls = [];
  t.mock.method(KnowledgeNote.collection, "bulkWrite", async (ops, options) => {
    calls.push({ ops, options });
    return { acknowledged: true, matchedCount: ops.length, modifiedCount: ops.length };
  });
  return calls;
};

const note = (n, fields) => ({ _id: new Types.ObjectId(`64f2${String(n).padStart(20, "0")}`), ...fields });

test("hourly secrets scan does not stamp updatedAt", async (t) => {
  withPreferences(t, { scanForSecrets: true });
  t.mock.method(KnowledgeNote, "find", () =>
    leanQuery([
      note(1, { title: "Роутер", plainText: "пароль: R00tP@ss123", secretsScan: { ignoredHashes: [] } }),
      note(2, { title: "Отпуск", plainText: "Заявление за две недели" }),
    ]),
  );
  const calls = captureBulkWrite(t);

  await runSecretsScan();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].ops.length, 2);
  assert.ok(calls[0].ops.every((op) => op.updateOne.update.$set["secretsScan.scannedAt"]));
  assert.doesNotMatch(JSON.stringify(calls[0].ops), /updatedAt/);
});

test("daily service-expiry scan does not stamp updatedAt", async (t) => {
  withPreferences(t, { trackServiceExpiry: true });
  t.mock.method(KnowledgeNote, "find", () =>
    leanQuery([note(3, { content: "| Услуга | Продление |\n|---|---|\n| example.ru | 01.12.2026 |" })]),
  );
  const calls = captureBulkWrite(t);

  await runServiceExpiryScan();

  assert.equal(calls.length, 1);
  assert.ok(calls[0].ops[0].updateOne.update.$set["serviceExpiry.scannedAt"]);
  assert.doesNotMatch(JSON.stringify(calls[0].ops), /updatedAt/);
});

test("approval expiry does not stamp updatedAt", async (t) => {
  withPreferences(t, { approvalPeriodDays: 180 });
  const calls = [];
  t.mock.method(KnowledgeNote.collection, "updateMany", async (filter, update, options) => {
    calls.push({ filter, update, options });
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });

  await runKnowledgeApprovalExpiry();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].update.$set.approved, false);
  assert.doesNotMatch(JSON.stringify(calls[0].update), /updatedAt/);
});
