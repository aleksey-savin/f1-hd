// node --test models/counter.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const MODELS = ["Counter", "Ticket", "MikrotikChange"];
const reset = () => {
  for (const name of MODELS) {
    delete mongoose.models[name];
    delete mongoose.connection.models[name];
  }
};

// Свежий кэш модулей; initCounter из ticket.js ходит в базу, которой в тесте нет,
// поэтому поиск счётчика на свежей модели подменяем (модель после теста
// выбрасывается, подмена не утекает)
const dropModules = () => {
  for (const key of Object.keys(require.cache)) {
    if (/[\\/]models[\\/](ticket|mikrotikChange|counter)\.js$/.test(key)) delete require.cache[key];
  }
};
const load = (names) => {
  dropModules();
  reset();
  const Counter = require("./counter");
  Counter.findById = async () => ({ _id: "ticketNum", seq: 1 });
  for (const name of names) require(name);
};

test("загрузка mikrotikChange и ticket в любом порядке не бросает", async () => {
  try {
    assert.doesNotThrow(() => load(["./mikrotikChange", "./ticket"]));
    // дать initCounter отработать до сброса моделей
    await new Promise((resolve) => setImmediate(resolve));
    assert.doesNotThrow(() => load(["./ticket", "./mikrotikChange"]));
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(mongoose.models.Counter);
  } finally {
    // подменённая модель не остаётся ни в реестре mongoose, ни в кэше модулей
    reset();
    dropModules();
  }
});
