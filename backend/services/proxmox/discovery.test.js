const test = require("node:test");
const assert = require("node:assert/strict");
const { createSessionManager } = require("./discovery");
const { randomUUID } = require("node:crypto");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const body = { ranges: ["10.0.0.1-10.0.0.4"], ports: [8006] };
test("ephemeral discovery is owner scoped, bounded, and cancel suppresses late results", async () => {
  let active = 0,
    peak = 0;
  const pending = [];
  const manager = createSessionManager({
    validate: async () => {},
    autoSchedule: false,
    maxConcurrent: 2,
    probe: async () => {
      active++;
      peak = Math.max(peak, active);
      return new Promise((resolve) =>
        pending.push(() => {
          active--;
          resolve({ text: "Proxmox", fingerprint: "pin" });
        }),
      );
    },
  });
  try {
    const session = await manager.start(body, "u1");
    assert.throws(() => manager.get(session.id, "u2"));
    await manager.pump();
    await flush();
    assert.equal(peak, 2);
    assert.equal((await manager.cancel(session.id, "u1")).state, "cancelled");
    pending.splice(0).forEach((resolve) => resolve());
    await flush();
    const cancelled = await manager.get(session.id, "u1");
    assert.equal(cancelled.state, "cancelled");
    assert.equal(cancelled.candidates.length, 0);
    await manager.pump();
    assert.equal(pending.length, 0);
    manager.close(session.id, "u1");
    assert.throws(() => manager.get(session.id, "u1"));
  } finally {
    manager.dispose();
  }
});
test("heartbeat expiry aborts probes and revoked access stops next batch", async () => {
  let clock = 0,
    allowed = true,
    signal;
  const manager = createSessionManager({
    now: () => clock,
    heartbeatMs: 30,
    validate: async () => {
      if (!allowed) throw new Error("revoked");
    },
    autoSchedule: false,
    probe: async (endpoint, path, options) => {
      signal = options.signal;
      return { text: "" };
    },
  });
  try {
    let s = await manager.start(body, "u1");
    allowed = false;
    await manager.pump();
    await assert.rejects(manager.get(s.id, "u1"), /revoked/);
    allowed = true;
    assert.equal((await manager.get(s.id, "u1")).state, "failed");
    s = await manager.start(body, "u1");
    await manager.pump();
    await flush();
    clock = 31;
    await manager.pump();
    assert.equal(signal.aborted, true);
    assert.throws(() => manager.get(s.id, "u1"));
  } finally {
    manager.dispose();
  }
});
test("close-before-start tombstone cancels a start awaiting authorization", async () => {
  let finish;
  const manager = createSessionManager({
    autoSchedule: false,
    validate: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const clientSessionId = randomUUID();
  try {
    const starting = manager.start({ ...body, clientSessionId }, "u");
    manager.close(clientSessionId, "u");
    finish();
    await assert.rejects(starting, /закрыт/);
    assert.throws(() => manager.get(clientSessionId, "u"));
  } finally {
    manager.dispose();
  }
});
test("successful scan only retains candidates in current process session", async () => {
  const manager = createSessionManager({
    validate: async () => {},
    autoSchedule: false,
    probe: async () => ({ text: "pve-manager", fingerprint: "pin" }),
  });
  try {
    const s = await manager.start({ ranges: ["10.0.0.1"], ports: [8006] }, "u");
    await manager.pump();
    await flush();
    const done = await manager.get(s.id, "u");
    assert.equal(done.state, "completed");
    assert.equal(done.cursor, 1);
    assert.equal(done.candidates[0].host, "10.0.0.1");
    assert.equal(done.addresses, undefined);
    assert.equal(done.userId, undefined);
  } finally {
    manager.dispose();
  }
});
test("aborting a scan tears down a pending TLS socket before an HTTP request", async () => {
  const tls = require("node:tls"),
    { Duplex } = require("node:stream");
  const original = tls.connect;
  let socket;
  tls.connect = () => {
    socket = new Duplex({
      read() {},
      write(chunk, encoding, done) {
        done();
      },
    });
    socket.setTimeout = () => socket;
    return socket;
  };
  const abort = new AbortController();
  try {
    const request = require("./transport").requestEndpoint(
      { host: "10.0.0.1", port: 8006, transport: "direct" },
      "/",
      { probe: true, signal: abort.signal, timeout: 1000 },
    );
    abort.abort();
    await assert.rejects(request);
    assert.equal(socket.destroyed, true);
  } finally {
    tls.connect = original;
  }
});
