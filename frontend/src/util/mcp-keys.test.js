// node --test src/util/mcp-keys.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  agentKeysStatus,
  openClawConfig,
  scopeAccessLabel,
  scopeLossPhrase,
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

test("scopeAccessLabel lists scopes in canonical order, lowercase, joined with «и»", () => {
  assert.equal(scopeAccessLabel(["tickets", "knowledge"]), "база знаний и заявки");
  assert.equal(scopeAccessLabel(["knowledge"]), "база знаний");
  assert.equal(scopeAccessLabel(["tickets"]), "заявки");
});

test("scopeAccessLabel defaults missing or empty scopes to knowledge-only", () => {
  assert.equal(scopeAccessLabel(undefined), "база знаний");
  assert.equal(scopeAccessLabel([]), "база знаний");
});

test("scopeLossPhrase names what a deleted key's agent loses", () => {
  assert.equal(scopeLossPhrase(["knowledge", "tickets"]), "к базе знаний и заявкам");
  assert.equal(scopeLossPhrase(["tickets"]), "к заявкам");
  assert.equal(scopeLossPhrase(["knowledge"]), "к базе знаний");
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
