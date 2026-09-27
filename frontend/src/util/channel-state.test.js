// node --test src/util/channel-state.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  channelHealth,
  channelHint,
  historyEnabled,
  loginStage,
  loginStepPending,
  proxyHost,
  qrSecondsLeft,
  signatureExample,
  splitProxyPassword,
} from "./channel-state.js";

const now = new Date("2026-09-25T08:00:00Z");
const ago = () => "2 мин назад";
const channel = (extra = {}) => ({
  isActive: true,
  state: "connected",
  stateReason: "",
  gatewaySeenAt: "2026-09-25T07:59:00Z",
  lastMessageAt: "2026-09-25T07:58:00Z",
  settings: { proxyUrl: "socks5://relay.f1lab.ru:1080", historyDays: 14 },
  login: { qr: null, expiresAt: null },
  account: { displayName: "F1Lab Поддержка", phone: "+7 (423) 200-00-00" },
  ...extra,
});

test("подключён: прокси и история в подсказке (канва E1)", () => {
  assert.deepEqual(channelHealth(channel(), { now, ago }), {
    state: "ok",
    title: "Подключён",
    meta: "сообщение 2 мин назад",
    hint: "Через прокси relay.f1lab.ru · история загружена за 14 дней",
  });
  assert.equal(
    channelHealth(channel({ settings: { proxyUrl: "", historyDays: 0 } }), { now, ago }).hint,
    "Без прокси",
  );
  assert.equal(
    channelHealth(channel({ settings: { proxyUrl: "", historyDays: 1 } }), { now, ago }).hint,
    "Без прокси · история загружена за 1 день",
  );
});

test("подключён, но шлюз молчит дольше 5 минут — предупреждение", () => {
  const stale = channelHealth(channel({ gatewaySeenAt: "2026-09-25T07:50:00Z" }), { now, ago });
  assert.equal(stale.state, "warning");
  assert.equal(stale.title, "Шлюз не отвечает");
  assert.equal(stale.meta, "последний сигнал 2 мин назад");
  const never = channelHealth(channel({ gatewaySeenAt: null }), { now, ago });
  assert.equal(never.meta, "сигнала не было");
});

test("вход не завершён, сессия кончилась, ошибка — есть действие «login»", () => {
  for (const state of ["awaitingQr", "awaitingCode", "awaitingPassword"]) {
    const health = channelHealth(channel({ state }), { now, ago });
    assert.equal(health.state, "warning");
    assert.equal(health.title, "Нужен вход");
    assert.equal(health.action, "login");
  }
  const loggedOut = channelHealth(channel({ state: "loggedOut", stateReason: "" }), { now, ago });
  assert.equal(loggedOut.title, "Сессия завершена");
  assert.equal(loggedOut.hint, "Войдите заново — переписка сохранится");
  assert.equal(loggedOut.action, "login");
  const error = channelHealth(channel({ state: "error", stateReason: "Прокси не отвечает" }), { now, ago });
  assert.equal(error.state, "error");
  assert.equal(error.hint, "Прокси не отвечает");
  assert.equal(channelHealth(channel({ state: "banned" }), { now, ago }).action, undefined);
  assert.equal(channelHealth(channel({ state: "connecting" }), { now, ago }).state, "busy");
  assert.equal(channelHealth(channel({ state: "disconnected" }), { now, ago }).action, "login");
});

test("выключенный и отсутствующий канал", () => {
  assert.equal(channelHealth(channel({ isActive: false }), { now, ago }).title, "Отключён");
  assert.equal(channelHealth(null, { now, ago }).title, "Не подключён");
});

test("loginStage: что показать в диалоге входа", () => {
  assert.equal(loginStage(channel()), "connected");
  assert.equal(loginStage(channel({ state: "awaitingQr", login: { qr: "tg://login?token=x" } })), "qr");
  assert.equal(loginStage(channel({ state: "awaitingQr", login: { qr: null } })), "waiting");
  assert.equal(loginStage(channel({ state: "connecting" })), "waiting");
  assert.equal(loginStage(channel({ state: "awaitingCode" })), "code");
  assert.equal(loginStage(channel({ state: "awaitingPassword" })), "password");
  for (const state of ["disconnected", "loggedOut", "banned", "error"]) {
    assert.equal(loginStage(channel({ state })), "idle");
  }
  assert.equal(loginStage(null), "idle");
});

test("мелочи: хост прокси, секунды QR, пример подписи, подсказка канала", () => {
  assert.equal(proxyHost("socks5://user@relay.f1lab.ru:1080"), "relay.f1lab.ru");
  assert.equal(proxyHost("не адрес"), "");
  assert.equal(proxyHost(""), "");
  assert.equal(qrSecondsLeft("2026-09-25T08:00:18Z", now), 18);
  assert.equal(qrSecondsLeft("2026-09-25T07:59:00Z", now), 0);
  assert.equal(qrSecondsLeft(null, now), null);
  assert.equal(signatureExample("Игорь", "F1Lab"), "«— Игорь, F1Lab» — имя без контактов");
  assert.equal(signatureExample("", ""), "Имя и организация — без контактов");
  assert.equal(channelHint(channel()), "F1Lab Поддержка · +7 (423) 200-00-00");
  assert.equal(channelHint({ account: {} }), "Корпоративный аккаунт не подключён");
  assert.equal(historyEnabled({ historyDays: 14 }), true);
  assert.equal(historyEnabled({ historyDays: 0 }), false);
});

test("loginStepPending: шаг входа (телефон/код/пароль) ещё обрабатывается шлюзом", () => {
  const since = { state: "awaitingCode", stage: "code" };
  // Ничего не сдвинулось с отправки шага — шлюз ещё не ответил
  assert.equal(loginStepPending(since, channel({ state: "awaitingCode" })), true);
  // Состояние сдвинулось — шаг принят (пришёл пароль 2FA)
  assert.equal(loginStepPending(since, channel({ state: "awaitingPassword" })), false);
  // Сдвинулось до «Подключён» — вход завершён
  assert.equal(loginStepPending(since, channel({ state: "connected" })), false);
  // Диалог закрылся (channel — null) — считаем шаг завершённым
  assert.equal(loginStepPending(since, null), false);

  // Состояние то же самое, но стадия сдвинулась (QR подъехал) — тоже не «ждём»
  const sinceQr = { state: "awaitingQr", stage: "waiting" };
  assert.equal(
    loginStepPending(sinceQr, channel({ state: "awaitingQr", login: { qr: null } })),
    true,
  );
  assert.equal(
    loginStepPending(
      sinceQr,
      channel({ state: "awaitingQr", login: { qr: "tg://login?token=x" } }),
    ),
    false,
  );
});

test("splitProxyPassword: пароль из адреса — наружу, в адресе остаётся user@host", () => {
  assert.deepEqual(
    splitProxyPassword("socks5://relay:s3cr3t@relay.f1lab.ru:1080"),
    { url: "socks5://relay@relay.f1lab.ru:1080", password: "s3cr3t" },
  );
  // Без пароля — адрес не трогаем
  assert.deepEqual(
    splitProxyPassword("socks5://relay.f1lab.ru:1080"),
    { url: "socks5://relay.f1lab.ru:1080", password: null },
  );
  assert.deepEqual(
    splitProxyPassword("socks5://user@relay.f1lab.ru:1080"),
    { url: "socks5://user@relay.f1lab.ru:1080", password: null },
  );
  // Пусто и не-адрес — как есть, без падения
  assert.deepEqual(splitProxyPassword(""), { url: "", password: null });
  assert.deepEqual(splitProxyPassword("не адрес"), { url: "не адрес", password: null });
});
