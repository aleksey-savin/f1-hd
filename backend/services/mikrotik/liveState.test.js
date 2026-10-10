// node --test services/mikrotik/liveState.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STATE_CHECKS,
  STATE_COMMANDS,
  redactRow,
  pingTarget,
  pingWords,
  traceWords,
  LOG_WORDS,
  filterLog,
  dropOwnSessions,
  namedEndpoints,
  runCommands,
} = require("./liveState");

test("state commands are prints only: nothing can be set, added or removed", () => {
  assert.deepEqual(Object.keys(STATE_COMMANDS).sort(), [...STATE_CHECKS].sort());
  const all = [...Object.values(STATE_COMMANDS).flat().map((command) => command.words), LOG_WORDS];
  for (const words of all) {
    assert.equal(words.length, 1, words.join(" "));
    assert.match(words[0], /^\/[a-z/-]+\/print$/);
  }
});

test("redactRow hides secrets by field name, drops .id and keeps public values", () => {
  assert.deepEqual(
    redactRow("/interface/wireguard/print", { ".id": "*1", name: "wg0", "private-key": "RawKey=", "public-key": "Pub=" }),
    { name: "wg0", "private-key": "[секрет скрыт]", "public-key": "Pub=" },
  );
  const sa = redactRow("/ip/ipsec/installed-sa/print", { "auth-key": "aa", "enc-key": "bb", spi: "0x1" });
  assert.deepEqual(sa, { "auth-key": "[секрет скрыт]", "enc-key": "[секрет скрыт]", spi: "0x1" });
  assert.deepEqual(redactRow("/zerotier/print", { name: "zt1", identity: "aa:0:pub:priv" }), { name: "zt1", identity: "[секрет скрыт]" });
  assert.deepEqual(redactRow("/ip/dhcp-server/print", { "lease-script": ":put 1", comment: "a\nb" }), { "lease-script": "[скрипт скрыт]", comment: "a b" });
});

const NETWORKS = {
  addresses: [{ address: "192.168.34.1/24" }, { address: "172.16.33.10/30" }],
  routes: [{ "dst-address": "0.0.0.0/0", gateway: "78.109.47.1" }, { "dst-address": "10.0.0.0/8" }, { "dst-address": "bad" }],
  extra: ["78.109.47.1", "8.8.8.8"],
};

test("pingTarget allows the device's networks, routes and named endpoints only", () => {
  for (const address of ["192.168.34.77", "172.16.33.9", "10.200.3.4", "78.109.47.1", "8.8.8.8"]) {
    assert.deepEqual(pingTarget(address, NETWORKS), { ok: true }, address);
  }
  for (const address of ["1.1.1.1", "192.168.35.1", "172.16.33.12"]) {
    assert.equal(pingTarget(address, NETWORKS).ok, false, address);
    assert.match(pingTarget(address, NETWORKS).reason, /outside the networks/);
  }
});

test("pingTarget refuses anything that is not a plain unicast IPv4 address", () => {
  const everything = { addresses: [{ address: "0.0.0.0/0" }], routes: [{ "dst-address": "0.0.0.0/1" }, { "dst-address": "128.0.0.0/1" }], extra: [] };
  for (const address of ["127.0.0.1", "0.0.0.0", "224.0.0.5", "255.255.255.255", "fe80::1", "1c.example.ru", "10.0.0.300", "10.0.0.1; /system reboot", "10.0.0.1 ", "", null, undefined, 167772161]) {
    assert.equal(pingTarget(address, everything).ok, false, String(address));
  }
  // Маршрут по умолчанию сам по себе ничего не разрешает
  assert.equal(pingTarget("1.1.1.1", { addresses: [], routes: [{ "dst-address": "0.0.0.0/0" }], extra: [] }).ok, false);
});

test("ping and traceroute words carry only the address and a bounded count", () => {
  assert.deepEqual(pingWords("10.0.0.5", 3), ["/ping", "=address=10.0.0.5", "=count=3"]);
  assert.deepEqual(pingWords("10.0.0.5", 50), ["/ping", "=address=10.0.0.5", "=count=5"]);
  assert.deepEqual(pingWords("10.0.0.5", "x"), ["/ping", "=address=10.0.0.5", "=count=3"]);
  assert.deepEqual(traceWords("10.0.0.5"), ["/tool/traceroute", "=address=10.0.0.5", "=count=1", "=max-hops=10"]);
});

const LOG = [
  { time: "10:00:01", topics: "ppp,debug", message: "sent CHAP Response secretvalue" },
  { time: "10:00:02", topics: "script,info", message: "token=AbCdEf1234567890" },
  { time: "10:00:03", topics: "system,info,account", message: "user admin logged in from 10.0.0.9 via ssh" },
  { time: "10:00:04", topics: "pppoe,ppp,info", message: "pppoe-out1: disconnected" },
  { time: "10:00:05", topics: "system,info", message: "note password: Hunter2Hunter2 changed" },
];

test("filterLog drops debug, hides script output and masks secrets in messages", () => {
  const rows = filterLog(LOG, {});
  assert.equal(rows.length, 4);
  assert.ok(!JSON.stringify(rows).includes("secretvalue"));
  assert.deepEqual(rows[0], { time: "10:00:02", topics: "script,info", message: "[вывод скрипта скрыт]" });
  assert.ok(!JSON.stringify(rows).includes("Hunter2Hunter2"));
  assert.match(rows[1].message, /user admin logged in/);
});

test("filterLog filters by topic and text and keeps the newest lines", () => {
  assert.deepEqual(filterLog(LOG, { topics: "ppp" }).map((row) => row.time), ["10:00:04"]);
  assert.deepEqual(filterLog(LOG, { search: "DISCONNECT" }).map((row) => row.time), ["10:00:04"]);
  assert.deepEqual(filterLog(LOG, { limit: 2 }).map((row) => row.time), ["10:00:04", "10:00:05"]);
  assert.deepEqual(filterLog(undefined, {}), []);
});

test("runCommands: an unknown command fails alone, the rest still run", async () => {
  const run = async (words) => {
    if (words[0] === "/b/print") throw new Error("no such command prefix");
    return [{ from: words[0] }];
  };
  const commands = [{ title: "A", words: ["/a/print"] }, { title: "B", words: ["/b/print"] }, { title: "C", words: ["/c/print"] }];
  assert.deepEqual(await runCommands(run, commands), [
    { title: "A", rows: [{ from: "/a/print" }] },
    { title: "B", error: "no such command prefix" },
    { title: "C", rows: [{ from: "/c/print" }] },
  ]);
});

test("runCommands: after a command that never answered nothing else is sent on that session", async () => {
  const sent = [];
  const run = async (words, { timeoutMs }) => {
    sent.push([words[0], timeoutMs]);
    if (words[0] === "/b/print") throw new Error("read timeout");
    return [];
  };
  const commands = [{ title: "A", words: ["/a/print"] }, { title: "B", words: ["/b/print"], timeoutMs: 20000 }, { title: "C", words: ["/c/print"] }];
  const results = await runCommands(run, commands);
  assert.deepEqual(sent, [["/a/print", 8000], ["/b/print", 20000]]);
  assert.match(results[1].error, /did not answer/);
  assert.match(results[2].error, /not run/);
});

test("redactRow scans comments, hides on-* scripts and URL credentials", () => {
  const row = redactRow("/ip/dhcp-server/lease/print", {
    address: "10.0.0.7",
    comment: "camera password: Qwerty123!",
    "on-alert": ":put 1",
    url: "https://u:PassInUrl9@host/",
  });
  assert.ok(!JSON.stringify(row).includes("Qwerty123!"));
  assert.equal(row["on-alert"], "[скрипт скрыт]");
  assert.ok(!JSON.stringify(row).includes("PassInUrl9"));
  assert.equal(row.address, "10.0.0.7");
});

test("the address sent to the device is the canonical form of what was checked", () => {
  assert.deepEqual(pingWords("010.0.0.5", 1), ["/ping", "=address=10.0.0.5", "=count=1"]);
  assert.equal(traceWords("010.000.0.5")[1], "=address=10.0.0.5");
  assert.equal(traceWords("10.0.0.5")[3], "=max-hops=10");
  assert.equal(pingTarget("008.8.8.8", { extra: ["8.8.8.8"] }).ok, true);
});

test("disabled addresses and routes do not widen the ping guard", () => {
  const nets = { addresses: [{ address: "10.1.0.1/24", disabled: "true" }, { address: "10.2.0.1/24", invalid: "true" }], routes: [{ "dst-address": "8.0.0.0/8", disabled: "true" }, { "dst-address": "10.3.0.0/24", active: "false" }] };
  assert.equal(pingTarget("10.1.0.5", nets).ok, false);
  assert.equal(pingTarget("10.2.0.5", nets).ok, false);
  assert.equal(pingTarget("8.8.8.8", nets).ok, false);
  // Неактивный маршрут (туннель лежит) — как раз то, что проверяют
  assert.equal(pingTarget("10.3.0.5", nets).ok, true);
});

test("namedEndpoints takes the remote ends of IPsec peers and GRE/IPIP/EoIP tunnels", () => {
  const found = namedEndpoints({
    remotes: [{ "remote-address": "89.108.103.224" }, { "remote-address": "84.252.131.195", port: "4500" }, { "remote-address": "" }, {}],
  });
  assert.deepEqual(found, ["89.108.103.224", "84.252.131.195"]);
});

test("dropOwnSessions removes only the helpdesk account's own API and SSH logins", () => {
  const rows = [
    { time: "1", topics: "system,info,account", message: "user f1-hd logged in from 89.108.109.83 via api" },
    { time: "2", topics: "system,info,account", message: "user f1-hd logged out from 89.108.109.83 via ssh" },
    { time: "3", topics: "system,info,account", message: "user admin logged in from 10.0.0.9 via ssh" },
    { time: "4", topics: "system,info,account", message: "user f1-hd logged in from 10.0.0.9 via winbox" },
    { time: "5", topics: "system,error,critical", message: "login failure for user f1-hd from 1.2.3.4 via api" },
  ];
  assert.deepEqual(dropOwnSessions(rows, "f1-hd").map((row) => row.time), ["3", "4", "5"]);
  assert.deepEqual(dropOwnSessions(rows, "").map((row) => row.time), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(dropOwnSessions(rows, "f1.hd").length, 5);
  assert.deepEqual(dropOwnSessions(undefined, "f1-hd"), []);
});
