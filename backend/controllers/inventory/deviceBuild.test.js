// node --test controllers/inventory/deviceBuild.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
mongoose.set("bufferCommands", false);

const {
  parseBuildParts,
  resolvePartConfiguration,
} = require("./deviceBuild");

const CPU = "aaaaaaaaaaaaaaaaaaaaaaa1";
const RAM = "aaaaaaaaaaaaaaaaaaaaaaa2";
const SSD = "aaaaaaaaaaaaaaaaaaaaaaa3";
const M1 = "bbbbbbbbbbbbbbbbbbbbbbb1";
const M2 = "bbbbbbbbbbbbbbbbbbbbbbb2";
const C1 = "cccccccccccccccccccccc01";

const slots = [
  { typeId: CPU, typeName: "Процессор", required: true, multiple: false },
  { typeId: RAM, typeName: "Память", required: true, multiple: true },
  { typeId: SSD, typeName: "Накопитель", required: false, multiple: true },
];

test("валидная сборка проходит, quantity по умолчанию 1", () => {
  const res = parseBuildParts(
    [
      { typeId: CPU, deviceModelId: M1 },
      { typeId: RAM, deviceModelId: M2, configurationId: C1, quantity: 2 },
    ],
    slots,
  );
  assert.ifError(res.error);
  assert.equal(res.parts.length, 2);
  assert.equal(res.parts[0].quantity, 1);
  assert.equal(res.parts[0].configurationId, null);
  assert.equal(res.parts[1].quantity, 2);
  assert.equal(res.parts[1].configurationId, C1);
});

test("деталь вне слотов — ошибка", () => {
  const res = parseBuildParts(
    [
      { typeId: CPU, deviceModelId: M1 },
      { typeId: RAM, deviceModelId: M2 },
      { typeId: "dddddddddddddddddddddddd", deviceModelId: M2 },
    ],
    slots,
  );
  assert.ok(res.error);
});

test("две детали в слоте без multiple — ошибка", () => {
  const res = parseBuildParts(
    [
      { typeId: CPU, deviceModelId: M1 },
      { typeId: CPU, deviceModelId: M2 },
      { typeId: RAM, deviceModelId: M2 },
    ],
    slots,
  );
  assert.ok(res.error);
});

test("quantity 2 в слоте без multiple — ошибка", () => {
  const res = parseBuildParts(
    [
      { typeId: CPU, deviceModelId: M1, quantity: 2 },
      { typeId: RAM, deviceModelId: M2 },
    ],
    slots,
  );
  assert.ok(res.error);
});

test("quantity 0, дробное и нечисловое — ошибка", () => {
  for (const quantity of [0, -1, 1.5, "x"]) {
    const res = parseBuildParts(
      [
        { typeId: CPU, deviceModelId: M1 },
        { typeId: RAM, deviceModelId: M2, quantity },
      ],
      slots,
    );
    assert.ok(res.error, `quantity=${quantity}`);
  }
});

test("пропущенные обязательные слоты названы в ошибке", () => {
  const res = parseBuildParts([{ typeId: SSD, deviceModelId: M1 }], slots);
  assert.match(res.error, /Не заполнено: Процессор, Память/);
});

test("деталь без модели — ошибка", () => {
  const res = parseBuildParts(
    [{ typeId: CPU }, { typeId: RAM, deviceModelId: M2 }],
    slots,
  );
  assert.ok(res.error);
});

test("порядок: по слотам, внутри слота — как прислано", () => {
  const res = parseBuildParts(
    [
      { typeId: SSD, deviceModelId: M2 },
      { typeId: RAM, deviceModelId: M1 },
      { typeId: CPU, deviceModelId: M1 },
      { typeId: SSD, deviceModelId: M1 },
    ],
    slots,
  );
  assert.ifError(res.error);
  assert.deepEqual(
    res.parts.map((p) => [p.typeId, p.deviceModelId]),
    [
      [CPU, M1],
      [RAM, M1],
      [SSD, M2],
      [SSD, M1],
    ],
  );
});

test("parts не массив — ошибка", () => {
  assert.ok(parseBuildParts(null, slots).error);
});

// ── Конфигурация детали ──
const model = { name: "NV3 500 ГБ", vendorId: { name: "Kingston" } };
const C2 = "cccccccccccccccccccccc02";

test("конфигурация: единственная подставляется сама", () => {
  const res = resolvePartConfiguration(model, [{ _id: C1 }], null);
  assert.ifError(res.error);
  assert.equal(res.configurationId, C1);
});

test("конфигурация: у модели без конфигураций — null", () => {
  const res = resolvePartConfiguration(model, [], null);
  assert.ifError(res.error);
  assert.equal(res.configurationId, null);
});

test("конфигурация: из нескольких не выбрана — ошибка с именем модели", () => {
  const res = resolvePartConfiguration(model, [{ _id: C1 }, { _id: C2 }], null);
  assert.equal(res.error, "Выберите конфигурацию модели «Kingston NV3 500 ГБ»");
});

test("конфигурация: из нескольких выбрана своя — проходит", () => {
  const res = resolvePartConfiguration(model, [{ _id: C1 }, { _id: C2 }], C2);
  assert.ifError(res.error);
  assert.equal(res.configurationId, C2);
});

test("конфигурация: чужая — ошибка", () => {
  const res = resolvePartConfiguration(model, [{ _id: C1 }], C2);
  assert.equal(res.error, "Конфигурация не принадлежит модели «Kingston NV3 500 ГБ»");
});

// --- Обработчики на подставных моделях (без Mongo) --------------------------

const DeviceBuild = require("@/models/inventory/deviceBuild");
const DeviceType = require("@/models/inventory/deviceType");
const DeviceModel = require("@/models/inventory/deviceModel");
const DeviceConfiguration = require("@/models/inventory/deviceConfiguration");
const controller = require("./deviceBuild");

// Цепочка запроса Mongoose: populate/select/sort → lean или await
const chain = (value) => {
  const c = {
    populate: () => c,
    select: () => c,
    sort: () => c,
    lean: async () => value,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return c;
};

const call = async (handler, req) => {
  let error = null;
  const res = {
    status(code) {
      res.code = code;
      return res;
    },
    json(body) {
      res.body = body;
    },
    end() {},
  };
  await handler({ userId: "u1", params: {}, body: {}, ...req }, res, (e) => {
    error = e;
  });
  return { res, error };
};

test("getOne/update/delete: кривой id — 404, в базу не ходим", async (t) => {
  t.mock.method(DeviceBuild, "findOne", () => {
    throw new Error("в базу ходить не должны");
  });
  for (const name of ["getOne", "update", "delete"]) {
    const { error } = await call(controller[name], { params: { id: "nope" } });
    assert.equal(error?.statusCode, 404, name);
  }
});

test("add: у типа без слотов — 400 «У типа не заданы комплектующие»", async (t) => {
  t.mock.method(DeviceType, "findById", () =>
    chain({ _id: CPU, name: "Системный блок", assembly: { enabled: true, slots: [] } }),
  );
  t.mock.method(DeviceBuild, "create", () => {
    throw new Error("создавать не должны");
  });
  const { error } = await call(controller.add, {
    body: { deviceTypeId: CPU, name: "Сборка", parts: [] },
  });
  assert.equal(error?.statusCode, 400);
  assert.equal(error.message, "У типа не заданы комплектующие");
});

test("add: модель детали не найдена — ошибка называет слот", async (t) => {
  t.mock.method(DeviceType, "findById", () =>
    chain({
      _id: "dddddddddddddddddddddd01",
      name: "Системный блок",
      assembly: {
        enabled: true,
        slots: [{ typeId: { _id: CPU, name: "Процессор" }, required: true }],
      },
    }),
  );
  t.mock.method(DeviceType, "find", () => chain([{ _id: CPU, name: "Процессор" }]));
  t.mock.method(DeviceModel, "find", () => chain([]));
  t.mock.method(DeviceConfiguration, "find", () => chain([]));
  const { error } = await call(controller.add, {
    body: {
      deviceTypeId: "dddddddddddddddddddddd01",
      name: "Сборка",
      parts: [{ typeId: CPU, deviceModelId: M1 }],
    },
  });
  assert.equal(error?.statusCode, 400);
  assert.equal(error.message, "Модель в слоте «Процессор» не найдена или удалена");
});
