// node --test routes/inventoryMount.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { mountInventory } = require("./inventoryMount");

/**
 * Проверяется ровно одно, но дорого стоившее свойство монтирования `/inventory`:
 * запрос спрашивает права ТОЛЬКО того под-роутера, который его обслужит.
 *
 * Раньше каждый `use("/inventory", гейт, роутер)` клал гейт отдельным слоем на
 * общий префикс, и справочник производителей требовал «видеть технику» и
 * «видеть Mikrotik» — права, к которым он отношения не имеет.
 *
 * Настоящий `routes/index.js` здесь не поднимается намеренно: он тянет модели,
 * подключение к Mongo и алиасы `@/`. Под тестом карта «префикс → право», а она
 * живёт в `inventoryMount` и принимает гейты аргументами.
 *
 * Второе свойство — обратное: маршрут, не попавший ни под один гейт, не должен
 * уезжать в прод открытым, поэтому монтирование на нём падает.
 */

// Гейт-заглушка: помнит, что её вызвали, и пропускает дальше.
const recordingGate = (calls, name) => (req, res, next) => {
  calls.push(name);
  next();
};

const stubGates = (calls) => {
  const gates = {};
  for (const name of [
    "inventoryModuleIsActive",
    "mikrotikIsActive",
    "canReadDevices",
    "isNotClient",
    "canReadSuppliers",
    "canReadMikrotik",
  ]) {
    gates[name] = recordingGate(calls, name);
  }
  return gates;
};

// Под-роутер с одним маршрутом на своём реальном префиксе.
const subRouter = (path) => {
  const router = express.Router();
  router.get(path, (req, res) => res.json({ path }));
  return router;
};

const buildApp = (calls) => {
  const routers = [
    subRouter("/client-devices"),
    subRouter("/device-attributes"),
    subRouter("/device-configurations/:id"),
    subRouter("/device-models"),
    subRouter("/device-types"),
    subRouter("/device-type-attributes/:id"),
    subRouter("/locations"),
    subRouter("/mikrotik-devices"),
    subRouter("/suppliers"),
    subRouter("/vendors"),
  ];

  const internalRoutes = express.Router();
  mountInventory(internalRoutes, stubGates(calls), routers);

  const app = express();
  app.use("/api", internalRoutes);
  return app;
};

const get = async (path) => {
  const calls = [];
  const server = buildApp(calls).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${path}`,
    );
    return { status: response.status, calls };
  } finally {
    server.close();
  }
};

test("справочник производителей не спрашивает чужих прав", async () => {
  const { status, calls } = await get("/api/inventory/vendors");

  assert.equal(status, 200);
  assert.deepEqual(calls, ["inventoryModuleIsActive", "isNotClient"]);
  assert.ok(!calls.includes("canReadDevices"));
  assert.ok(!calls.includes("canReadMikrotik"));
  assert.ok(!calls.includes("canReadSuppliers"));
});

test("у каждого префикса свой набор гейтов", async () => {
  const inventory = "inventoryModuleIsActive";
  const cases = [
    ["/api/inventory/client-devices", [inventory, "canReadDevices"]],
    ["/api/inventory/locations", [inventory, "canReadDevices"]],
    ["/api/inventory/suppliers", [inventory, "canReadSuppliers"]],
    ["/api/inventory/device-types", [inventory, "isNotClient"]],
    // Mikrotik — без модуля «Учёт техники»: у мониторинга свой модуль.
    ["/api/inventory/mikrotik-devices", ["mikrotikIsActive", "canReadMikrotik"]],
  ];

  for (const [path, expected] of cases) {
    const { status, calls } = await get(path);
    assert.equal(status, 200, path);
    assert.deepEqual(calls, expected, path);
  }
});

test("маршрут без гейта не монтируется вовсе", () => {
  const mount = (router) =>
    mountInventory(express.Router(), stubGates([]), [router]);

  // Похожий префикс — не тот же самый.
  assert.throws(() => mount(subRouter("/locations-secret")), /locations-secret/);
  // Будущий раздел под /inventory, о котором карта прав не знает.
  assert.throws(() => mount(subRouter("/reports/devices")), /reports/);
  // Вложенный роутер: его собственный префикс из слоя express 5 не виден,
  // поэтому проверка тоже не пропускает — решение принимается явно.
  const nested = express.Router();
  nested.use("/mikrotik-devices", subRouter("/offline"));
  assert.throws(() => mount(nested), /offline/);

  // А законный префикс монтируется молча.
  assert.doesNotThrow(() => mount(subRouter("/locations/:id/node")));
});
