// node --test controllers/inventory/deviceTypeAssembly.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
mongoose.set("bufferCommands", false);

const { parseAssembly, buildsWord } = require("./deviceType");

const CPU = "6a28ed8f6d333b3a785274e1";
const RAM = "6a28ed8f6d333b3a785274e2";
const HOST = "6a28ed8f6d333b3a785274e3";
const A_NAME = "6a28ed8f6d333b3a785274f1";
const A_SIZE = "6a28ed8f6d333b3a785274f2";

const ctx = () => ({
  componentTypeIds: new Set([CPU, RAM]),
  attributeIdsByType: new Map([
    [CPU, new Set([A_NAME])],
    [RAM, new Set([A_SIZE])],
  ]),
  valueTypeById: new Map([
    [A_NAME, "string"],
    [A_SIZE, "number"],
  ]),
});

test("валидный набор проходит, порядок сохранён", () => {
  const out = parseAssembly(
    {
      slots: [
        { typeId: RAM, required: false, multiple: true },
        { typeId: CPU, required: true, multiple: false },
      ],
      keySpecs: [
        { typeId: RAM, source: "attribute", attributeId: A_SIZE, aggregate: "sum" },
        { typeId: CPU, source: "model", aggregate: "first" },
      ],
    },
    ctx(),
  );
  assert.equal(out.error, undefined);
  assert.deepEqual(out.slots.map((s) => s.typeId), [RAM, CPU]);
  assert.deepEqual(out.slots.map((s) => [s.required, s.multiple]), [
    [false, true],
    [true, false],
  ]);
  assert.deepEqual(out.keySpecs.map((k) => k.typeId), [RAM, CPU]);
});

test("пустые массивы — валидно", () => {
  assert.deepEqual(parseAssembly({ slots: [], keySpecs: [] }, ctx()), {
    slots: [],
    keySpecs: [],
  });
});

test("тип не-комплектующая — ошибка", () => {
  assert.ok(parseAssembly({ slots: [{ typeId: HOST }], keySpecs: [] }, ctx()).error);
});

test("повтор слота — ошибка", () => {
  assert.ok(
    parseAssembly({ slots: [{ typeId: CPU }, { typeId: CPU }], keySpecs: [] }, ctx()).error,
  );
});

test("keySpec с типом не из слотов — ошибка", () => {
  assert.ok(
    parseAssembly(
      { slots: [{ typeId: CPU }], keySpecs: [{ typeId: RAM, source: "model", aggregate: "first" }] },
      ctx(),
    ).error,
  );
});

test("attribute без связки у типа — ошибка", () => {
  assert.ok(
    parseAssembly(
      {
        slots: [{ typeId: CPU }],
        keySpecs: [{ typeId: CPU, source: "attribute", attributeId: A_SIZE, aggregate: "first" }],
      },
      ctx(),
    ).error,
  );
});

test("sum по не-числу — ошибка", () => {
  assert.ok(
    parseAssembly(
      {
        slots: [{ typeId: CPU }],
        keySpecs: [{ typeId: CPU, source: "attribute", attributeId: A_NAME, aggregate: "sum" }],
      },
      ctx(),
    ).error,
  );
});

test("model с attributeId нормализуется в null; неверный aggregate/source — ошибка", () => {
  const out = parseAssembly(
    {
      slots: [{ typeId: CPU }],
      keySpecs: [{ typeId: CPU, source: "model", attributeId: A_NAME, aggregate: "list" }],
    },
    ctx(),
  );
  assert.equal(out.keySpecs[0].attributeId, null);
  const bad = (k) =>
    parseAssembly({ slots: [{ typeId: CPU }], keySpecs: [k] }, ctx()).error;
  assert.ok(bad({ typeId: CPU, source: "model", aggregate: "avg" }));
  assert.ok(bad({ typeId: CPU, source: "x", aggregate: "first" }));
});

test("не-массивы — ошибка", () => {
  assert.ok(parseAssembly({ slots: {}, keySpecs: [] }, ctx()).error);
  assert.ok(parseAssembly({ slots: [], keySpecs: "x" }, ctx()).error);
});

test("склонение «сборка»", () => {
  assert.equal(buildsWord(1), "1 сборка");
  assert.equal(buildsWord(2), "2 сборки");
  assert.equal(buildsWord(5), "5 сборок");
  assert.equal(buildsWord(11), "11 сборок");
  assert.equal(buildsWord(21), "21 сборка");
});

// --- delete на подставных моделях (без Mongo) -------------------------------

const DeviceType = require("@/models/inventory/deviceType");
const DeviceModel = require("@/models/inventory/deviceModel");
const DeviceBuild = require("@/models/inventory/deviceBuild");
const DeviceTypeAttribute = require("@/models/inventory/deviceTypeAttribute");
const controller = require("./deviceType");

const chain = (value) => {
  const c = {
    select: () => c,
    lean: async () => value,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return c;
};

const callDelete = async () => {
  let error = null;
  const res = { status: () => res, end() {} };
  await controller.delete({ params: { id: CPU } }, res, (e) => {
    error = e;
  });
  return error;
};

const stubDelete = (t, { host, builds }) => {
  t.mock.method(DeviceType, "findById", async () => ({ _id: CPU, name: "Процессор" }));
  t.mock.method(DeviceModel, "find", async () => []);
  t.mock.method(DeviceType, "findOne", () => chain(host));
  t.mock.method(DeviceBuild, "countDocuments", async () => builds);
  t.mock.method(DeviceTypeAttribute, "deleteMany", () => {
    throw new Error("удалять не должны");
  });
  t.mock.method(DeviceType, "deleteOne", () => {
    throw new Error("удалять не должны");
  });
};

test("delete: тип в слоте/ключевой характеристике чужой сборки — 409 с именем", async (t) => {
  stubDelete(t, { host: { name: "Системный блок" }, builds: 0 });
  const error = await callDelete();
  assert.equal(error?.statusCode, 409);
  assert.equal(error.message, "Тип используется в своей сборке «Системный блок»");
});

test("delete: у типа есть сборки — 409", async (t) => {
  stubDelete(t, { host: null, builds: 2 });
  const error = await callDelete();
  assert.equal(error?.statusCode, 409);
  assert.equal(error.message, "У типа есть сборки");
});

test("ключевая характеристика — атрибут уровня устройства: отказ", () => {
  const withDevice = { ...ctx(), deviceAttributeIds: new Set([A_SIZE]) };
  const out = parseAssembly(
    {
      slots: [{ typeId: RAM, required: false, multiple: true }],
      keySpecs: [{ typeId: RAM, source: "attribute", attributeId: A_SIZE, aggregate: "first" }],
    },
    withDevice,
  );
  assert.equal(out.error, "Ключевая характеристика не может быть атрибутом устройства");
});
