require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const ticketPath = require.resolve("../../models/ticket");
const ticketModule = new Module(ticketPath);
Object.assign(ticketModule, {
  filename: ticketPath,
  loaded: true,
  exports: { Ticket: {} },
});
require.cache[ticketPath] = ticketModule;
const filename = require.resolve("../../controllers/proxmox");
const cached = new Module(filename);
Object.assign(cached, {
  filename,
  loaded: true,
  exports: new Proxy({}, { get: () => () => {} }),
});
require.cache[filename] = cached;
const router = require("./proxmox");
test("starting guest security collection requires management, reading the report is read-only", async () => {
  const routes = router.stack
    .filter((layer) => layer.route?.path === "/guests/:id/security")
    .map((layer) => layer.route);
  assert.equal(routes.length, 2);
  const write = routes.find((route) => route.methods.post);
  assert.ok(write);
  for (const [isEndUser, manage, expected] of [
    [false, false, 403],
    [true, true, 403],
    [false, true, 204],
  ]) {
    let status = 204;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json() {},
    };
    const req = {
      auth: {
        isEndUser,
        can: (permissions) => manage && permissions.proxmox.includes("manage"),
      },
    };
    let called = false;
    await write.stack[0].handle(req, res, () => {
      called = true;
    });
    assert.equal(status, expected);
    assert.equal(called, expected === 204);
  }
  assert.ok(routes.some((route) => route.methods.get));
});
