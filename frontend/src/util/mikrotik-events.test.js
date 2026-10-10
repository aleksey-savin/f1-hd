// node --test src/util/mikrotik-events.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { JOURNAL_FILTERS, eventLine, groupByDay } from "./mikrotik-events.js";

const line = (event) => eventLine(event, { formatTime: () => "12:24" });

test("filters: «Все» first, then one per backend group", () => {
  assert.deepEqual(JOURNAL_FILTERS.map((f) => f.value), ["all", "link", "power", "config", "record", "agent", "router"]);
});

test("tone follows severity; an ordinary event is muted", () => {
  assert.equal(line({ kind: "recovered", severity: "ok", data: { downSeconds: 480 } }).tone, "ok");
  assert.equal(line({ kind: "offline", severity: "danger", data: {} }).tone, "bad");
  assert.equal(line({ kind: "exportCreated", severity: "info", data: {} }).tone, "muted");
});

test("link: recovery says how long the device was silent; a planned outage is named so", () => {
  assert.equal(line({ kind: "recovered", data: { downSeconds: 480 } }).detail, "Не отвечало 8 минут");
  assert.equal(line({ kind: "offline", data: { planned: true } }).label, "Не в сети по расписанию");
  assert.deepEqual(line({ kind: "offline", data: { error: "connect ETIMEDOUT" } }).raw, ["connect ETIMEDOUT"]);
});

test("reboot: cause and how long the device ran before it", () => {
  const outside = line({ kind: "reboot", data: { cause: "unknown", ranSeconds: 41 * 86400 + 6 * 3600 } });
  assert.equal(outside.who, "не из HD");
  assert.equal(outside.detail, "До этого работало 41 день 6 часов");
  assert.equal(line({ kind: "reboot", data: { cause: "upgrade" } }).who, "при обновлении из HD");
});

test("versions are shown as a change", () => {
  assert.deepEqual(line({ kind: "upgradeFinished", data: { from: "7.20.1", to: "7.23.7" } }).change, { from: "7.20.1", to: "7.23.7" });
  assert.equal(line({ kind: "upgradeStarted", data: { channel: "stable", to: "7.23.7" } }).detail, "Ветка stable, до 7.23.7");
});

test("config change: counts and menus, or why there are none", () => {
  assert.equal(
    line({ kind: "configChanged", data: { added: 4, removed: 1, sections: ["/ip firewall filter", "/ip dhcp-server lease"] } }).detail,
    "Строк добавлено: 4 строки, убрано: 1 строка. Меню: /ip firewall filter, /ip dhcp-server lease",
  );
  assert.equal(line({ kind: "configChanged", data: { unknown: true } }).detail, "Состав отличий не сохранён: событие старше журнала");
  assert.equal(line({ kind: "configChanged", data: { added: 0, removed: 0, sections: [] } }).detail, "Изменились только скрытые значения");
});

test("a copy names its trigger and the person", () => {
  assert.equal(line({ kind: "exportCreated", actor: { type: "user", name: "Олег Миронов" }, data: { trigger: "pre-change" } }).who, "перед изменением, Олег Миронов");
  assert.equal(line({ kind: "exportCreated", actor: null, data: { trigger: "scheduled" } }).who, "по расписанию");
});

test("parameters: fields with both values, secrets only by name, the responsible person by name", () => {
  const result = line({
    kind: "parametersChanged",
    actor: { type: "user", name: "Алексей Савин" },
    data: { fields: [{ field: "host", from: "10.0.0.1", to: "10.0.0.2" }, { field: "password" }], responsible: { from: null, to: "Олег Миронов" } },
  });
  assert.equal(result.who, "Алексей Савин");
  assert.equal(result.detail, "Адрес: 10.0.0.1 → 10.0.0.2. Пароль изменён. Ответственный: не назначен → Олег Миронов");
});

test("agent requests: title for the link, the agent and who asked, the channel of a decision", () => {
  const proposed = line({ kind: "changeProposed", actor: { type: "agent", name: "OpenClaw", onBehalfOf: "Алексей Савин" }, data: { title: "WireGuard", commands: 3 } });
  assert.equal(proposed.who, "OpenClaw, просит Алексей Савин");
  assert.equal(proposed.title, "WireGuard");
  assert.equal(proposed.detail, "3 команды");
  assert.equal(line({ kind: "changeApproved", actor: { type: "user", name: "Олег Миронов" }, data: { channel: "portal" } }).who, "Олег Миронов, на портале");
  assert.equal(line({ kind: "changeRolledBack", data: { title: "WireGuard", failure: "Команда 2 не выполнилась" } }).detail, "Команда 2 не выполнилась");
  assert.deepEqual(line({ kind: "changeRefused", data: { title: "Новый админ", reason: "the /user menu is closed" } }).raw, ["the /user menu is closed"]);
});

test("agent reads fold into one line with the count, the start and what was read", () => {
  const result = line({ kind: "agentAccess", count: 6, actor: { type: "agent", name: "OpenClaw" }, data: { since: "x", tools: ["config", "state", "ping"], targets: ["10.0.55.1"] } });
  assert.equal(result.detail, "6 обращений с 12:24: конфигурация, состояние, ping 10.0.55.1");
  assert.equal(line({ kind: "agentAccess", count: 1, data: { tools: ["log"] } }).detail, "лог");
});

test("router log: account, HD's own account, logins and failures", () => {
  const own = line({ kind: "routerConfig", actor: { type: "router", name: "hd-api" }, data: { byHd: true, count: 3, lines: ["a", "b", "c"] } });
  assert.equal(own.who, "hd-api, учётная запись HD");
  assert.deepEqual(own.raw, ["a", "b", "c"]);
  assert.equal(line({ kind: "routerLogin", actor: { type: "router", name: "admin" }, data: { via: "winbox", from: "10.0.20.15" } }).who, "admin, winbox, с 10.0.20.15");
  assert.equal(
    line({ kind: "routerLoginFailed", data: { count: 14, users: ["root"], via: ["ssh"], sources: ["185.224.128.17"] } }).detail,
    "14 попыток: root, ssh, с 185.224.128.17",
  );
});

test("an unknown kind still renders", () => {
  assert.equal(line({ kind: "somethingNew", data: {} }).label, "somethingNew");
});

test("groupByDay keeps the order and splits on the day key", () => {
  const days = groupByDay([{ at: "a1" }, { at: "a2" }, { at: "b1" }], (at) => at[0]);
  assert.deepEqual(days.map((d) => [d.key, d.events.length]), [["a", 2], ["b", 1]]);
});
