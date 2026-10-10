// node --test routes/internal/inventory/mikrotikChange.routes.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const router = require("./mikrotik");
const permissions = require("@/middleware/permissions");

const stack = (router._router || router.router || router).stack;
const route = (method, path) =>
  stack.find((l) => l.route && l.route.path === path && l.route.methods[method])?.route;
const handlers = (r) => r.stack.map((l) => l.handle);

test("маршруты запросов: без порога «читать Mikrotik» — его заменяет проверка в ручках", () => {
  const read = new Set(permissions.canReadMikrotik.slice(1)); // [requireAuth, проверка права]
  for (const [method, path] of [
    ["get", "/mikrotik-changes/awaiting-me"],
    ["get", "/mikrotik-changes/:id"],
    ["post", "/mikrotik-changes/:id/decision"],
    ["post", "/mikrotik-changes/:id/cancel"],
    ["get", "/mikrotik-changes/:id/wireguard.conf"],
  ]) {
    const r = route(method, path);
    assert.ok(r, path);
    assert.ok(!handlers(r).some((h) => read.has(h)), path);
  }
});

test("список по записи остаётся под правом читать Mikrotik", () => {
  const read = new Set(permissions.canReadMikrotik.slice(1)); // [requireAuth, проверка права]
  const r = route("get", "/mikrotik-devices/records/:recordId/changes");
  assert.ok(handlers(r).some((h) => read.has(h)));
});
