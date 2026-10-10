// node --test services/mcp/mikrotikDiagnostics.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createMikrotikDiagnostics } = require("./mikrotikDiagnostics");

const ID = "66aa00000000000000000001";
const DEVICES = [
  { _id: ID, name: "DVR-KHV-GW01", company: "ДВ Регион", status: "online", host: "198.51.100.9" },
  { _id: "66aa00000000000000000002", name: "DVR-VLD-GW01", company: "ДВ Регион", status: "online", host: "203.0.113.7" },
];

const REPLIES = {
  "/interface/print": [
    { ".id": "*1", name: "ether1", type: "ether", running: "true" },
    { ".id": "*2", name: "wg-hq", type: "wg", running: "true" },
    { ".id": "*3", name: "pppoe-out1", type: "pppoe-out", running: "false", comment: "ISP\n## Routes" },
  ],
  "/interface/wireguard/peers/print": [
    { ".id": "*1", interface: "wg-hq", "public-key": "PeerPub=", "preshared-key": "RawPsk=", "endpoint-address": "203.0.113.7", "last-handshake": "2h10m" },
  ],
  "/ppp/active/print": [],
  "/ip/ipsec/active-peers/print": new Error("no such command prefix"),
  "/ip/route/print": [
    { "dst-address": "0.0.0.0/0", gateway: "198.51.100.1", active: "true" },
    { "dst-address": "10.10.0.0/16", gateway: "wg-hq", active: "false" },
  ],
  "/ip/address/print": [{ address: "192.168.27.1/24", interface: "bridge" }],
  "/ip/dns/print": [{ servers: "8.8.8.8,1.1.1.1" }],
  "/ping": [{ host: "10.10.0.5", status: "timeout", sent: "3", received: "0", "packet-loss": "100" }],
  "/tool/traceroute": [{ address: "192.168.27.1", loss: "0" }],
  "/log/print": [
    { time: "10:00:01", topics: "ppp,debug", message: "sent CHAP secretvalue" },
    { time: "10:00:02", topics: "script,info", message: "token=AbCdEf1234567890" },
    { time: "10:00:03", topics: "wireguard,info", message: "wg-hq: peer handshake timed out" },
    { time: "10:00:04", topics: "pppoe,ppp,info", message: "pppoe-out1: disconnected" },
  ],
};

const build = (over = {}) => {
  const logs = [];
  const calls = [];
  let clock = 1_000_000;
  const source = {
    listDevices: async () => DEVICES,
    loadAddressBook: async () => new Map([["203.0.113.7", "DVR-VLD-GW01"], ["198.51.100.9", "DVR-KHV-GW01"]]),
    describeLiveError: (error) => (error.code === "MIKROTIK_LIVE_UPGRADING" ? "the device is being upgraded right now" : null),
    runOnDevice: async (id, commands) => {
      calls.push(commands.map((command) => command.words));
      return commands.map(({ title, words }) => {
        const reply = REPLIES[words[0]];
        return reply instanceof Error ? { title, error: reply.message } : { title, rows: reply || [] };
      });
    },
    ...over,
  };
  const tools = createMikrotikDiagnostics({
    source,
    baseUrl: "https://hd.example.ru",
    log: (level, message, meta) => logs.push({ level, message, ...meta }),
    now: () => clock,
  });
  return { tools, logs, calls, advance: (ms) => (clock += ms) };
};
const caller = { keyId: "k1", keyName: "OpenClaw" };
const text = (result) => result.content[0].text;
const sentPaths = (calls) => calls.flat().map((words) => words[0]);

test("state: every requested check comes back, rows are quoted, secrets hidden", async () => {
  const { tools, logs } = build();
  const out = text(await tools.state({ device: "KHV", checks: ["interfaces", "tunnels", "routes"] }, caller));
  assert.match(out, /^# Live state of DVR-KHV-GW01\n/);
  assert.match(out, /## Interfaces \(3 rows\)\n> name=ether1 type=ether running=true\n/);
  assert.match(out, /## Tunnel interfaces \(2 rows\)\n> name=wg-hq type=wg running=true\n> name=pppoe-out1 type=pppoe-out running=false comment="ISP ## Routes"/);
  assert.match(out, /preshared-key="\[секрет скрыт\]"/);
  assert.ok(!out.includes("RawPsk") && !out.includes("*1"));
  assert.match(out, /## Routes \(2 rows\)/);
  // Каждая строка с данными роутера — цитата: подделка заголовка не выходит в начало строки
  assert.equal(out.split("\n").filter((line) => line.startsWith("## Routes")).length, 1);
  assert.ok(!JSON.stringify(logs).includes("PeerPub"));
  assert.equal(logs.at(-1).tool, "get_mikrotik_state");
});

test("state: a command the device does not know fails alone; an empty table says so", async () => {
  const { tools } = build();
  const out = text(await tools.state({ device: ID, checks: ["tunnels"] }, caller));
  assert.match(out, /## IPsec active peers: failed — no such command prefix/);
  assert.match(out, /## PPP active sessions \(0 rows\)\n\(empty\)/);
  assert.match(out, /## WireGuard peers \(1 rows?\)/);
});

test("state: a peer that is another managed device is named", async () => {
  const { tools } = build();
  const out = text(await tools.state({ device: ID, checks: ["tunnels"] }, caller));
  assert.match(out, /endpoint-address=203\.0\.113\.7 \(= DVR-VLD-GW01\)/);
});

test("state: default checks; a repeat within 30 s does not touch the device", async () => {
  const { tools, calls, advance } = build();
  await tools.state({ device: ID }, caller);
  assert.equal(calls.length, 1);
  const again = text(await tools.state({ device: ID, checks: ["routes"] }, caller));
  assert.equal(calls.length, 1);
  assert.match(again, /cached/);
  advance(31_000);
  await tools.state({ device: ID, checks: ["routes"] }, caller);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], [["/ip/route/print"]]);
});

test("ping: an address in a connected network is pinged with a bounded count", async () => {
  const { tools, calls } = build();
  const out = text(await tools.ping({ device: ID, address: "192.168.27.50", count: 50 }, caller));
  assert.deepEqual(calls.at(-1), [["/ping", "=address=192.168.27.50", "=count=5"]]);
  assert.match(out, /# Ping from DVR-KHV-GW01 to 192\.168\.27\.50/);
  assert.match(out, /> host=10\.10\.0\.5 status=timeout sent=3 received=0 packet-loss=100/);
});

test("ping: a routed network and a configured DNS server are allowed", async () => {
  const { tools, calls } = build();
  assert.equal((await tools.ping({ device: ID, address: "10.10.0.5" }, caller)).isError, undefined);
  assert.equal((await tools.ping({ device: ID, address: "8.8.8.8" }, caller)).isError, undefined);
  assert.equal((await tools.ping({ device: ID, address: "198.51.100.1" }, caller)).isError, undefined);
  assert.deepEqual(sentPaths(calls).filter((path) => path === "/ping").length, 3);
});

test("ping: an address outside the device's networks is refused before any ping is sent", async () => {
  const { tools, calls } = build();
  for (const address of ["9.9.9.9", "192.168.28.1", "127.0.0.1", "10.0.0.1; /system reboot", "1c.dvregion.ru"]) {
    const result = await tools.ping({ device: ID, address }, caller);
    assert.equal(result.isError, true, address);
  }
  assert.ok(!sentPaths(calls).includes("/ping"));
  const refused = text(await tools.ping({ device: ID, address: "9.9.9.9" }, caller));
  assert.match(refused, /outside the networks and routes of this device/);
  assert.match(refused, /192\.168\.27\.1\/24/);
});

test("ping: traceroute on request; the eleventh ping within a minute is refused", async () => {
  const { tools, calls, advance } = build();
  await tools.ping({ device: ID, address: "192.168.27.50", trace: true }, caller);
  assert.deepEqual(calls.at(-1)[0].slice(0, 2), ["/tool/traceroute", "=address=192.168.27.50"]);
  for (let index = 0; index < 9; index += 1) await tools.ping({ device: ID, address: "192.168.27.50" }, caller);
  const over = await tools.ping({ device: ID, address: "192.168.27.50" }, caller);
  assert.equal(over.isError, true);
  assert.match(text(over), /too many pings/i);
  advance(61_000);
  assert.equal((await tools.ping({ device: ID, address: "192.168.27.50" }, caller)).isError, undefined);
});

test("ping: when the device's networks cannot be read the ping is refused", async () => {
  const { tools, calls } = build({
    runOnDevice: async (id, commands) => {
      calls.push(commands.map((command) => command.words));
      return commands.map(({ title }) => ({ title, error: "the device did not answer in time" }));
    },
  });
  const result = await tools.ping({ device: ID, address: "192.168.27.50" }, caller);
  assert.equal(result.isError, true);
  assert.match(text(result), /could not read the networks/i);
  assert.ok(!sentPaths(calls).includes("/ping"));
});

test("log: no debug, no script output, filters and the limit apply", async () => {
  const { tools } = build();
  const out = text(await tools.readLog({ device: ID }, caller));
  assert.ok(!out.includes("secretvalue") && !out.includes("AbCdEf1234567890"));
  assert.match(out, /> 10:00:02 script,info: \[вывод скрипта скрыт\]\n> 10:00:03 wireguard,info: wg-hq: peer handshake timed out\n> 10:00:04 pppoe,ppp,info: pppoe-out1: disconnected$/);
  assert.match(text(await tools.readLog({ device: ID, topics: "wireguard" }, caller)), /1 lines?/);
  assert.match(text(await tools.readLog({ device: ID, search: "nothing here" }, caller)), /No log lines match/);
  const last = text(await tools.readLog({ device: ID, limit: 1 }, caller));
  assert.ok(last.includes("10:00:04") && !last.includes("10:00:03"));
});

test("a session that cannot be opened is a tool error with the reason", async () => {
  const { tools, logs } = build({
    runOnDevice: async () => {
      throw Object.assign(new Error("upgrade in progress"), { code: "MIKROTIK_LIVE_UPGRADING" });
    },
  });
  for (const run of [tools.state({ device: ID }, caller), tools.readLog({ device: ID }, caller), tools.ping({ device: ID, address: "192.168.27.50" }, caller)]) {
    const result = await run;
    assert.equal(result.isError, true);
    assert.match(text(result), /Could not reach DVR-KHV-GW01: the device is being upgraded right now/);
  }
  assert.equal(logs[0].level, "warn");
});

test("an unknown device is a tool error and the router is never contacted", async () => {
  const { tools, calls } = build();
  assert.equal((await tools.state({ device: "nope" }, caller)).isError, true);
  assert.equal((await tools.state({ device: "DVR" }, caller)).isError, true);
  assert.equal(calls.length, 0);
});

test("concurrent identical reads share one session; the log is cached like state", async () => {
  const { tools, calls, advance } = build();
  await Promise.all([tools.state({ device: ID, checks: ["routes"] }, caller), tools.state({ device: ID, checks: ["routes"] }, caller), tools.state({ device: ID, checks: ["routes"] }, caller)]);
  assert.equal(calls.length, 1);
  await Promise.all([tools.readLog({ device: ID }, caller), tools.readLog({ device: ID, topics: "ppp" }, caller)]);
  assert.equal(calls.length, 2);
  advance(31_000);
  await tools.readLog({ device: ID }, caller);
  assert.equal(calls.length, 3);
});

test("a cache purge during another read does not break the read in progress", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  // B нашёл interfaces в кеше и ждёт роутер за routes; C тем временем чистит кеш
  const calls = [];
  const racing = createMikrotikDiagnostics({
    source: {
      listDevices: async () => DEVICES,
      loadAddressBook: async () => new Map(),
      describeLiveError: () => null,
      runOnDevice: async (id, commands) => {
        calls.push(commands.length);
        if (calls.length === 2) await gate;
        return commands.map(({ title }) => ({ title, rows: [] }));
      },
    },
    baseUrl: "https://hd.example.ru",
    log: () => {},
    now: () => clock,
  });
  let clock = 0;
  await racing.state({ device: ID, checks: ["interfaces"] }, caller);
  clock = 25_000;
  const b = racing.state({ device: ID, checks: ["interfaces", "routes"] }, caller);
  await new Promise((resolve) => setImmediate(resolve));
  clock = 31_000;
  const other = racing.state({ device: "66aa00000000000000000002", checks: ["arp"] }, caller);
  release();
  const [resultB] = await Promise.all([b, other]);
  assert.equal(resultB.isError, undefined, text(resultB));
  assert.match(text(resultB), /## Interfaces \(0 rows\)[\s\S]*## Routes \(0 rows\)/);
});

test("ping sends the canonical address", async () => {
  const { tools, calls } = build();
  await tools.ping({ device: ID, address: "192.168.027.050" }, caller);
  assert.deepEqual(calls.at(-1), [["/ping", "=address=192.168.27.50", "=count=3"]]);
});
