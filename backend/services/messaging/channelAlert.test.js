// node --test services/messaging/channelAlert.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  CHANNEL_SETTINGS_LINK,
  ERROR_REPEAT_MS,
  channelAlertText,
  shouldAlertChannelState,
} = require("./channelAlert");

const now = new Date("2026-09-26T08:00:00Z");
const ago = (ms) => new Date(now.getTime() - ms);

test("a channel falling into loggedOut, banned or error from another state alerts", () => {
  for (const next of ["loggedOut", "banned", "error"]) {
    assert.equal(shouldAlertChannelState({ previous: "connected", next, now }), true, next);
  }
  // Сбой сменился другим сбоем — это новость (ошибка → блокировка)
  assert.equal(shouldAlertChannelState({ previous: "error", next: "banned", now }), true);
  assert.equal(shouldAlertChannelState({ previous: "loggedOut", next: "error", now }), true);
  assert.equal(shouldAlertChannelState({ previous: "awaitingQr", next: "loggedOut", now }), true);
});

test("the same state again (replay, second delivery), healthy states and a disabled channel stay silent", () => {
  for (const state of ["loggedOut", "banned", "error"]) {
    assert.equal(shouldAlertChannelState({ previous: state, next: state, now }), false, state);
  }
  for (const next of ["connected", "connecting", "awaitingQr", "awaitingCode", "awaitingPassword", "disconnected"]) {
    assert.equal(shouldAlertChannelState({ previous: "error", next, now }), false, next);
  }
  assert.equal(shouldAlertChannelState({ previous: "connected", next: "loggedOut", active: false, now }), false);
});

test("error alerts at most once per 6 hours per channel; loggedOut and banned always", () => {
  assert.equal(
    shouldAlertChannelState({ previous: "connected", next: "error", errorAlertedAt: ago(60 * 60_000), now }),
    false,
  );
  assert.equal(
    shouldAlertChannelState({ previous: "connected", next: "error", errorAlertedAt: ago(ERROR_REPEAT_MS), now }),
    true,
  );
  assert.equal(
    shouldAlertChannelState({ previous: "connected", next: "loggedOut", errorAlertedAt: ago(60_000), now }),
    true,
  );
  assert.equal(
    shouldAlertChannelState({ previous: "connected", next: "banned", errorAlertedAt: ago(60_000), now }),
    true,
  );
});

test("the bell row names the channel and the reason — never the account's phone or username", () => {
  const channel = {
    name: "Telegram",
    account: { displayName: "F1Lab Поддержка", phone: "+7 (423) 200-00-00", username: "f1lab_support" },
  };
  assert.deepEqual(
    channelAlertText(channel, "loggedOut", "Сессию завершили в Telegram — войдите заново (SESSION_REVOKED)"),
    {
      title: "Канал «Telegram»: сессия завершена",
      text: "Сессию завершили в Telegram — войдите заново (SESSION_REVOKED)",
    },
  );
  assert.equal(channelAlertText(channel, "banned").title, "Канал «Telegram»: аккаунт заблокирован");
  assert.equal(
    channelAlertText(channel, "error", "  ").text,
    "Сообщения не принимаются, пока канал не подключится",
  );
  const rows = JSON.stringify(["loggedOut", "banned", "error"].map((state) => channelAlertText(channel, state)));
  assert.equal(rows.includes("200-00-00"), false);
  assert.equal(rows.includes("f1lab_support"), false);
  assert.equal(CHANNEL_SETTINGS_LINK, "/preferences#channels");
});
