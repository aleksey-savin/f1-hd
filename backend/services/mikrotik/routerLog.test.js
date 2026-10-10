// node --test services/mikrotik/routerLog.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { selectNew, toEvents, MAX_EVENTS, MAX_LINES } = require("./routerLog");

const row = (id, message, topics = "system,info", time = "12:00:00") => ({ ".id": `*${id.toString(16).toUpperCase()}`, time, topics, message });

test("selectNew: the first read only sets the cursor", () => {
  assert.deepEqual(selectNew([row(1, "a"), row(26, "b")], null), { fresh: [], cursor: 26 });
  assert.deepEqual(selectNew([row(1, "a")], undefined), { fresh: [], cursor: 1 });
});

test("selectNew: later reads return rows past the cursor in log order", () => {
  const rows = [row(30, "c"), row(10, "a"), row(27, "b")];
  const { fresh, cursor } = selectNew(rows, 26);
  assert.deepEqual(fresh.map((r) => r.message), ["b", "c"]);
  assert.equal(cursor, 30);
});

test("selectNew: a counter below the cursor means a reboot — every row is new", () => {
  const { fresh, cursor } = selectNew([row(1, "a"), row(2, "b")], 500);
  assert.equal(fresh.length, 2);
  assert.equal(cursor, 2);
});

test("selectNew: nothing readable keeps the cursor", () => {
  assert.deepEqual(selectNew([], 7), { fresh: [], cursor: 7 });
  assert.deepEqual(selectNew(null, null), { fresh: [], cursor: null });
  assert.deepEqual(selectNew([{ message: "no id" }], 7), { fresh: [], cursor: 7 });
});

test("toEvents: consecutive edits by one account fold into one event", () => {
  const events = toEvents([
    row(1, "filter rule changed by admin"),
    row(2, "filter rule added by admin"),
    row(3, "dhcp lease removed by oleg"),
  ]);
  assert.deepEqual(events.map((e) => [e.kind, e.actor.name, e.data.count]), [
    ["routerConfig", "admin", 2],
    ["routerConfig", "oleg", 1],
  ]);
  assert.deepEqual(events[0].data.lines, ["filter rule changed by admin", "filter rule added by admin"]);
});

test("toEvents: RouterOS 7 names the account inside the connection token", () => {
  const [event] = toEvents([row(1, "filter rule changed by tcp-msg(winbox):admin@10.0.0.9 (/ip firewall filter set *5 disabled=yes)")]);
  assert.equal(event.actor.name, "admin");
});

test("toEvents: edits by HD's own account are kept and marked", () => {
  const [event] = toEvents([row(1, "peer added by f1-hd")], { hdUser: "f1-hd" });
  assert.equal(event.kind, "routerConfig");
  assert.equal(event.data.byHd, true);
});

test("toEvents: HD's own api and ssh sessions and all logouts are dropped", () => {
  const events = toEvents(
    [
      row(1, "user f1-hd logged in from 89.1.1.1 via api", "system,info,account"),
      row(2, "user f1-hd logged out from 89.1.1.1 via api", "system,info,account"),
      row(3, "user admin logged in from 10.0.0.9 via winbox", "system,info,account"),
      row(4, "user admin logged out from 10.0.0.9 via winbox", "system,info,account"),
    ],
    { hdUser: "f1-hd" },
  );
  assert.deepEqual(events, [
    { kind: "routerLogin", actor: { type: "routerUser", name: "admin" }, data: { from: "10.0.0.9", via: "winbox", time: "12:00:00" } },
  ]);
});

test("toEvents: all login failures of a poll are one event", () => {
  const rows = Array.from({ length: 14 }, (_, i) => row(i + 1, `login failure for user root from 185.224.128.${i % 2} via ssh`, "system,error,critical"));
  const events = toEvents(rows);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    kind: "routerLoginFailed",
    data: { count: 14, users: ["root"], sources: ["185.224.128.0", "185.224.128.1"], via: ["ssh"] },
  });
});

test("toEvents: critical lines and reboot messages are kept, routine system lines are not", () => {
  const events = toEvents([
    row(1, "router rebooted without proper shutdown", "system,error,critical"),
    row(2, "system rebooted because of kernel failure", "system,info"),
    row(3, "sntp change time Oct/10/2026 12:00:00 => Oct/10/2026 12:00:01", "system,info"),
    row(4, "dhcp-client on ether1 got IP address 1.2.3.4", "dhcp,info"),
    row(5, "anything", "system,debug"),
    row(6, "script output", "script,info"),
  ]);
  assert.deepEqual(events.map((e) => e.kind), ["routerCritical", "routerSystem"]);
});

test("toEvents: secrets in a message are hidden and long messages are cut", () => {
  const [event] = toEvents([row(1, `fetch failed https://user:hunter2@example.com/x ${"y".repeat(600)}`, "system,error")]);
  assert.ok(!event.data.message.includes("hunter2"));
  assert.ok(event.data.message.length <= 300);
});

test("toEvents: stored lines and events per poll are capped", () => {
  const many = Array.from({ length: MAX_LINES + 5 }, (_, i) => row(i + 1, `rule ${i} changed by admin`));
  const [folded] = toEvents(many);
  assert.equal(folded.data.count, MAX_LINES + 5);
  assert.equal(folded.data.lines.length, MAX_LINES);

  const noisy = Array.from({ length: MAX_EVENTS + 7 }, (_, i) => row(i + 1, `power fault ${i}`, "system,critical"));
  const events = toEvents(noisy);
  assert.equal(events.length, MAX_EVENTS + 1);
  assert.deepEqual(events.at(-1), { kind: "routerMore", data: { count: 7 } });
});
