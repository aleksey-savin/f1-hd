// node --test controllers/user.access.test.js
require("module-alias/register");
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// Базы нет: запрос, который забыли подменить, должен падать сразу, а не висеть
// десять секунд в буфере до первого подключения
mongoose.set("bufferCommands", false);

const User = require("@/models/user");
const Company = require("@/models/company");
const Subdivision = require("@/models/subdivision");
const TicketCategory = require("@/models/ticketCategory");
const Prefs = require("@/models/preferences");
const Location = require("@/models/inventory/location");
const Notification = require("@/models/notification");
const logger = require("@/utils/logger");
const { AppError } = require("@/middleware/errorHandling");
const {
  STAFF_ACTIONS,
  staffAccessStatements,
  actionsToStatements,
} = require("@/auth/access");
const { ACCOUNT_UPDATE_MESSAGES } = require("@/services/accountUpdatePolicy");

/**
 * Службы, что ходят в базу напрямую, контроллер забирает деструктуризацией при
 * ЗАГРУЗКЕ — подменять их позже поздно, поэтому подмена стоит до `require`.
 * Каждая пишет вызов в `calls`: по нему проверяется порядок (запись → сеансы →
 * письмо → роли), а не только то, что вызов был. Появится в `update` новая
 * служба доступа — подменить её здесь же.
 */
const calls = [];
const record =
  (name, result) =>
  async (...args) => {
    calls.push([name, ...args]);
    return result;
  };

// Отказ назначения ролей (400, 403, 409): тест задаёт его на один случай
let assignFailure = null;
// Отказ проверки последнего носителя права (409) — так же
let holderFailure = null;
// Состояние носителей, на котором проверка решает по-настоящему: правку,
// которую ей передал контроллер, применяют те же чистые функции
// (services/permissionHolders.js). Не задано — проверка пропускает
let holderState = null;
// Роли человека в членстве до правки
let currentRoles = [];

const permissions = require("@/services/permissions");
permissions.rolesOfUser = async () => currentRoles;
permissions.organizationId = async () => "org-1";
const rolesService = require("@/services/roles");
rolesService.ensureMember = record("ensureMember");
rolesService.assign = async (...args) => {
  calls.push(["assignRoles", ...args]);
  if (assignFailure) throw assignFailure;
};
rolesService.refreshMirrorForUsers = record("refreshMirrorForUsers", 1);
rolesService.removeMembership = record("removeMembership", 1);
// Проверка читает всё членство и всех его людей — в базу. Подменена: загрузку
// заменяет `holderState`, решение и отказ — настоящие (`holderLossRefusal`)
rolesService.assertNoOrphanedStaffActions = async (...args) => {
  calls.push(["assertNoOrphanedStaffActions", ...args]);
  if (holderFailure) throw holderFailure;
  if (holderState) {
    const [, transform] = args;
    const refusal = rolesService.holderLossRefusal(
      holderState,
      transform(holderState),
    );
    if (refusal) throw refusal;
  }
};
// Порог полного доступа читает каталог и членство прямо из коллекций.
// Подменён записью вызова; настоящий работает, когда тест дал ему базу в
// памяти (`installFullAccessCatalogue`)
const realFullAccessCheck = rolesService.assertNotLastFullAccessHolder;
let fullAccessCheckIsReal = false;
rolesService.assertNotLastFullAccessHolder = async (...args) => {
  calls.push(["assertNotLastFullAccessHolder", ...args]);
  if (fullAccessCheckIsReal) await realFullAccessCheck(...args);
};
const authSessions = require("@/services/authSessions");
authSessions.revokeAllForUser = record("revokeAllForUser", 1);
authSessions.revokeOthersForUser = record("revokeOthersForUser", 1);
authSessions.listForUser = record("listForUser", [{ id: "session-1" }]);

const controller = require("./user");

/**
 * Карточка человека и список его сеансов — это доступ, и отказы обязаны
 * срабатывать ДО любых записей. Модели подменены заглушками, базы нет: всё,
 * что дальше отказа, сюда дойти не должно — чтение компаний сразу валит тест.
 */

const originals = {
  findById: User.findById,
  exists: User.exists,
  companyFindById: Company.findById,
  subdivisionFindById: Subdivision.findById,
  categoryFindById: TicketCategory.findById,
  prefsFindOne: Prefs.findOne,
  locationFindOne: Location.findOne,
  notificationCreate: Notification.create,
  loggerWarn: logger.warn,
  loggerLog: logger.log,
};

let restoreDb = null;

afterEach(() => {
  User.findById = originals.findById;
  User.exists = originals.exists;
  Company.findById = originals.companyFindById;
  Subdivision.findById = originals.subdivisionFindById;
  TicketCategory.findById = originals.categoryFindById;
  Prefs.findOne = originals.prefsFindOne;
  Location.findOne = originals.locationFindOne;
  Notification.create = originals.notificationCreate;
  logger.warn = originals.loggerWarn;
  logger.log = originals.loggerLog;
  calls.length = 0;
  assignFailure = null;
  holderFailure = null;
  holderState = null;
  currentRoles = [];
  fullAccessCheckIsReal = false;
  restoreDb?.();
  restoreDb = null;
});

/**
 * База в памяти для настоящего порога полного доступа — ровно то, что он
 * читает из коллекций: организацию, каталог ролей (роль полного доступа и
 * роль инженера), членство и счёт пользователей. Фильтры не применяются —
 * строки собраны под случай: в членстве только ДРУГИЕ носители полного
 * доступа, и все они действующие.
 */
const installFullAccessCatalogue = ({ otherAdmins = [] } = {}) => {
  const rows = {
    organization: [{ _id: "org-1", slug: "hd" }],
    organizationRole: [
      {
        organizationId: "org-1",
        role: "admin",
        audience: "staff",
        permission: JSON.stringify(staffAccessStatements()),
      },
      {
        organizationId: "org-1",
        role: "engineer",
        audience: "staff",
        permission: JSON.stringify({ ticket: ["perform"] }),
      },
    ],
    member: otherAdmins.map((userId) => ({
      organizationId: "org-1",
      userId,
      role: "admin",
    })),
    users: otherAdmins.map((_id) => ({ _id })),
  };
  const original = mongoose.connection.db;
  mongoose.connection.db = {
    collection: (name) => ({
      findOne: async () => rows[name][0] ?? null,
      find: () => ({ toArray: async () => rows[name] }),
      countDocuments: async () => rows[name].length,
    }),
  };
  restoreDb = () => {
    mongoose.connection.db = original;
  };
  fullAccessCheckIsReal = true;
};

const ADMIN = {
  _id: "66aa00000000000000000001",
  email: "admin@f1lab.ru",
  isAdmin: true,
  isEndUser: false,
  banned: false,
};
const PERSON = {
  _id: "66aa00000000000000000002",
  email: "ivanov@f1lab.ru",
  isAdmin: false,
  isEndUser: true,
  banned: false,
};
const STAFF = {
  _id: "66aa00000000000000000004",
  email: "sidorov@f1lab.ru",
  isAdmin: false,
  isEndUser: false,
  banned: false,
};

/**
 * Вызывающий: `can` по списку действий «ресурс.действие». `userId` и `session`
 * — как в настоящем `req.auth` (services/authContext.js): по ним контроллер
 * узнаёт, что человек правит самого себя, и оставляет его текущий сеанс.
 */
const actor = ({
  isAdmin = false,
  actions = [],
  id = "66aa00000000000000000009",
} = {}) => ({
  isAdmin,
  userId: id,
  user: { _id: id },
  session: { token: "current-token" },
  can: (request) =>
    Object.entries(request).every(([resource, list]) =>
      list.every((action) => actions.includes(`${resource}.${action}`)),
    ),
});

const call = async (handler, { params, body = {}, auth }) => {
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
  await handler({ params, body, auth }, res, (error) => {
    failure = error;
  });
  return { failure, sent };
};

const forbidCompanyReads = () => {
  Company.findById = () => {
    throw new Error("отказ опоздал: дошло до чтения компаний");
  };
};

test("update: a missing account is a 404", async () => {
  User.findById = async () => null;
  forbidCompanyReads();

  const { failure } = await call(controller.update, {
    params: { id: PERSON._id },
    auth: actor({ actions: ["user.manage"] }),
  });

  assert.equal(failure?.statusCode, 404);
});

test("update: an administrator's card is edited only by an administrator", async () => {
  User.findById = async () => ({ ...ADMIN });
  forbidCompanyReads();

  const { failure } = await call(controller.update, {
    params: { id: ADMIN._id },
    body: { phone: "79145550142" },
    auth: actor({ actions: ["user.manage", "user.manageAccess"] }),
  });

  assert.equal(failure?.statusCode, 403);
  assert.equal(
    failure.message,
    "Доступом администратора управляет только администратор",
  );
});

test("update: an e-mail change without user.manageAccess stops before any write", async () => {
  User.findById = async () => ({ ...PERSON });
  forbidCompanyReads();

  const { failure } = await call(controller.update, {
    params: { id: PERSON._id },
    body: { email: "petrov@f1lab.ru" },
    auth: actor({ actions: ["user.manage"] }),
  });

  assert.equal(failure?.statusCode, 403);
  assert.match(failure.message, /email/);
});

test("update: flipping the account type without user.manageAccess stops before any write", async () => {
  // Сотрудника пытаются сделать клиентом правом «вести карточки» (user.manage):
  // тип учётной записи — это адресат, а значит доступ, и право на него то же,
  // что на смену email
  User.findById = async () => ({ ...STAFF });
  forbidCompanyReads();

  const { failure } = await call(controller.update, {
    params: { id: STAFF._id },
    body: { isEndUser: true },
    auth: actor({ actions: ["user.manage"] }),
  });

  assert.equal(failure?.statusCode, 403);
  assert.equal(failure.message, ACCOUNT_UPDATE_MESSAGES.typeRight);
});

test("update: a non-boolean account type is a 400 before any write", async () => {
  User.findById = async () => ({ ...PERSON });
  forbidCompanyReads();

  const { failure } = await call(controller.update, {
    params: { id: PERSON._id },
    body: { isEndUser: "false" },
    auth: actor({ actions: ["user.manage", "user.manageAccess"] }),
  });

  assert.equal(failure?.statusCode, 400);
});

test("update: an address taken by another account is a 409", async () => {
  User.findById = async () => ({ ...PERSON });
  let asked = null;
  User.exists = async (filter) => {
    asked = filter;
    return { _id: "66aa00000000000000000003" };
  };
  forbidCompanyReads();

  const { failure } = await call(controller.update, {
    params: { id: PERSON._id },
    body: { email: "Petrov@F1lab.ru" },
    auth: actor({ actions: ["user.manage", "user.manageAccess"] }),
  });

  assert.equal(failure?.statusCode, 409);
  assert.deepEqual(asked, {
    email: "petrov@f1lab.ru",
    _id: { $ne: PERSON._id },
  });
});

test("sessions: an administrator's devices are listed only to an administrator", async () => {
  User.findById = () => ({ select: async () => ({ ...ADMIN }) });

  const { failure, sent } = await call(controller.sessions, {
    params: { id: ADMIN._id },
    auth: actor({ actions: ["user.manageAccess"] }),
  });

  assert.equal(sent, null);
  assert.equal(failure?.statusCode, 403);
});

test("sessions: the lookup reads the fields the administrator rule needs", async () => {
  // Без `isEndUser` в выборке сотрудник-администратор считался бы клиентом, и
  // правило отказа молча перестало бы действовать
  let projection = null;
  User.findById = () => ({
    select: async (fields) => {
      projection = fields;
      return { ...ADMIN };
    },
  });

  await call(controller.sessions, {
    params: { id: ADMIN._id },
    auth: actor({ actions: ["user.manageAccess"] }),
  });

  const fields = String(projection).split(/\s+/);
  assert.ok(fields.includes("isAdmin"));
  assert.ok(fields.includes("isEndUser"));
});

test("sessions: a person's devices are listed to the holder of the access right", async () => {
  User.findById = () => ({ select: async () => ({ ...PERSON }) });

  const { failure, sent } = await call(controller.sessions, {
    params: { id: PERSON._id },
    auth: actor({ actions: ["user.manageAccess"] }),
  });

  assert.equal(failure, null);
  assert.equal(sent.status, 200);
  assert.deepEqual(sent.payload, { sessions: [{ id: "session-1" }] });
  assert.deepEqual(calls, [["listForUser", PERSON._id]]);
});

test("sessions: an administrator may list an administrator's devices", async () => {
  User.findById = () => ({ select: async () => ({ ...ADMIN }) });

  const { failure, sent } = await call(controller.sessions, {
    params: { id: ADMIN._id },
    auth: actor({ isAdmin: true, actions: ["user.manageAccess"] }),
  });

  assert.equal(failure, null);
  assert.equal(sent.status, 200);
});

/**
 * Правка, которую пропустили: что делает контроллер ПОСЛЕ решения о доступе.
 * Документ и очередь писем подменены; в `calls` попадают запись документа,
 * проверка адреса, вызовы служб и строки журнала.
 */

const COMPANY = {
  _id: "66bb00000000000000000001",
  employees: [],
  save: async () => {},
};

/**
 * Правка карточки `target` от имени вызывающего с указанными правами
 * (`actorId` — кто правит; совпал с целью — человек правит самого себя).
 * Вместе с документом отдаётся `saved` — снимок его полей на момент `save()`,
 * то есть то, что ушло бы в базу: поле, выставленное ПОСЛЕ записи, в него не
 * попадает.
 */
const edit = async ({
  target,
  body = {},
  actions = ["user.manage", "user.manageAccess"],
  actorId,
  actorIsAdmin = false,
  queueFails = false,
  // Компании в базе; учётная запись — в первой, переход — `body.company`
  companies = [COMPANY],
}) => {
  let saved = null;
  const doc = {
    company: { _id: COMPANY._id },
    categories: [],
    subdivision: null,
    ...target,
    async save() {
      calls.push(["save"]);
      saved = { ...this };
      return this;
    },
  };
  User.findById = async () => doc;
  User.exists = async (filter) => {
    calls.push(["exists", filter]);
    return null;
  };
  Company.findById = async (id) =>
    companies.find((company) => String(company._id) === String(id)) ?? null;
  Prefs.findOne = async () => ({});
  Location.findOne = async () => null;
  Notification.create = async (notice) => {
    if (queueFails) throw new Error("очередь недоступна");
    calls.push(["notify", notice]);
    return notice;
  };
  logger.warn = (message, meta) => {
    calls.push(["audit", message, meta]);
  };
  logger.log = (level, message, meta) => {
    calls.push(["log", level, message, meta]);
  };

  const outcome = await call(controller.update, {
    params: { id: doc._id },
    body: { company: COMPANY._id, categories: [], ...body },
    auth: actor({ id: actorId, isAdmin: actorIsAdmin, actions }),
  });
  return { doc, saved, ...outcome };
};

const steps = () => calls.map(([name]) => name);
const callOf = (name) => calls.find(([called]) => called === name);

test("update: an e-mail change signs the person out and warns the old address", async () => {
  const { doc, failure, sent } = await edit({
    target: PERSON,
    body: { email: " Petrov@F1lab.ru " },
  });

  assert.equal(failure, null);
  assert.equal(sent.status, 201);
  // Пишется адрес из решения (без пробелов, в нижнем регистре), не тело запроса
  assert.equal(doc.email, "petrov@f1lab.ru");
  // Запись, затем сеансы и письмо, и только потом роли: отказ на ролях не
  // должен оставить сохранённую смену без последствий
  assert.deepEqual(steps(), [
    "exists",
    "save",
    "revokeAllForUser",
    "audit",
    "notify",
    "ensureMember",
  ]);
  assert.equal(callOf("revokeAllForUser")[1], PERSON._id);
  assert.deepEqual(callOf("audit").slice(1), [
    "Email учётной записи изменён",
    {
      module: "user",
      targetId: PERSON._id,
      byId: "66aa00000000000000000009",
    },
  ]);
  const [, notice] = callOf("notify");
  // Письмо — на ПРЕЖНИЙ адрес, новый назван в тексте
  assert.equal(notice.to.email, "ivanov@f1lab.ru");
  assert.match(notice.text, /petrov@f1lab\.ru/);
});

test("update: an account with no stored e-mail is signed out too, but no letter is queued", async () => {
  // Старая запись без email: письмо писать некуда, но смена — всё равно смена
  const { doc, failure, sent } = await edit({
    target: { ...PERSON, email: undefined },
    body: { email: "new@f1lab.ru" },
  });

  assert.equal(failure, null);
  assert.equal(sent.status, 201);
  assert.equal(doc.email, "new@f1lab.ru");
  assert.deepEqual(steps(), [
    "exists",
    "save",
    "revokeAllForUser",
    "audit",
    "ensureMember",
  ]);
});

test("update: a failing letter queue does not break the saved change", async () => {
  const { failure, sent } = await edit({
    target: PERSON,
    body: { email: "petrov@f1lab.ru" },
    queueFails: true,
  });

  assert.equal(failure, null);
  assert.equal(sent.status, 201);
  // Сеансы погашены, роли назначены, а потеря письма видна в журнале
  assert.deepEqual(steps(), [
    "exists",
    "save",
    "revokeAllForUser",
    "audit",
    "log",
    "ensureMember",
  ]);
  const [, level, message, meta] = callOf("log");
  assert.equal(level, "error");
  assert.equal(message, "Письмо о смене email не поставлено в очередь");
  assert.equal(meta.targetId, PERSON._id);
  assert.equal(meta.error, "очередь недоступна");
});

test("update: the same address in another case is not a change", async () => {
  const { doc, failure } = await edit({
    target: PERSON,
    body: { email: " IVANOV@F1LAB.RU " },
  });

  assert.equal(failure, null);
  assert.equal(doc.email, "ivanov@f1lab.ru");
  // Ни проверки адреса, ни сеансов, ни письма
  assert.deepEqual(steps(), ["save", "ensureMember"]);
});

test("update: a person changing their own e-mail keeps the current session", async () => {
  // Остальные сеансы гаснут, а свой остаётся: выкидывать человека из
  // приложения за правку собственной карточки незачем (как при смене пароля).
  // Письмо на прежний адрес уходит, как и у чужой правки
  const { doc, failure } = await edit({
    target: STAFF,
    body: { email: "new.sidorov@f1lab.ru" },
    actorId: STAFF._id,
  });

  assert.equal(failure, null);
  assert.equal(doc.email, "new.sidorov@f1lab.ru");
  assert.deepEqual(steps(), [
    "exists",
    "save",
    "revokeOthersForUser",
    "audit",
    "notify",
    "ensureMember",
  ]);
  assert.deepEqual(callOf("revokeOthersForUser").slice(1), [
    STAFF._id,
    "current-token",
  ]);
});

test("update: an account that disables itself loses every session, the current one too", async () => {
  // Отключение сильнее правила «свой сеанс остаётся»: отключённая учётная
  // запись не должна сохранить ни одного сеанса
  const { failure } = await edit({
    target: STAFF,
    body: { email: "new.sidorov@f1lab.ru", banned: true },
    actorId: STAFF._id,
  });

  assert.equal(failure, null);
  assert.ok(steps().includes("revokeAllForUser"));
  assert.ok(!steps().includes("revokeOthersForUser"));
});

test("update: a ban signs the person out", async () => {
  // Отключение — право ручки отключения (user.manage), без права на доступ
  const { doc, failure } = await edit({
    target: PERSON,
    body: { banned: true },
    actions: ["user.manage"],
  });

  assert.equal(failure, null);
  assert.equal(doc.banned, true);
  // Отключение выводит человека из носителей прав: проверка — до записи
  assert.deepEqual(steps(), [
    "assertNoOrphanedStaffActions",
    "save",
    "revokeAllForUser",
    "ensureMember",
  ]);
  assert.equal(callOf("revokeAllForUser")[1], PERSON._id);
});

test("update: omitted banned and isEndUser leave the account as it was", async () => {
  const until = new Date("2030-01-01T00:00:00Z");
  const { doc, failure } = await edit({
    target: { ...STAFF, banned: true, banReason: "Длительный отпуск", banExpires: until },
    actions: ["user.manage"],
  });

  assert.equal(failure, null);
  // Раньше пропущенное поле включало учётку, а тип стирался
  assert.equal(doc.banned, true);
  assert.equal(doc.banReason, "Длительный отпуск");
  assert.equal(doc.banExpires, until);
  assert.equal(doc.isEndUser, false);
  // Отключённой учётке сеансы гасятся при каждом сохранении, не только при
  // смене флага (см. тест ниже)
  assert.deepEqual(steps(), ["save", "revokeAllForUser", "ensureMember"]);
});

test("update: saving an account that is already disabled signs it out again", async () => {
  // Форма шлёт отключение при каждом сохранении, а флаг не меняется. Сбой
  // прежнего погашения сеансов (запись уже прошла) не должен пережить повтор
  const { failure } = await edit({
    target: { ...PERSON, banned: true },
    body: { banned: true },
    actions: ["user.manage"],
  });

  assert.equal(failure, null);
  assert.deepEqual(steps(), ["save", "revokeAllForUser", "ensureMember"]);
  assert.equal(callOf("revokeAllForUser")[1], PERSON._id);
});

test("update: un-banning clears the reason and the term and revokes nothing", async () => {
  const { doc, failure } = await edit({
    target: {
      ...PERSON,
      banned: true,
      banReason: "Длительный отпуск",
      banExpires: new Date("2030-01-01T00:00:00Z"),
    },
    body: { banned: false },
    actions: ["user.manage"],
  });

  assert.equal(failure, null);
  assert.equal(doc.banned, false);
  assert.equal(doc.banReason, undefined);
  assert.equal(doc.banExpires, undefined);
  assert.deepEqual(steps(), ["save", "ensureMember"]);
});

test("update: an account type flip without roles recomputes the role mirror", async () => {
  const { doc, failure } = await edit({
    target: STAFF,
    body: { isEndUser: true },
  });

  assert.equal(failure, null);
  assert.equal(doc.isEndUser, true);
  assert.deepEqual(steps(), [
    "assertNoOrphanedStaffActions",
    "save",
    "ensureMember",
    "refreshMirrorForUsers",
  ]);
  assert.deepEqual(callOf("refreshMirrorForUsers").slice(1), [
    "org-1",
    [STAFF._id],
  ]);
});

test("update: roles in the body take over the mirror, and the same type is no flip", async () => {
  // Роли прислали: зеркало пересчитает назначение, второго пересчёта не нужно
  const flipped = await edit({
    target: STAFF,
    body: { isEndUser: true, roles: ["client"] },
  });
  assert.equal(flipped.failure, null);
  assert.deepEqual(steps(), [
    "assertNoOrphanedStaffActions",
    "save",
    "ensureMember",
    "assignRoles",
  ]);
  assert.deepEqual(callOf("assignRoles").slice(1, 3), [STAFF._id, ["client"]]);

  // Тот же тип, что записан, — не смена: пересчёта нет
  calls.length = 0;
  const same = await edit({ target: STAFF, body: { isEndUser: false } });
  assert.equal(same.failure, null);
  assert.deepEqual(steps(), ["save", "ensureMember"]);
});

test("update: a refused role assignment after a type flip leaves no administrator mirror", async () => {
  // Клиент с остатком `isAdmin: true`: пока он клиент, флаг не действует. Тип
  // меняют на сотрудника, а назначение ролей отказывает (400): save() уже
  // прошёл, пересчёта зеркала не будет. Флаг сброшен в том же save() — иначе
  // клиент стал бы администратором одним запросом
  assignFailure = new AppError("Неизвестные роли: no-such-role", 400);
  const { saved, failure } = await edit({
    target: { ...PERSON, isAdmin: true },
    body: { isEndUser: false, roles: ["client", "no-such-role"] },
  });

  assert.equal(failure?.statusCode, 400);
  assert.equal(saved.isEndUser, false);
  assert.equal(saved.isAdmin, false);
  assert.deepEqual(steps(), ["save", "ensureMember", "assignRoles"]);
});

test("update: a card saved without a type change keeps the administrator mirror", async () => {
  // Сброс зеркала — только на смене адресата: форма шлёт тип при каждом
  // сохранении, и администратор не должен терять флаг от правки телефона
  const { saved, failure } = await edit({
    target: { ...STAFF, isAdmin: true },
    body: { isEndUser: false },
    actorIsAdmin: true,
  });

  assert.equal(failure, null);
  assert.equal(saved.isAdmin, true);
  assert.deepEqual(steps(), ["save", "ensureMember"]);
});

/**
 * Последний носитель права (services/permissionHolders.js). Сама проверка
 * подменена — она читает всё членство; здесь проверяется, где она стоит и
 * какую правку получает. Правку тесты применяют к своему состоянию или дают
 * проверке решить на нём по-настоящему (`holderState`). Где проверки нет
 * (включение, тот же тип, клиент в сотрудники, правка без смены доступа и без
 * снятия ролей), её нет и в `steps()` тестов выше.
 */
const HOLDERS = {
  accounts: [
    { id: STAFF._id, isEndUser: false, roles: ["lead"] },
    { id: ADMIN._id, isEndUser: false, roles: ["admin"] },
  ],
  catalogue: new Map(),
};

/** Что правка, переданная проверке, делает с состоянием `HOLDERS`. */
const holderChange = () => {
  const [, orgId, transform] = callOf("assertNoOrphanedStaffActions");
  assert.equal(orgId, "org-1");
  return transform(HOLDERS).accounts;
};

const LAST_HOLDER =
  "После этого ни у кого не останется права «Изменять роли». Сначала выдайте его другому сотруднику.";

/** Действующий сотрудник в состоянии носителей. */
const holder = (id, roles) => ({
  id,
  isEndUser: false,
  banned: false,
  banExpires: undefined,
  isServiceAccount: false,
  companyId: COMPANY._id,
  companyActive: true,
  roles,
});

/**
 * «Изменять роли» (роль lead) — только у редактируемого сотрудника, пока тест
 * не выдал её и администратору; «Брать заявки в работу» (engineer) по
 * умолчанию есть у обоих. `adminRoles` заменяет роли администратора целиком.
 */
const holdersWith = (adminRoles = ["engineer"]) => ({
  accounts: [
    holder(STAFF._id, ["lead", "engineer"]),
    holder(ADMIN._id, adminRoles),
  ],
  catalogue: new Map([
    ["lead", { statements: { role: ["manage"] }, audience: "staff" }],
    ["engineer", { statements: { ticket: ["perform"] }, audience: "staff" }],
  ]),
});

/** Учётная запись STAFF такой, какой её видит проверка после правки. */
const staffAfter = () => {
  const [, orgId, transform] = callOf("assertNoOrphanedStaffActions");
  assert.equal(orgId, "org-1");
  return transform(holdersWith()).accounts.find(
    (account) => account.id === STAFF._id,
  );
};

const companyDoc = (_id, isActive) => ({
  _id,
  isActive,
  employees: [],
  save: async () => {},
});

const checks = () =>
  steps().filter((name) => name === "assertNoOrphanedStaffActions").length;

test("update: a ban and a flip to client reach the check as the planned account", async () => {
  await edit({ target: STAFF, body: { banned: true }, actions: ["user.manage"] });
  assert.deepEqual(staffAfter(), {
    ...holder(STAFF._id, ["lead", "engineer"]),
    banned: true,
  });

  calls.length = 0;
  await edit({ target: STAFF, body: { isEndUser: true } });
  assert.deepEqual(staffAfter(), {
    ...holder(STAFF._id, ["lead", "engineer"]),
    isEndUser: true,
  });

  // Пришло и то и другое — одна проверка на одно состояние «после»
  calls.length = 0;
  await edit({ target: STAFF, body: { banned: true, isEndUser: true } });
  assert.equal(checks(), 1);
  assert.deepEqual(staffAfter(), {
    ...holder(STAFF._id, ["lead", "engineer"]),
    banned: true,
    isEndUser: true,
  });
});

test("update: a refused last-holder check stops before any write", async () => {
  holderState = holdersWith();
  const { saved, failure, sent } = await edit({
    target: STAFF,
    body: { banned: true },
    actions: ["user.manage"],
  });

  assert.equal(failure?.statusCode, 409);
  assert.equal(failure.message, LAST_HOLDER);
  assert.equal(sent, null);
  // Ни записи, ни погашенных сеансов, ни ролей
  assert.equal(saved, null);
  assert.deepEqual(steps(), ["assertNoOrphanedStaffActions"]);
});

test("update: becoming a service account is refused before save() when it would orphan", async () => {
  holderState = holdersWith();
  const refused = await edit({ target: STAFF, body: { isServiceAccount: true } });

  assert.equal(refused.failure?.statusCode, 409);
  assert.equal(refused.failure.message, LAST_HOLDER);
  assert.equal(refused.saved, null);
  assert.deepEqual(steps(), ["assertNoOrphanedStaffActions"]);

  // Право есть и у администратора — можно. Значение — каким его запишет
  // Mongoose: строка "true" тоже «да»
  calls.length = 0;
  holderState = holdersWith(["lead", "engineer"]);
  const passed = await edit({ target: STAFF, body: { isServiceAccount: "true" } });
  assert.equal(passed.failure, null);
  assert.equal(staffAfter().isServiceAccount, true);
  assert.deepEqual(steps(), ["assertNoOrphanedStaffActions", "save", "ensureMember"]);
});

test("update: moving to an inactive company is refused before save() when it would orphan", async () => {
  holderState = holdersWith();
  const inactive = companyDoc("66bb00000000000000000003", false);
  const refused = await edit({
    target: STAFF,
    body: { company: inactive._id },
    companies: [COMPANY, inactive],
  });

  assert.equal(refused.failure?.statusCode, 409);
  assert.equal(refused.failure.message, LAST_HOLDER);
  assert.equal(refused.saved, null);
  assert.deepEqual(steps(), ["assertNoOrphanedStaffActions"]);
  assert.deepEqual(
    [staffAfter().companyId, staffAfter().companyActive],
    [inactive._id, false],
  );

  // В работающую компанию — проверка есть, потери нет
  calls.length = 0;
  const active = companyDoc("66bb00000000000000000002", true);
  const moved = await edit({
    target: STAFF,
    body: { company: active._id },
    companies: [COMPANY, active],
  });
  assert.equal(moved.failure, null);
  assert.deepEqual(
    [staffAfter().companyId, staffAfter().companyActive],
    [active._id, true],
  );
  assert.deepEqual(steps(), ["assertNoOrphanedStaffActions", "save", "ensureMember"]);
});

test("update: a role removal that would orphan is refused before save()", async () => {
  holderState = holdersWith();
  currentRoles = ["lead", "engineer"];
  const { failure, saved } = await edit({
    target: STAFF,
    body: { roles: ["engineer"] },
  });

  assert.equal(failure?.statusCode, 409);
  assert.equal(failure.message, LAST_HOLDER);
  // Ни записи карточки, ни назначения: отказ не оставит полусохранённой правки.
  // Порог полного доступа спрошен первым — полного доступа здесь нет
  assert.equal(saved, null);
  assert.deepEqual(steps(), [
    "assertNotLastFullAccessHolder",
    "assertNoOrphanedStaffActions",
  ]);
});

test("update: added roles are not checked, a removal that keeps every right goes through", async () => {
  holderState = holdersWith();
  currentRoles = ["engineer"];
  await edit({ target: STAFF, body: { roles: ["engineer", "lead"] } });
  assert.deepEqual(steps(), ["save", "ensureMember", "assignRoles"]);

  // Роль lead есть и у администратора: снять её можно. Назначение проверит
  // ещё раз само (его подмена здесь пропускает)
  calls.length = 0;
  holderState = holdersWith(["lead"]);
  currentRoles = ["lead", "engineer"];
  const { failure } = await edit({ target: STAFF, body: { roles: ["engineer"] } });
  assert.equal(failure, null);
  assert.deepEqual(steps(), [
    "assertNotLastFullAccessHolder",
    "assertNoOrphanedStaffActions",
    "save",
    "ensureMember",
    "assignRoles",
  ]);
  assert.deepEqual(staffAfter().roles, ["engineer"]);
});

test("update: a ban and a role removal in one request are one check on one after-state", async () => {
  currentRoles = ["lead", "engineer"];
  await edit({ target: STAFF, body: { banned: true, roles: ["engineer"] } });

  assert.equal(checks(), 1);
  assert.deepEqual(staffAfter(), {
    ...holder(STAFF._id, ["engineer"]),
    banned: true,
  });
});

const FULL_ACCESS_MESSAGE =
  "Это последний человек с полным доступом — снять его нельзя: вернуть полный доступ будет некому. Сначала выдайте роль администратора кому-то ещё";

test("update: the last full-access person dropping the admin role gets the full-access message before save()", async () => {
  installFullAccessCatalogue();
  // Проверка носителей отказала бы тоже — списком из всех прав роли
  holderState = {
    accounts: [holder(STAFF._id, ["admin"]), holder(ADMIN._id, ["engineer"])],
    catalogue: new Map([
      ["admin", { statements: staffAccessStatements(), audience: "staff" }],
      ["engineer", { statements: { ticket: ["perform"] }, audience: "staff" }],
    ]),
  };
  currentRoles = ["admin"];

  const { failure, saved } = await edit({
    target: { ...STAFF, isAdmin: true },
    body: { roles: ["engineer"] },
    actorIsAdmin: true,
  });

  assert.equal(failure?.statusCode, 409);
  assert.equal(failure.message, FULL_ACCESS_MESSAGE);
  assert.equal(saved, null);
  // Порог полного доступа стоит раньше проверки носителей и до неё не пускает
  assert.deepEqual(steps(), ["assertNotLastFullAccessHolder"]);
  assert.deepEqual(callOf("assertNotLastFullAccessHolder").slice(1, 5), [
    "org-1",
    STAFF._id,
    ["admin"],
    ["engineer"],
  ]);
});

test("update: dropping the admin role while another full-access person exists goes on to the holder check", async () => {
  installFullAccessCatalogue({ otherAdmins: [ADMIN._id] });
  currentRoles = ["admin"];

  const { failure } = await edit({
    target: { ...STAFF, isAdmin: true },
    body: { roles: ["engineer"] },
    actorIsAdmin: true,
  });

  assert.equal(failure, null);
  assert.deepEqual(steps(), [
    "assertNotLastFullAccessHolder",
    "assertNoOrphanedStaffActions",
    "save",
    "ensureMember",
    "assignRoles",
  ]);
});

test("update: the same company switched off behind a stale snapshot is a loss too", async () => {
  // В снимке учётной записи компания ещё работает, а сама она уже отключена:
  // сохранение перепишет снимок, и человек перестанет быть носителем
  holderState = holdersWith();
  const refused = await edit({
    target: { ...STAFF, company: { _id: COMPANY._id, isActive: true } },
    companies: [companyDoc(COMPANY._id, false)],
  });

  assert.equal(refused.failure?.statusCode, 409);
  assert.equal(refused.failure.message, LAST_HOLDER);
  assert.equal(refused.saved, null);
  assert.deepEqual(steps(), ["assertNoOrphanedStaffActions"]);
  assert.deepEqual(
    [staffAfter().companyId, staffAfter().companyActive],
    [COMPANY._id, false],
  );

  // Снимок уже говорит «отключена» — терять нечего, проверки нет
  calls.length = 0;
  const unchanged = await edit({
    target: { ...STAFF, company: { _id: COMPANY._id, isActive: false } },
    companies: [companyDoc(COMPANY._id, false)],
  });
  assert.equal(unchanged.failure, null);
  assert.deepEqual(steps(), ["save", "ensureMember"]);
});

test("update: a refused check stops before the subdivision and category writes", async () => {
  Subdivision.findById = async (id) => ({
    _id: String(id),
    users: [STAFF._id],
    async save() {
      calls.push(["saveSubdivision", String(id)]);
    },
  });
  TicketCategory.findById = async (id) => ({
    _id: String(id),
    users: [],
    async save() {
      calls.push(["saveCategory", String(id)]);
    },
  });
  const request = {
    target: {
      ...STAFF,
      subdivision: "66cc00000000000000000001",
      categories: [{ _id: "66dd00000000000000000001" }],
    },
    body: {
      banned: true,
      subdivision: "66cc00000000000000000002",
      categories: ["66dd00000000000000000002"],
    },
    actions: ["user.manage"],
  };

  holderState = holdersWith();
  const refused = await edit(request);
  assert.equal(refused.failure?.statusCode, 409);
  assert.equal(refused.saved, null);
  // Ни подразделений, ни категорий, ни карточки
  assert.deepEqual(steps(), ["assertNoOrphanedStaffActions"]);

  // Тот же запрос, когда терять нечего, пишет и подразделения, и категории —
  // отказ выше действительно их опередил
  calls.length = 0;
  holderState = holdersWith(["lead", "engineer"]);
  const passed = await edit(request);
  assert.equal(passed.failure, null);
  assert.deepEqual(steps(), [
    "assertNoOrphanedStaffActions",
    "saveSubdivision",
    "saveSubdivision",
    "saveCategory",
    "saveCategory",
    "save",
    "revokeAllForUser",
    "ensureMember",
  ]);
});

/** Учётная запись для ручек отключения и удаления: `save()` пишется в `calls`. */
const stored = (target) => {
  const doc = {
    ...target,
    async save() {
      calls.push(["save"]);
      return this;
    },
  };
  User.findById = async () => doc;
  return doc;
};

test("toggleActive: a ban is checked before the write, switching back on is not", async () => {
  const doc = stored(STAFF);
  const off = await call(controller.toggleActive, {
    params: { id: STAFF._id },
    body: { banned: true },
    auth: actor({ actions: ["user.manage"] }),
  });

  assert.equal(off.failure, null);
  assert.equal(doc.banned, true);
  assert.deepEqual(steps(), [
    "assertNoOrphanedStaffActions",
    "save",
    "revokeAllForUser",
  ]);
  assert.deepEqual(
    holderChange().map((account) => account.id),
    [ADMIN._id],
  );

  calls.length = 0;
  stored({ ...STAFF, banned: true });
  const on = await call(controller.toggleActive, {
    params: { id: STAFF._id },
    body: { banned: false },
    auth: actor({ actions: ["user.manage"] }),
  });
  assert.equal(on.failure, null);
  assert.deepEqual(steps(), ["save"]);
});

test("toggleActive: a refused check answers 409, not 500, and the account stays on", async () => {
  holderFailure = new AppError(LAST_HOLDER, 409);
  const doc = stored(STAFF);
  const { failure, sent } = await call(controller.toggleActive, {
    params: { id: STAFF._id },
    body: { banned: true },
    auth: actor({ actions: ["user.manage"] }),
  });

  assert.equal(failure?.statusCode, 409);
  assert.equal(failure.message, LAST_HOLDER);
  assert.equal(sent, null);
  assert.equal(doc.banned, false);
  assert.deepEqual(steps(), ["assertNoOrphanedStaffActions"]);
});

test("toggleActive: banning the last full-access person is refused with the full-access message", async () => {
  // Каждое право сотрудника есть и у напарника — двумя неполными ролями, так
  // что поштучно ничего не теряется; роль полного доступа — только у
  // отключаемого, и после него выдать её некому
  holderState = {
    accounts: [
      holder(STAFF._id, ["admin"]),
      holder(ADMIN._id, ["half-a", "half-b"]),
    ],
    catalogue: new Map([
      ["admin", { statements: staffAccessStatements(), audience: "staff" }],
      [
        "half-a",
        { statements: actionsToStatements(STAFF_ACTIONS.slice(0, 30)), audience: "staff" },
      ],
      [
        "half-b",
        { statements: actionsToStatements(STAFF_ACTIONS.slice(30)), audience: "staff" },
      ],
    ]),
  };
  const doc = stored({ ...STAFF, isAdmin: true });

  const { failure, sent } = await call(controller.toggleActive, {
    params: { id: STAFF._id },
    body: { banned: true },
    auth: actor({ isAdmin: true, actions: ["user.manage"] }),
  });

  assert.equal(failure?.statusCode, 409);
  assert.equal(failure.message, FULL_ACCESS_MESSAGE);
  assert.equal(sent, null);
  // До записи: учётная запись не отключена, сеансы не тронуты
  assert.equal(doc.banned, false);
  assert.deepEqual(steps(), ["assertNoOrphanedStaffActions"]);
});

test("delete: a refused check answers 409 before anything is removed", async () => {
  holderFailure = new AppError(LAST_HOLDER, 409);
  stored(STAFF);
  const { failure, sent } = await call(controller.delete, {
    params: { id: STAFF._id },
    auth: actor({ actions: ["user.manage"] }),
  });

  assert.equal(failure?.statusCode, 409);
  assert.equal(failure.message, LAST_HOLDER);
  assert.equal(sent, null);
  // Ни членства, ни сеансов: проверка стоит раньше всех удалений
  assert.deepEqual(steps(), ["assertNoOrphanedStaffActions"]);
  assert.deepEqual(
    holderChange().map((account) => account.id),
    [ADMIN._id],
  );
});
