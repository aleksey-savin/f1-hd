// node --test services/mcp/ticketSource.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { Types } = require("mongoose");

/**
 * Модели подменены через require.cache — тот же приём, что и в
 * knowledgeNoteBackgroundWrites.test.js (там так же подменён logger до
 * загрузки кода под тестом), только тут это сами модели. Файлы моделей не
 * читаются и не выполняются вовсе: тест не ходит в MongoDB и не запускает
 * initCounter() модели заявок (models/ticket.js вызывает его на верхнем
 * уровне файла — без подключения к базе это ~10 c зависания на буферизации
 * и строка «Failed to initialize counter» в выводе). Настоящие запросы к
 * настоящим моделям проверяются вживую на дев-стенде (task-11).
 *
 * models/ticket.js экспортирует объект { Ticket, ... }, а не саму модель —
 * заглушка повторяет эту форму нарочно: у испорченного `const Ticket =
 * require(...)` (без деструктуризации) `Ticket.find` останется undefined
 * ровно как при настоящем баге, который эти тесты ловят.
 */

// Запрос-заглушка: цепочка select/sort/skip/limit/populate/lean и await → rows.
// Аргументы select/populate запоминаем в записи вызова — проекция полей и есть
// граница безопасности, и тесты ниже пинят её строками.
const fakeModel = (rows = []) => {
  const calls = [];
  const query = (method, args) => {
    const call = { method, args };
    calls.push(call);
    const chain = {
      select: (fields) => { call.select = fields; return chain; },
      populate: (value) => { call.populate = value; return chain; },
      sort: () => chain, skip: () => chain, limit: () => chain, lean: () => chain,
      then: (resolve, reject) => {
        if (method === "countDocuments") return Promise.resolve(rows.length).then(resolve, reject);
        if (method === "findOne") return Promise.resolve(rows[0] || null).then(resolve, reject);
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return chain;
  };
  return {
    calls,
    find: (...args) => query("find", args),
    findOne: (...args) => query("findOne", args),
    countDocuments: (...args) => query("countDocuments", args),
  };
};

// Подмена модуля в require.cache до первого require(path): файл модели не
// компилируется и не выполняется — initCounter() и подобные эффекты верхнего
// уровня не запускаются никогда.
const stubModule = (path, exportsValue) => {
  const resolved = require.resolve(path);
  const stub = new Module(resolved);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = exportsValue;
  require.cache[resolved] = stub;
};

// Ticket — единственная модель, чьё содержимое тест проверяет (регресс бага
// 1); у остальных форма не важна, лишь бы require() не упал и не ушёл в базу.
const ticketRows = [];
const ticketModel = fakeModel(ticketRows);
stubModule("@/models/ticket", { Ticket: ticketModel, ticketDefaultFieldsSchema: {}, initializeCounter: async () => {} });
const commentModel = fakeModel();
const workModel = fakeModel();
const deviceModel = fakeModel();
stubModule("@/models/comment", commentModel);
stubModule("@/models/work", workModel);
stubModule("@/models/user", fakeModel());
stubModule("@/models/company", fakeModel());
stubModule("@/models/ticketCategory", fakeModel());
stubModule("@/models/inventory/clientDevice", deviceModel);
stubModule("@/models/inventory/deviceModel", {});
stubModule("@/models/inventory/vendor", {});
stubModule("@/models/inventory/deviceType", {});
stubModule("@/models/routineTask", {});

const ticketSource = require("./ticketSource");

// Проводка (регресс бага 1 — `const Ticket = require(...)` без
// деструктуризации): findTickets/countTickets/loadStatsRows обязаны звать
// методы ИМЕННО на Ticket-заглушке с тем же фильтром и отдавать её данные.
test("findTickets calls Ticket.find with the filter and resolves to the fake rows", async () => {
  ticketRows.length = 0;
  ticketRows.push({ num: 1 }, { num: 2 });
  ticketModel.calls.length = 0;
  const filter = { isClosed: true };

  const result = await ticketSource.findTickets(filter, { sort: { createdAt: -1 }, skip: 5, limit: 10 });

  assert.deepEqual(result, ticketRows);
  assert.equal(ticketModel.calls.length, 1);
  assert.equal(ticketModel.calls[0].method, "find");
  assert.deepEqual(ticketModel.calls[0].args, [filter]);
});

test("countTickets calls Ticket.countDocuments with the filter and resolves to the fake count", async () => {
  ticketRows.length = 0;
  ticketRows.push({}, {}, {});
  ticketModel.calls.length = 0;
  const filter = { isClosed: false };

  const result = await ticketSource.countTickets(filter);

  assert.equal(result, 3);
  assert.equal(ticketModel.calls.length, 1);
  assert.equal(ticketModel.calls[0].method, "countDocuments");
  assert.deepEqual(ticketModel.calls[0].args, [filter]);
});

test("loadStatsRows calls Ticket.find with the filter and resolves to the fake rows", async () => {
  ticketRows.length = 0;
  ticketRows.push({ categoryId: "c1" });
  ticketModel.calls.length = 0;
  const filter = { "company._id": "x" };

  const result = await ticketSource.loadStatsRows(filter);

  assert.deepEqual(result, ticketRows);
  assert.equal(ticketModel.calls.length, 1);
  assert.equal(ticketModel.calls[0].method, "find");
  assert.deepEqual(ticketModel.calls[0].args, [filter]);
});

// Регресс бага 2: ~половина комментариев на деве/проде хранит createdBy
// старым денормализованным снимком {_id, firstName, lastName} вместо
// ObjectId-ссылки — схема с тех пор ObjectId-ref, но старые документы
// задним числом не переписаны (task-11: "unknown person" вместо имени
// автора у ticket #33948 и ~6865 из 14000 комментариев на деве).
test("authorId reads a real ObjectId as its hex string", () => {
  const id = new Types.ObjectId();
  assert.equal(ticketSource.authorId(id), id.toString());
});

test("authorId reads a plain string id as-is", () => {
  assert.equal(ticketSource.authorId("62d757ca240f9fa56455365b"), "62d757ca240f9fa56455365b");
});

test("authorId reads an ObjectId _id out of a legacy embedded snapshot", () => {
  const id = new Types.ObjectId();
  const legacy = { _id: id, firstName: "Елена", lastName: "Шароха" };
  assert.equal(ticketSource.authorId(legacy), id.toString());
});

test("authorId reads a string _id out of a legacy embedded snapshot", () => {
  const legacy = { _id: "62d757ca240f9fa56455365b", firstName: "Елена", lastName: "Шароха" };
  assert.equal(ticketSource.authorId(legacy), "62d757ca240f9fa56455365b");
});

test("authorId of an empty value is null", () => {
  assert.equal(ticketSource.authorId(null), null);
  assert.equal(ticketSource.authorId(undefined), null);
  assert.equal(ticketSource.authorId(""), null);
});

// Список полей — настоящая граница безопасности (spec: «Never select»), а
// пинил его до сих пор только текст в доках. Здесь он зафиксирован строками:
// лишнее поле в select() уронит тест, а не уедет агенту.
const SEARCH_SELECT = "num title description source state isClosed categoryId company applicantId createdAt finishedAt closingComment";
const DETAIL_SELECT = `${SEARCH_SELECT} processedAt startedAt deadline routineTask relatedClientDeviceId comments responsibles._id responsibles.firstName responsibles.lastName customFields.name customFields.type customFields.value checklist.description checklist.checked`;
const COMMENT_SELECT = "content createdBy createdAt";
const WORK_SELECT = "description visitRequired startedAt finishedAt finishedBy._id finishedBy.firstName finishedBy.lastName executor._id executor.firstName executor.lastName";
const DEVICE_SELECT = "deviceModelId deviceTypeId serialNumber inventoryNumber status operatingSystem";
const STATS_SELECT = "categoryId company._id applicantId source createdAt finishedAt isClosed";

// «applicant » с пробелом — легаси-поле заявки; «applicantId» разрешён
const FORBIDDEN = ["htmlDescription", "realSender", "attachments", "applicant "];

const assertSelect = (call, expected, label) => {
  assert.equal(call.select, expected, label);
  for (const field of FORBIDDEN) {
    assert.ok(!` ${call.select} `.includes(field), `${label} selects ${field}`);
  }
};

test("findTickets and loadStatsRows ask only for the allowed ticket fields", async () => {
  ticketRows.length = 0;
  ticketModel.calls.length = 0;

  await ticketSource.findTickets({});
  await ticketSource.loadStatsRows({});

  assertSelect(ticketModel.calls[0], SEARCH_SELECT, "findTickets");
  assertSelect(ticketModel.calls[1], STATS_SELECT, "loadStatsRows");
});

test("loadTicketDetail pins the ticket, comment, work and device projections", async () => {
  ticketRows.length = 0;
  ticketRows.push({ _id: "t1", num: 1, comments: [], relatedClientDeviceId: "d1" });
  ticketModel.calls.length = 0;
  commentModel.calls.length = 0;
  workModel.calls.length = 0;
  deviceModel.calls.length = 0;

  await ticketSource.loadTicketDetail(1, { works: true, devices: true, applicantIsSystem: () => false });

  assertSelect(ticketModel.calls[0], DETAIL_SELECT, "loadTicketDetail");
  assertSelect(commentModel.calls[0], COMMENT_SELECT, "comments");
  assertSelect(workModel.calls[0], WORK_SELECT, "works");
  assertSelect(deviceModel.calls[0], DEVICE_SELECT, "devices");
  // у техники подтягиваются только названия модели, вендора и типа
  assert.deepEqual(
    deviceModel.calls[0].populate.map((item) => [item.path, item.select]),
    [["deviceModelId", "name vendorId deviceTypeId"], ["deviceTypeId", "name"]],
  );
});

test("loadWorkDescriptions asks only for the description and the ticket ids", async () => {
  workModel.calls.length = 0;

  await ticketSource.loadWorkDescriptions(["t1"]);

  assertSelect(workModel.calls[0], "description tickets", "loadWorkDescriptions");
});
