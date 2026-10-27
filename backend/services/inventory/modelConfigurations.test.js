// node --test services/inventory/modelConfigurations.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
// Базы нет: забытая подмена падает сразу, а не висит в буфере
mongoose.set("bufferCommands", false);

const {
  soleConfiguration,
  multiConfigOffError,
  configAddError,
  configDeleteError,
  agentConfigurationMode,
  modelWriteFromBody,
  configurationForDevice,
  planModelConfigMigration,
  modeChangeError,
  relinkDevicesTo,
} = require("./modelConfigurations");

const C1 = { _id: "cccccccccccccccccccccc01", values: [] };
const C2 = { _id: "cccccccccccccccccccccc02", values: [] };
const A1 = "aaaaaaaaaaaaaaaaaaaaaaa1";

test("soleConfiguration: одна живая и не multi — она", () => {
  assert.equal(soleConfiguration({ multiConfig: false }, [C1]), C1);
});

test("soleConfiguration: multi или не ровно одна — null", () => {
  assert.equal(soleConfiguration({ multiConfig: true }, [C1]), null);
  assert.equal(soleConfiguration({}, []), null);
  // Модель с двумя до миграции (флаг ещё false) — не «единственная»
  assert.equal(soleConfiguration({}, [C1, C2]), null);
});

test("multiConfigOffError: выключить можно только при одной", () => {
  assert.equal(multiConfigOffError(1), null);
  assert.equal(
    multiConfigOffError(2),
    "Чтобы выключить «Несколько конфигураций», оставьте одну конфигурацию",
  );
});

test("configAddError / configDeleteError", () => {
  assert.equal(configAddError({ multiConfig: true }), null);
  assert.match(configAddError({ multiConfig: false }), /Включите «Несколько конфигураций»/);
  assert.equal(configDeleteError(2), null);
  assert.equal(configDeleteError(1), "Последнюю конфигурацию модели удалить нельзя");
});

test("agentConfigurationMode", () => {
  assert.equal(agentConfigurationMode({}, [{ _id: "c", values: [] }]), "fill");
  assert.equal(
    agentConfigurationMode({}, [{ _id: "c", values: [{ attributeId: "a", value: "1" }] }]),
    "add",
  );
  assert.equal(agentConfigurationMode({ multiConfig: true }, [{ _id: "c", values: [] }]), "add");
  // Модель до миграции без конфигураций — создать, а не падать
  assert.equal(agentConfigurationMode({}, []), "create");
});

test("modelWriteFromBody: создание пишет значения и при включённом переключателе", () => {
  const values = [{ attributeId: A1, value: "8" }];
  // Включили переключатель, уже заполнив поля, — значения станут первой конфигурацией
  assert.deepEqual(modelWriteFromBody({ values }, { creating: true, multiConfig: true }), { values });
  assert.deepEqual(modelWriteFromBody({}, { creating: true, multiConfig: false }), { values: [] });
});

test("modelWriteFromBody: правка в режиме нескольких значения не трогает", () => {
  assert.deepEqual(
    modelWriteFromBody({ values: [] }, { creating: false, multiConfig: true, wasMulti: true }),
    { values: undefined },
  );
  assert.deepEqual(modelWriteFromBody({}, { creating: false, multiConfig: false }), {
    values: undefined,
  });
  const values = [{ attributeId: A1, value: "8" }];
  assert.deepEqual(modelWriteFromBody({ values }, { creating: false, multiConfig: false }), { values });
});

test("configurationForDevice: присланная важнее", () => {
  assert.equal(configurationForDevice(C1._id, C2._id), C1._id);
});

test("configurationForDevice: не прислана — единственная модели (смена модели)", () => {
  assert.equal(configurationForDevice(undefined, C2._id), C2._id);
  assert.equal(configurationForDevice(undefined, null), undefined);
});

const M1 = "bbbbbbbbbbbbbbbbbbbbbbb1";
const M2 = "bbbbbbbbbbbbbbbbbbbbbbb2";
const M3 = "bbbbbbbbbbbbbbbbbbbbbbb3";
const D1 = "ddddddddddddddddddddddd1";
const D2 = "ddddddddddddddddddddddd2";
const D3 = "ddddddddddddddddddddddd3";
const cfg = (id, model, day) => ({ _id: id, deviceModelId: model, createdAt: new Date(`2026-10-0${day}`) });

test("planModelConfigMigration: без конфигураций — создать, устройства ждут второго прохода", () => {
  const plan = planModelConfigMigration({
    models: [{ _id: M1 }],
    configs: [],
    devices: [{ _id: D1, deviceModelId: M1 }],
  });
  assert.deepEqual(plan, { createFor: [M1], multiOn: [], link: [] });
});

test("planModelConfigMigration: одна конфигурация — устройства привязываются к ней", () => {
  const plan = planModelConfigMigration({
    models: [{ _id: M1 }],
    configs: [cfg("c1", M1, 1)],
    devices: [{ _id: D1, deviceModelId: M1 }],
  });
  assert.deepEqual(plan, { createFor: [], multiOn: [], link: [{ deviceId: D1, configurationId: "c1" }] });
});

test("planModelConfigMigration: две — режим нескольких, устройства не трогаются", () => {
  const plan = planModelConfigMigration({
    models: [{ _id: M2 }],
    configs: [cfg("c2", M2, 2), cfg("c1", M2, 1)],
    devices: [{ _id: D2, deviceModelId: M2 }],
  });
  assert.deepEqual(plan, { createFor: [], multiOn: [M2], link: [] });
});

test("planModelConfigMigration: повторный прогон после применения — делать нечего", () => {
  const plan = planModelConfigMigration({
    models: [{ _id: M1 }, { _id: M2, multiConfig: true }, { _id: M3 }],
    configs: [cfg("c1", M1, 1), cfg("c2", M2, 2), cfg("c3", M2, 3), cfg("c4", M3, 4)],
    // Привязанные устройства в план не приходят; у multi-модели — остаётся без
    devices: [{ _id: D3, deviceModelId: M2 }],
  });
  assert.deepEqual(plan, { createFor: [], multiOn: [], link: [] });
});

test("planModelConfigMigration: id сравниваются строкой, устройство удалённой модели пропускается", () => {
  const plan = planModelConfigMigration({
    models: [{ _id: { toString: () => M1 } }],
    configs: [cfg("c1", { toString: () => M1 }, 1)],
    devices: [
      { _id: D1, deviceModelId: { toString: () => M1 } },
      { _id: D2, deviceModelId: "bbbbbbbbbbbbbbbbbbbbbbb9" },
    ],
  });
  assert.deepEqual(plan.link, [{ deviceId: D1, configurationId: "c1" }]);
});

test("modelWriteFromBody: правка — включили режим в форме, уже поправив поля: правки пишутся", () => {
  const values = [{ attributeId: A1, value: "16" }];
  assert.deepEqual(
    modelWriteFromBody({ values }, { creating: false, multiConfig: true, wasMulti: false }),
    { values },
  );
  // Уже был в режиме нескольких — поля скрыты, значения не трогаются
  assert.deepEqual(
    modelWriteFromBody({ values }, { creating: false, multiConfig: true, wasMulti: true }),
    { values: undefined },
  );
});

test("modeChangeError: вне режима нескольких при двух и больше — отказ при любом сохранении", () => {
  assert.equal(modeChangeError(false, 1), null);
  assert.equal(modeChangeError(true, 3), null);
  // Флаг уже false, конфигураций две (до миграции) — не только переход true→false
  assert.equal(
    modeChangeError(false, 2),
    "Чтобы выключить «Несколько конфигураций», оставьте одну конфигурацию",
  );
});

test("relinkDevicesTo: модель вне режима нескольких с одной — к ней, иначе null", () => {
  assert.equal(relinkDevicesTo(false, [C1]), C1);
  assert.equal(relinkDevicesTo(true, [C1]), null);
  assert.equal(relinkDevicesTo(false, [C1, C2]), null);
  assert.equal(relinkDevicesTo(false, []), null);
});
