require("module-alias/register");
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const stub = (path, exports) => {
  const filename = require.resolve(path);
  const cached = new Module(filename);
  Object.assign(cached, { filename, loaded: true, exports });
  require.cache[filename] = cached;
};
// Only persistence and controller boundaries are replaced; permission and
// ticket-scope checks below are the production implementations.
stub("../../models/ticket", { Ticket: { async find() { return []; } } });
for (const controller of ["work", "inventory/mikrotik", "inventory/mikrotikChange", "inventory/mikrotikEvent", "inventory/mikrotikUpgrade"]) {
  stub(`../../controllers/${controller}`, new Proxy({}, { get: () => () => { throw new Error("Controller must not run in authorization test"); } }));
}
const workRouter = require("./work");
const mikrotikRouter = require("./inventory/mikrotik");
const { canReturnTicket } = require("../../middleware/permissions");
const Preferences = require("../../models/preferences");
const { Ticket } = require("../../models/ticket");

const userId = "62d0c0ed5a3314d41cc43ef3";
const otherId = "62d0c0ed5a3314d41cc43ef4";
const ticketId = "62d0c0ed5a3314d41cc43ef5";
const auth = (granted) => ({
  userId,
  isEndUser: false,
  can: (request) => Object.entries(request).every(([resource, actions]) =>
    actions.every((action) => (granted[resource] || []).includes(action))),
});
let enabled, accessible;
beforeEach((t) => {
  enabled = true;
  accessible = true;
  t.mock.method(Preferences, "findOne", async () => ({ modules: { timeTracking: { isActive: enabled } } }));
  t.mock.method(Ticket, "find", async () => [{ _id: ticketId, applicantId: accessible ? userId : otherId, responsibles: [] }]);
});

// Execute the registered authorization chain, stopping before controllers that
// persist data or contact devices. A 204 means that the request reached them.
const run = async (handlers, req) => {
  const res = { statusCode: 204, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  for (const handler of handlers) {
    let continued = false;
    let error;
    await handler(req, res, (value) => { continued = true; error = value; });
    if (error) return { statusCode: error.statusCode };
    if (!continued) return res;
  }
  return res;
};
const callRoute = (router, path, granted) => {
  const route = (router._router || router.router || router).stack.find((layer) => layer.route?.path === path && layer.route.methods.post)?.route;
  assert.ok(route, path);
  return run(route.stack.slice(0, -1).map((layer) => layer.handle), {
    auth: auth(granted), body: { tickets: [ticketId] }, params: { workId: "w1", recordId: "r1" },
  });
};

for (const [label, granted, ticket, expected] of [
  ["assigned worker without perform is denied", {}, { responsibles: [userId] }, 403],
  ["assigned worker with perform is allowed", { ticket: ["perform"] }, { responsibles: [userId] }, 204],
  ["unassigned worker with perform is denied", { ticket: ["perform"] }, { responsibles: [otherId] }, 403],
  ["applicant without permissions is allowed", {}, { applicantId: { _id: userId }, responsibles: [] }, 204],
  ["manager without perform is allowed", { ticket: ["manage"] }, { responsibles: [otherId] }, 204],
  ["archived ticket stays closed for applicant and manager", { ticket: ["manage", "perform"] }, { applicantId: userId, isArchived: true }, 403],
]) {
  test(`return ticket: ${label}`, async () => {
    assert.equal((await run([canReturnTicket], { auth: auth(granted), ticket })).statusCode, expected);
  });
}

for (const [path, write] of [
  ["/works/preview", []], ["/works/add", ["log"]], ["/works/schedule", ["log"]],
  ["/works/update/:workId", ["manage"]], ["/works/delete", ["manage"]],
]) {
  test(`${path} rejects missing work.read even with write permission`, async () => {
    assert.equal((await callRoute(workRouter, path, { work: write })).statusCode, 403);
  });
  test(`${path} rejects requests when time tracking is disabled`, async () => {
    enabled = false;
    assert.equal((await callRoute(workRouter, path, { work: ["read", ...write] })).statusCode, 403);
  });
  test(`${path} allows its authorized caller when time tracking is enabled`, async () => {
    assert.equal((await callRoute(workRouter, path, { work: ["read", ...write] })).statusCode, 204);
  });
  if (write.length) test(`${path} still requires write permission`, async () => {
    assert.equal((await callRoute(workRouter, path, { work: ["read"] })).statusCode, 403);
  });
}
for (const path of ["/works/update/:workId", "/works/delete"]) {
  test(`${path} also permits work.log without work.manage`, async () => {
    assert.equal((await callRoute(workRouter, path, { work: ["read", "log"] })).statusCode, 204);
  });
}
for (const path of ["/works/preview", "/works/add", "/works/schedule"]) {
  test(`${path} still rejects inaccessible tickets`, async () => {
    accessible = false;
    assert.equal((await callRoute(workRouter, path, { work: ["read", "log"] })).statusCode, 403);
  });
}

test("inventory sync requires both Mikrotik management and device management", async () => {
  const path = "/mikrotik-devices/records/:recordId/sync-inventory";
  for (const [granted, expected] of [
    [{ mikrotik: ["manage"] }, 403],
    [{ device: ["manage"] }, 403],
    [{ mikrotik: ["manage"], device: ["manage"] }, 204],
  ]) assert.equal((await callRoute(mikrotikRouter, path, granted)).statusCode, expected);
});
