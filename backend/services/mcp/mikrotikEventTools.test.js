// node --test services/mcp/mikrotikEventTools.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createMikrotikEventTools, LABELS } = require("./mikrotikEventTools");
const { KIND_NAMES } = require("../mikrotik/eventKinds");

const DEVICE = "66aa00000000000000000001";
const NOW = new Date("2026-10-11T12:00:00Z");
const DEVICES = [{ _id: DEVICE, name: "F1-VLD-GW01", host: "203.0.113.7", company: "F1Lab" }];
const names = new Map([["u1", "Алексей Савин"]]);
const caller = { keyId: "k9", keyName: "OpenClaw" };
const text = (result) => result.content[0].text;

const build = (rows, total = rows.length) => {
  const asked = [];
  const logs = [];
  const tools = createMikrotikEventTools({
    source: { listDevices: async () => DEVICES },
    store: {
      listEvents: async (query) => { asked.push(query); return { rows, total }; },
      people: async () => names,
    },
    baseUrl: "https://hd.example.ru/",
    log: (level, message, meta) => logs.push(meta),
    now: () => NOW,
  });
  return { tools, asked, logs };
};

test("every kind of the catalogue has a label for the agent", () => {
  for (const kind of KIND_NAMES) assert.ok(LABELS[kind], kind);
});

test("events: header, one line per event, people by name, foreign text quoted", async () => {
  const { tools, asked } = build([
    { at: new Date("2026-10-11T09:52:00Z"), kind: "changeApplied", actor: { type: "system" }, data: { title: "WireGuard для Ивана Петрова", commands: 3 } },
    { at: new Date("2026-10-11T09:38:00Z"), kind: "changeProposed", actor: { type: "mcpKey", keyId: "k1", keyName: "OpenClaw", onBehalfOf: "u1" }, data: { title: "WireGuard для Ивана Петрова" } },
    { at: new Date("2026-10-10T20:14:00Z"), kind: "routerConfig", actor: { type: "routerUser", name: "admin" }, data: { count: 2, lines: ["filter rule changed by admin", "filter rule added by admin"] } },
    { at: new Date("2026-10-02T11:03:00Z"), kind: "reboot", actor: { type: "system" }, data: { cause: "unknown", ranSeconds: 3564000 } },
  ]);
  const out = text(await tools.events({ device: "F1-VLD-GW01" }, caller));
  assert.match(out, /^# Journal of F1-VLD-GW01\nlast 30 days: 4 events; showing the newest 4;/);
  assert.match(out, /link: https:\/\/hd\.example\.ru\/devices\/mikrotik\/records\/66aa00000000000000000001/);
  assert.match(out, /2026-10-11T09:38Z · agent proposed a change · by agent OpenClaw for Алексей Савин\n {2}> WireGuard для Ивана Петрова/);
  assert.match(out, /configuration edited on the router · by router account admin · 2 log lines\n {2}> filter rule changed by admin/);
  assert.match(out, /rebooted · not started from HD · ran 990 h before it/);
  assert.ok(!out.includes("k1") && !out.includes("u1"));
  assert.deepEqual(asked[0], { deviceId: DEVICE, since: new Date("2026-09-11T12:00:00Z"), group: null, limit: 20 });
});

test("events: days, group and limit are clamped; older events are announced", async () => {
  const { tools, asked, logs } = build([{ at: NOW, kind: "offline", actor: { type: "system" }, data: { error: "connect ETIMEDOUT" } }], 40);
  const out = text(await tools.events({ device: DEVICE, days: 7, group: "link", limit: 5000 }, caller));
  assert.equal(asked[0].limit, 100);
  assert.equal(asked[0].group, "link");
  assert.match(out, /last 7 days, group link: 40 events/);
  assert.match(out, /\[…39 older events not shown/);
  assert.equal(logs[0].tool, "get_mikrotik_events");
  assert.equal(logs[0].mcpKeyName, "OpenClaw");

  await tools.events({ device: DEVICE, days: 3, group: "nope" }, caller);
  assert.equal(asked[1].group, null);
  assert.deepEqual(asked[1].since, new Date("2026-09-11T12:00:00Z"));
});

test("events: an empty journal and an unknown device say what to do", async () => {
  const { tools } = build([]);
  assert.match(text(await tools.events({ device: DEVICE }, caller)), /No events\. Widen days or drop group\./);
  const missing = await tools.events({ device: "NOPE" }, caller);
  assert.equal(missing.isError, true);
});

test("events: config diff lines are never part of the answer", async () => {
  const { tools } = build([{ at: NOW, kind: "configChanged", actor: { type: "system" }, data: { added: 4, removed: 1, sections: ["/ip firewall filter"] }, diff: ["+ add secret-looking-line"] }]);
  const out = text(await tools.events({ device: DEVICE }, caller));
  assert.match(out, /configuration changed · \+4 −1 lines · menus: \/ip firewall filter/);
  assert.ok(!out.includes("secret-looking-line"));
});
