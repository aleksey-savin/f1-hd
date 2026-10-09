// node --test services/deviceScope.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const sift = require("sift").default;

const {
  attachableCompanyId,
  deviceComponentsFilter,
  deviceScopeMatch,
  deviceTicketsFilter,
  deviceViewer,
  deviceVisibleTo,
  userTechQueries,
  viewerScope,
  visibleHost,
} = require("./deviceScope");

/**
 * Видимость техники: клиент заперт в своей компании на карточке устройства,
 * на её заявках, в подборе комплектующих и в технике пользователя. Сотрудник
 * не ограничен. Условия проверяются тем же сопоставлением, что у Mongo (sift).
 */

const OWN = "66aa00000000000000000001";
const FOREIGN = "66aa00000000000000000002";

const client = { isEndUser: true, companyId: OWN };
const staff = { isEndUser: false, companyId: null };

test("viewer comes from req.auth: normalised isEndUser and the company id", () => {
  const companyId = new mongoose.Types.ObjectId(OWN);
  assert.deepEqual(
    deviceViewer({ isEndUser: true, user: { company: { _id: companyId } } }),
    { isEndUser: true, companyId },
  );
  assert.deepEqual(deviceViewer({ isEndUser: false, user: {} }), {
    isEndUser: false,
    companyId: null,
  });
  assert.deepEqual(deviceViewer(undefined), {
    isEndUser: false,
    companyId: null,
  });
});

test("device card: a client sees only own-company devices, staff sees all", () => {
  const populated = { companyId: { _id: new mongoose.Types.ObjectId(OWN), alias: "Своя" } };
  const raw = { companyId: new mongoose.Types.ObjectId(OWN) };
  const foreign = { companyId: new mongoose.Types.ObjectId(FOREIGN) };
  const orphan = { companyId: null };

  assert.equal(deviceVisibleTo(client, populated), true);
  assert.equal(deviceVisibleTo(client, raw), true);
  assert.equal(deviceVisibleTo(client, foreign), false);
  assert.equal(deviceVisibleTo(client, orphan), false);
  assert.equal(deviceVisibleTo(staff, foreign), true);
  assert.equal(deviceVisibleTo(staff, orphan), true);
});

test("device card: a client without a company sees nothing, not company-less devices", () => {
  const homeless = { isEndUser: true, companyId: null };
  assert.equal(deviceVisibleTo(homeless, { companyId: null }), false);
  assert.equal(deviceVisibleTo(homeless, {}), false);
});

test("attachable: a client may ask only for their own company", () => {
  assert.equal(attachableCompanyId(client, OWN), OWN);
  assert.equal(attachableCompanyId(client, ` ${OWN.toUpperCase()} `), OWN);
  assert.equal(attachableCompanyId(client, FOREIGN), null);
  assert.equal(
    attachableCompanyId({ isEndUser: true, companyId: null }, OWN),
    null,
  );
});

test("attachable: staff may ask for any company, but only a single real id", () => {
  assert.equal(attachableCompanyId(staff, FOREIGN), FOREIGN);
  for (const bad of [undefined, "", "abc", [OWN, FOREIGN], { $ne: null }, 42]) {
    assert.equal(attachableCompanyId(staff, bad), null);
    assert.equal(attachableCompanyId(client, bad), null);
  }
});

test("device tickets: the device condition is ANDed with the ticket scope", () => {
  const deviceId = new mongoose.Types.ObjectId();
  const scope = { $or: [{ applicantId: "u1" }, { createdBy: "u1" }] };

  assert.deepEqual(deviceTicketsFilter(deviceId, scope), {
    $and: [{ relatedClientDeviceId: deviceId }, scope],
  });
  assert.deepEqual(deviceTicketsFilter(deviceId, {}), {
    $and: [{ relatedClientDeviceId: deviceId }, {}],
  });

  const tickets = [
    { num: 1, relatedClientDeviceId: "d1", applicantId: "u1" },
    { num: 2, relatedClientDeviceId: "d1", applicantId: "u2" },
    { num: 3, relatedClientDeviceId: "d2", applicantId: "u1" },
  ];
  const nums = (filter) => tickets.filter(sift(filter)).map((t) => t.num);
  assert.deepEqual(nums(deviceTicketsFilter("d1", scope)), [1]);
  assert.deepEqual(nums(deviceTicketsFilter("d1", {})), [1, 2]);
});

test("device scope match: null scope is unrestricted, a list restricts", () => {
  assert.deepEqual(deviceScopeMatch(null), {});
  assert.deepEqual(deviceScopeMatch([]), { companyId: { $in: [] } });

  // Идентификаторы в условии — ObjectId (см. следующий тест), значение то же
  const { companyId } = deviceScopeMatch([OWN]);
  assert.equal(companyId.$in.length, 1);
  assert.ok(companyId.$in[0] instanceof mongoose.Types.ObjectId);
  assert.equal(companyId.$in[0].toHexString(), OWN);
});

test("device scope match: ids are ObjectIds, because aggregate() does not cast", () => {
  // companyScope отдаёт строки. find Mongoose приводит их к ObjectId, а
  // конвейер aggregate — нет: строка в $match не совпадёт с ObjectId в базе, и
  // клиент видел бы нулевые счётчики техники во вложенных расположениях
  const ids = (scope) => deviceScopeMatch(scope).companyId.$in;

  for (const id of ids([OWN, FOREIGN])) {
    assert.ok(id instanceof mongoose.Types.ObjectId);
  }
  assert.deepEqual(ids([OWN, FOREIGN]).map(String), [OWN, FOREIGN]);

  // Готовый ObjectId остаётся ObjectId с тем же значением
  const [kept] = ids([new mongoose.Types.ObjectId(OWN)]);
  assert.ok(kept instanceof mongoose.Types.ObjectId);
  assert.equal(kept.toHexString(), OWN);
});

test("user tech: both queries carry the company scope", () => {
  const devices = [
    { id: "personal", userId: "u1", locationId: "elsewhere", companyId: OWN },
    { id: "desk", userId: null, locationId: "wp", companyId: OWN },
    { id: "foreign-desk", userId: null, locationId: "wp", companyId: FOREIGN },
    { id: "room", userId: null, locationId: "room", companyId: OWN },
    { id: "foreign-room", userId: null, locationId: "room", companyId: FOREIGN },
    { id: "part", userId: "u1", locationId: "wp", companyId: OWN, parentDeviceId: "desk" },
    { id: "deleted", userId: "u1", locationId: "wp", companyId: OWN, deletedAt: new Date() },
  ];
  const ids = (filter) => devices.filter(sift(filter)).map((d) => d.id);

  const scoped = userTechQueries({
    userId: "u1",
    workplaceId: "wp",
    parentId: "room",
    scope: [OWN],
  });
  assert.deepEqual(ids(scoped.own), ["personal", "desk"]);
  assert.deepEqual(ids(scoped.parent), ["room"]);

  const unscoped = userTechQueries({
    userId: "u1",
    workplaceId: "wp",
    parentId: "room",
    scope: null,
  });
  assert.deepEqual(ids(unscoped.own), ["personal", "desk", "foreign-desk"]);
  assert.deepEqual(ids(unscoped.parent), ["room", "foreign-room"]);

  // Клиент без компании: companyScope отдаёт [] — не видно ничего
  const homeless = userTechQueries({
    userId: "u1",
    workplaceId: "wp",
    parentId: "room",
    scope: [],
  });
  assert.deepEqual(ids(homeless.own), []);
  assert.deepEqual(ids(homeless.parent), []);
});

test("user tech: no workplace means personal devices only and no parent query", () => {
  const queries = userTechQueries({ userId: "u1", scope: [OWN] });
  assert.deepEqual(queries.own, {
    deletedAt: null,
    parentDeviceId: null,
    companyId: { $in: [new mongoose.Types.ObjectId(OWN)] },
    $or: [{ userId: "u1" }],
  });
  assert.equal(queries.parent, null);
});

test("viewer scope: staff unrestricted, a client locked to the own company, a homeless client sees nothing", () => {
  assert.equal(viewerScope(staff), null);
  assert.equal(viewerScope(undefined), null);
  assert.deepEqual(viewerScope(client), [OWN]);
  assert.deepEqual(
    viewerScope({
      isEndUser: true,
      companyId: new mongoose.Types.ObjectId(OWN),
    }),
    [OWN],
  );
  assert.deepEqual(viewerScope({ isEndUser: true, companyId: null }), []);
});

test("components: a client gets only the parts of the own company, staff get all", () => {
  const parts = [
    { id: "own", parentDeviceId: "host", deletedAt: null, companyId: OWN },
    {
      id: "foreign",
      parentDeviceId: "host",
      deletedAt: null,
      companyId: FOREIGN,
    },
    { id: "company-less", parentDeviceId: "host", companyId: null },
    {
      id: "deleted",
      parentDeviceId: "host",
      deletedAt: new Date(),
      companyId: OWN,
    },
    {
      id: "other-host",
      parentDeviceId: "other",
      deletedAt: null,
      companyId: OWN,
    },
  ];
  const ids = (filter) => parts.filter(sift(filter)).map((part) => part.id);

  assert.deepEqual(ids(deviceComponentsFilter(client, "host")), ["own"]);
  assert.deepEqual(ids(deviceComponentsFilter(staff, "host")), [
    "own",
    "foreign",
    "company-less",
  ]);
  assert.deepEqual(
    ids(deviceComponentsFilter({ isEndUser: true, companyId: null }, "host")),
    [],
  );

  // Условие по нескольким хозяевам — счётчик комплектующих в строках списка
  assert.deepEqual(
    ids(deviceComponentsFilter(client, { $in: ["host", "other"] })),
    ["own", "other-host"],
  );
  // Для сотрудника условие только про хозяина и «не удалено»
  assert.deepEqual(deviceComponentsFilter(staff, "host"), {
    deletedAt: null,
    parentDeviceId: "host",
  });
});

test("host of a component: a client sees only an own-company host, staff see any", () => {
  const own = { _id: "h1", companyId: new mongoose.Types.ObjectId(OWN) };
  const foreign = {
    _id: "h2",
    companyId: new mongoose.Types.ObjectId(FOREIGN),
  };

  assert.equal(visibleHost(client, own), own);
  assert.equal(visibleHost(client, foreign), null);
  assert.equal(visibleHost(staff, foreign), foreign);

  // Компания хозяина неизвестна (поле не выбрано) — принадлежность недоказуема
  assert.equal(visibleHost(client, { _id: "h3" }), null);
  assert.equal(visibleHost({ isEndUser: true, companyId: null }, own), null);

  // У устройства без хозяина отвечать нечем: значение не меняется
  assert.equal(visibleHost(client, undefined), undefined);
  assert.equal(visibleHost(client, null), null);
});
