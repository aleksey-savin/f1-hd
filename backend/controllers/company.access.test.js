// node --test controllers/company.access.test.js
require("module-alias/register");
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const mongoose = require("mongoose");

// Базы нет: запрос, который забыли подменить, должен падать сразу, а не висеть
// десять секунд в буфере до первого подключения
mongoose.set("bufferCommands", false);

/**
 * Модель заявок подменена в require.cache до загрузки контроллера:
 * models/ticket.js на верхнем уровне зовёт initCounter(), и без базы в выводе
 * остаётся «Failed to initialize counter» (тот же приём, что в
 * services/mcp/ticketSource.test.js). Отключение и удаление компании заявок не
 * касаются.
 */
const stubModule = (path, exportsValue) => {
  const resolved = require.resolve(path);
  const stub = new Module(resolved);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = exportsValue;
  require.cache[resolved] = stub;
};
stubModule("@/models/ticket", { Ticket: {} });

/**
 * Проверка последнего носителя права читает всё членство — в базу. Контроллер
 * забирает её деструктуризацией при загрузке, поэтому подмена стоит до
 * `require`. Вызовы пишутся в `calls`: по ним проверяется порядок.
 */
const calls = [];
const record =
  (name, result) =>
  async (...args) => {
    calls.push([name, ...args]);
    return result;
  };

let holderFailure = null;
const permissions = require("@/services/permissions");
permissions.organizationId = async () => "org-1";
const rolesService = require("@/services/roles");
rolesService.assertNoOrphanedStaffActions = async (...args) => {
  calls.push(["assertNoOrphanedStaffActions", ...args]);
  if (holderFailure) throw holderFailure;
};

const Company = require("@/models/company");
const User = require("@/models/user");
const Preferences = require("@/models/preferences");
const { AppError } = require("@/middleware/errorHandling");

const controller = require("./company");

const originals = {
  findById: Company.findById,
  deleteOne: Company.deleteOne,
  usersUpdateMany: User.updateMany,
  usersDeleteOne: User.deleteOne,
  prefsFindOne: Preferences.findOne,
};

afterEach(() => {
  Company.findById = originals.findById;
  Company.deleteOne = originals.deleteOne;
  User.updateMany = originals.usersUpdateMany;
  User.deleteOne = originals.usersDeleteOne;
  Preferences.findOne = originals.prefsFindOne;
  calls.length = 0;
  holderFailure = null;
});

const COMPANY_ID = "66bb00000000000000000001";
const OTHER_ID = "66bb00000000000000000002";

/** Компания в базе; `save()` и записи моделей пишутся в `calls`. */
const stored = (fields = {}) => {
  const doc = {
    _id: new mongoose.Types.ObjectId(COMPANY_ID),
    isActive: true,
    employees: [],
    ...fields,
    async save() {
      calls.push(["save"]);
      return this;
    },
  };
  Company.findById = async () => doc;
  Company.deleteOne = record("deleteCompany");
  User.updateMany = record("updateUsers");
  User.deleteOne = record("deleteUser");
  // Компания по умолчанию для входящих заявок — другая
  Preferences.findOne = async () => ({
    defaultCompany: { _id: new mongoose.Types.ObjectId(OTHER_ID) },
  });
  return doc;
};

const call = async (handler, { params }) => {
  let failure = null;
  let sent = null;
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      sent = { status: this.statusCode, payload };
      return this;
    },
  };
  await handler({ params, body: {} }, res, (error) => {
    failure = error;
  });
  return { failure, sent };
};

const steps = () => calls.map(([name]) => name);

/**
 * Правку, переданную проверке, тест применяет к своему состоянию. В нём
 * человек компании, человек из её списка `employees`, чья учётная запись
 * указывает на другую компанию (списки разошлись), и посторонний.
 */
const LISTED = "66aa00000000000000000004";
const HOLDERS = {
  accounts: [
    { id: "ours", companyId: COMPANY_ID, companyActive: true },
    { id: LISTED, companyId: OTHER_ID, companyActive: true },
    { id: "theirs", companyId: OTHER_ID, companyActive: true },
  ],
  catalogue: new Map(),
};
const holderTransform = () => {
  const [, orgId, transform] = calls.find(
    ([name]) => name === "assertNoOrphanedStaffActions",
  );
  assert.equal(orgId, "org-1");
  return transform;
};
const holderChange = () =>
  holderTransform()(HOLDERS).accounts.map((account) => [
    account.id,
    account.companyActive,
  ]);

const LAST_HOLDER =
  "После этого ни у кого не останется права «Изменять роли». Сначала выдайте его другому сотруднику.";

test("toggleActive: deactivating is checked before anything is written, activating is not", async () => {
  stored();
  const off = await call(controller.toggleActive, { params: { id: COMPANY_ID } });

  assert.equal(off.failure, null);
  assert.equal(off.sent.status, 200);
  assert.equal(off.sent.payload.isActive, false);
  assert.deepEqual(steps(), ["assertNoOrphanedStaffActions", "save", "updateUsers"]);
  // Отключение гасит тех, чья учётная запись указывает на компанию: снимок
  // `company.isActive` каскадится ровно им
  assert.deepEqual(holderChange(), [
    ["ours", false],
    [LISTED, true],
    ["theirs", true],
  ]);

  calls.length = 0;
  stored({ isActive: false });
  const on = await call(controller.toggleActive, { params: { id: COMPANY_ID } });
  assert.equal(on.failure, null);
  assert.equal(on.sent.payload.isActive, true);
  assert.deepEqual(steps(), ["save", "updateUsers"]);
});

test("toggleActive: the default-company refusal keeps its own answer", async () => {
  stored();
  Preferences.findOne = async () => ({
    defaultCompany: { _id: new mongoose.Types.ObjectId(COMPANY_ID) },
  });

  const { failure, sent } = await call(controller.toggleActive, {
    params: { id: COMPANY_ID },
  });

  assert.equal(failure, null);
  assert.equal(sent.status, 409);
  assert.match(sent.payload.message, /компанией по умолчанию/);
  assert.deepEqual(steps(), []);
});

test("toggleActive: a refused check answers 409, not 500, and the company stays active", async () => {
  holderFailure = new AppError(LAST_HOLDER, 409);
  const doc = stored();

  const { failure, sent } = await call(controller.toggleActive, {
    params: { id: COMPANY_ID },
  });

  assert.equal(failure?.statusCode, 409);
  assert.equal(failure.message, LAST_HOLDER);
  assert.equal(sent, null);
  assert.equal(doc.isActive, true);
  assert.deepEqual(steps(), ["assertNoOrphanedStaffActions"]);
});

test("delete: the check runs before anything is deleted, and a refusal is a 409", async () => {
  holderFailure = new AppError(LAST_HOLDER, 409);
  // `employees` — ссылки ObjectId, как в модели
  stored({ employees: [new mongoose.Types.ObjectId(LISTED)] });

  const refused = await call(controller.delete, { params: { id: COMPANY_ID } });
  assert.equal(refused.failure?.statusCode, 409);
  assert.equal(refused.failure.message, LAST_HOLDER);
  assert.equal(refused.sent, null);
  assert.deepEqual(steps(), ["assertNoOrphanedStaffActions"]);
  // Без носителей остаются все, кого удаление уносит: и список `employees`, и
  // учётные записи компании, которых в нём нет; посторонний остаётся
  assert.deepEqual(
    holderTransform()(HOLDERS).accounts.map((account) => account.id),
    ["theirs"],
  );

  // Проверка пропустила — люди и компания удаляются, как и прежде
  holderFailure = null;
  calls.length = 0;
  const done = await call(controller.delete, { params: { id: COMPANY_ID } });
  assert.equal(done.failure, null);
  assert.equal(done.sent.status, 204);
  assert.deepEqual(steps(), [
    "assertNoOrphanedStaffActions",
    "deleteUser",
    "deleteCompany",
  ]);
});
