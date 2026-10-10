// node --test models/mikrotikChange.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const MikrotikChange = require("./mikrotikChange");
const { STATUS } = require("@/services/mikrotik/changeSteps");

// Проверка документа без базы: undefined — валиден, иначе ошибка валидации
const check = (doc) => doc.validate().then(() => undefined, (error) => error);

const valid = () => ({
  number: 1,
  mikrotik: new mongoose.Types.ObjectId(),
  requestedBy: new mongoose.Types.ObjectId(),
  status: STATUS.awaitingRequester,
});

test("минимальный документ валиден", async () => {
  assert.equal(await check(new MikrotikChange(valid())), undefined);
});

test("неизвестный status не проходит", async () => {
  const error = await check(new MikrotikChange({ ...valid(), status: "nope" }));
  assert.ok(error.errors.status);
});

test("все статусы из changeSteps проходят", async () => {
  for (const status of Object.values(STATUS)) {
    assert.equal(await check(new MikrotikChange({ ...valid(), status })), undefined, status);
  }
});

test("number, mikrotik и requestedBy обязательны", async () => {
  const error = await check(new MikrotikChange({ status: STATUS.queued }));
  for (const field of ["number", "mikrotik", "requestedBy"]) assert.ok(error.errors[field], field);
});

test("ключи WireGuard не отдаются запросами", async () => {
  assert.equal(MikrotikChange.schema.path("wireguard.privateKey").options.select, false);
  assert.equal(MikrotikChange.schema.path("wireguard.presharedKey").options.select, false);
});

test("неизвестное result.state команды не проходит", async () => {
  const bad = await check(new MikrotikChange({
    ...valid(),
    commands: [{ path: "/ip/address", action: "add", result: { state: "weird" } }],
  }));
  assert.ok(bad.errors["commands.0.result.state"]);
  const ok = await check(new MikrotikChange({
    ...valid(),
    commands: [{ path: "/ip/address", action: "add", result: { state: "done" } }],
  }));
  assert.equal(ok, undefined);
});

test("nextMikrotikChangeNumber — статический метод", async () => {
  assert.equal(typeof MikrotikChange.nextMikrotikChangeNumber, "function");
});

test("шаг без решения (decision: null) валиден, неизвестное решение — нет", async () => {
  const step = (decision) => check(new MikrotikChange({ ...valid(), steps: [{ role: "requester", decision }] }));
  assert.equal(await step(null), undefined);
  assert.ok((await step("maybe")).errors["steps.0.decision"]);
});

// --- финальная волна

test("результат команды хранит признак отказа роутера; поля telegram[] у модели нет", async () => {
  const doc = new MikrotikChange({
    ...valid(),
    commands: [{ path: "/ip/address", action: "add", result: { state: "failed", error: "failure: x", refused: true } }],
    telegram: [{ chatId: "1", messageId: 2 }],
  });
  assert.equal(await check(doc), undefined);
  assert.equal(doc.toObject().commands[0].result.refused, true);
  assert.equal(MikrotikChange.schema.path("telegram"), undefined);
  assert.equal(doc.toObject().telegram, undefined);
});

test("запрос без клиента WireGuard не получает wireguard.client из пустых массивов", async () => {
  const doc = new MikrotikChange(valid());
  assert.equal(doc.toObject().wireguard, undefined);
  const wg = new MikrotikChange({ ...valid(), wireguard: { client: { interface: "wg0", address: "10.0.0.2/32", allowedIps: ["10.0.0.0/24"] } } });
  assert.deepEqual(wg.toObject().wireguard.client.allowedIps, ["10.0.0.0/24"]);
});
