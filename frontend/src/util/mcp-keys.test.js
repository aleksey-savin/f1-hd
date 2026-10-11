// node --test src/util/mcp-keys.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MCP_RESOURCES,
  agentKeysStatus,
  openClawConfig,
  scopeAccessLabel,
  scopeLossPhrase,
  toggleScope,
  withReadForWrite,
} from "./mcp-keys.ts";

// Строка состояния под ключами ИИ-агентов (Настройки → Интеграции → «Доступ
// ИИ-агентов») и конфиг, который администратор копирует в OpenClaw при выдаче
// ключа.

const key = (name, lastUsedAt = null, scopes = ["knowledge"]) => ({
  _id: name,
  name,
  keyTail: "9f3c",
  createdAt: "2026-09-16T10:00:00.000Z",
  lastUsedAt,
  scopes,
  createdBy: null,
});

test("scanning off is the warning even when an unused key exists", () => {
  const status = agentKeysStatus({
    keys: [key("Тестовый стенд")],
    scanForSecrets: false,
  });

  assert.equal(status.state, "warning");
  assert.doesNotMatch(status.title, /Тестовый стенд/);
});

test("scanning off is reported with no keys at all", () => {
  assert.equal(agentKeysStatus({ keys: [], scanForSecrets: false })?.state, "warning");
});

test("tickets-only keys do not need the secrets scanning warning", () => {
  const status = agentKeysStatus({
    keys: [{ ...key("Аналитик", "2026-09-17T09:00:00.000Z"), scopes: ["tickets"] }],
    scanForSecrets: false,
  });

  assert.equal(status.state, "ok");
});

test("a key with no scopes field reads as knowledge-only, so the warning still applies", () => {
  const legacyKey = key("Легаси", "2026-09-17T09:00:00.000Z");
  delete legacyKey.scopes;

  const status = agentKeysStatus({ keys: [legacyKey], scanForSecrets: false });

  assert.equal(status.state, "warning");
});

test("an unused key is named in the warning", () => {
  const status = agentKeysStatus({
    keys: [key("OpenClaw", "2026-09-17T09:00:00.000Z"), key("Тестовый стенд")],
    scanForSecrets: true,
  });

  assert.equal(status.state, "warning");
  assert.match(status.title, /Тестовый стенд/);
});

test("the unused-key hint names what a tickets-only key opens", () => {
  const status = agentKeysStatus({
    keys: [{ ...key("Разбор заявок"), scopes: ["tickets"] }],
    scanForSecrets: true,
  });

  assert.match(status.hint, /доступ к заявкам/);
});

test("the unused-key hint names both scopes when the key holds both", () => {
  const status = agentKeysStatus({
    keys: [{ ...key("OpenClaw"), scopes: ["knowledge", "tickets"] }],
    scanForSecrets: true,
  });

  assert.match(status.hint, /доступ к базе знаний и заявкам/);
});

test("all keys used: ok with the latest use and the agents-connected title", () => {
  const status = agentKeysStatus({
    keys: [
      key("OpenClaw", "2026-09-17T08:00:00.000Z"),
      key("Второй агент", "2026-09-17T09:30:00.000Z"),
    ],
    scanForSecrets: true,
  });

  assert.equal(status.state, "ok");
  assert.equal(status.title, "Агенты подключались");
  assert.equal(status.at, "2026-09-17T09:30:00.000Z");
});

test("no keys and scanning on: no status row", () => {
  assert.equal(agentKeysStatus({ keys: [], scanForSecrets: true }), null);
});

test("resources pair reading with writing only where writing exists", () => {
  assert.deepEqual(
    MCP_RESOURCES.map(({ label, read, write }) => [label, read, write ?? null]),
    [
      ["База знаний", "knowledge", "knowledgeWrite"],
      ["Заявки", "tickets", null],
      ["Компании", "companies", null],
      ["Пользователи", "users", null],
      ["Mikrotik", "mikrotik", "mikrotikChanges"],
    ],
  );
});

test("ticking writing ticks reading, unticking reading unticks writing", () => {
  assert.deepEqual(toggleScope([], "knowledgeWrite", true), ["knowledge", "knowledgeWrite"]);
  assert.deepEqual(toggleScope(["knowledge", "knowledgeWrite", "tickets"], "knowledge", false), ["tickets"]);
  assert.deepEqual(toggleScope(["mikrotik", "mikrotikChanges"], "mikrotikChanges", false), ["mikrotik"]);
  assert.deepEqual(toggleScope(["tickets"], "mikrotik", true), ["tickets", "mikrotik"]);
});

test("toggleScope returns resource order whatever the input order, unknown scopes stay at the tail", () => {
  assert.deepEqual(toggleScope(["mikrotik", "tickets"], "knowledge", true), ["knowledge", "tickets", "mikrotik"]);
  assert.deepEqual(toggleScope(["legacy", "tickets"], "knowledge", true), ["knowledge", "tickets", "legacy"]);
});

// Ключ с одной «Записью» бывает только старый (флажки такого не дают): диалог
// показывает его как есть, а сохранение приводит к правилу «запись включает чтение»
test("saving adds reading for every held writing", () => {
  assert.deepEqual(withReadForWrite(["mikrotikChanges"]), ["mikrotik", "mikrotikChanges"]);
  assert.deepEqual(withReadForWrite(["tickets", "knowledgeWrite"]), ["knowledge", "knowledgeWrite", "tickets"]);
  assert.deepEqual(withReadForWrite(["mikrotikChanges", "knowledgeWrite"]), ["knowledge", "knowledgeWrite", "mikrotik", "mikrotikChanges"]);
});

test("withReadForWrite leaves paired and read-only access as it is, unknown scopes stay at the tail", () => {
  const paired = ["knowledge", "knowledgeWrite", "mikrotik", "mikrotikChanges"];
  assert.deepEqual(withReadForWrite(paired), paired);
  assert.deepEqual(withReadForWrite(["knowledge", "tickets", "mikrotik"]), ["knowledge", "tickets", "mikrotik"]);
  assert.deepEqual(withReadForWrite([]), []);
  assert.deepEqual(withReadForWrite(["legacy", "mikrotikChanges"]), ["mikrotik", "mikrotikChanges", "legacy"]);
  // Вход не меняется
  const stored = ["mikrotikChanges"];
  withReadForWrite(stored);
  assert.deepEqual(stored, ["mikrotikChanges"]);
});

test("the scanning-off hint names both approved notes and agent drafts", () => {
  const status = agentKeysStatus({ keys: [key("Агент", "2026-09-17T09:00:00.000Z")], scanForSecrets: false });
  assert.equal(
    status.hint,
    "Агенты с доступом к базе знаний получают все проверенные заметки и черновики агентов: пароли и ключи в них никто не ищет. Поиск включается в разделе «База знаний».",
  );
});

test("a key's access is named per resource", () => {
  assert.equal(
    scopeAccessLabel(["knowledge", "knowledgeWrite", "tickets", "mikrotik"]),
    "база знаний (чтение и запись), заявки и Mikrotik (чтение)",
  );
  assert.equal(scopeAccessLabel(["knowledge"]), "база знаний (чтение)");
  assert.equal(scopeAccessLabel(["tickets", "users"]), "заявки и пользователи");
  // Ключ, сохранённый с записью без чтения, показывается как есть
  assert.equal(scopeAccessLabel(["mikrotikChanges"]), "Mikrotik (запись)");
  assert.equal(scopeAccessLabel(null), "база знаний (чтение)");
  assert.equal(scopeAccessLabel(undefined), "база знаний (чтение)");
  assert.equal(scopeAccessLabel([]), "база знаний (чтение)");
});

test("scopeAccessLabel puts companies and users between tickets and Mikrotik", () => {
  assert.equal(
    scopeAccessLabel(["mikrotik", "users", "companies", "tickets"]),
    "заявки, компании, пользователи и Mikrotik (чтение)",
  );
});

test("the loss phrase names resources once", () => {
  assert.equal(scopeLossPhrase(["knowledge", "knowledgeWrite", "mikrotik", "mikrotikChanges"]), "к базе знаний и Mikrotik");
  assert.equal(scopeLossPhrase(["tickets"]), "к заявкам");
  assert.equal(scopeLossPhrase(["knowledge"]), "к базе знаний");
  assert.equal(scopeLossPhrase(["knowledge", "tickets", "mikrotik"]), "к базе знаний, заявкам и Mikrotik");
});

test("the OpenClaw config names the server helpdesk and carries the address, streamable-http and the key", () => {
  const value = `hd_mcp_${"ab12".repeat(16)}`;
  const lines = openClawConfig("https://helpdesk.example.ru/api/mcp", value)
    .split("\n")
    .map((line) => line.trim());

  assert.equal(lines[0], "mcp: { servers: { helpdesk: {");
  assert.ok(lines.includes('url: "https://helpdesk.example.ru/api/mcp",'));
  // Без transport OpenClaw выбирает sse, и подключение не работает.
  assert.ok(lines.includes('transport: "streamable-http",'));
  assert.ok(lines.includes(`headers: { Authorization: "Bearer ${value}" },`));
  assert.equal(lines.at(-1), "} } }");
});

test("values are quoted safely: a quote in the address cannot break the config", () => {
  const snippet = openClawConfig('https://hd.example.ru/api/mcp"x', "hd_mcp_1");

  assert.ok(snippet.includes('url: "https://hd.example.ru/api/mcp\\"x",'));
});
