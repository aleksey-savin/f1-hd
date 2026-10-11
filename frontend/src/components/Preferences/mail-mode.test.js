// node --test src/components/Preferences/mail-mode.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAIL_OFF_STATE,
  describeMailMode,
  mailModeRowWithCheck,
  withoutStaleMailOff,
} from "./mail-mode.js";

test("live: своей строки у режима нет — рисуется состояние канала", () => {
  assert.equal(describeMailMode({ mode: "live", sandboxRecipient: null }), null);
});

test("ответ без режима (старый сервер) — как live", () => {
  assert.equal(describeMailMode(undefined), null);
  assert.equal(describeMailMode(null), null);
  assert.equal(describeMailMode({}), null);
});

test("sandbox: предупреждение с адресом песочницы, проверка остаётся", () => {
  assert.deepEqual(
    describeMailMode({ mode: "sandbox", sandboxRecipient: "test@example.com" }),
    {
      state: "warning",
      title: "Песочница: вся почта уходит на test@example.com",
      hint: "Режим задан на сервере. Настоящие адресаты писем не получают.",
      canCheck: true,
    },
  );
});

test("off: спокойная строка без кнопки проверки", () => {
  assert.deepEqual(describeMailMode({ mode: "off", sandboxRecipient: null }), {
    state: "idle",
    title: "Отправка почты выключена на сервере",
    hint: "Письма не уходят, уведомления помечаются неотправленными. Включается в настройках сервера.",
    canCheck: false,
  });
});

test("устаревший отказ «почта выключена» снимается, прежний успех остаётся", () => {
  const health = {
    lastOkAt: "2026-10-01T10:00:00.000Z",
    lastMessageAt: "2026-10-01T10:00:00.000Z",
    lastError: MAIL_OFF_STATE,
    lastErrorHint: "Включается в настройках сервера: MAIL_MODE=live.",
    lastErrorAt: "2026-10-10T10:00:00.000Z",
  };

  assert.deepEqual(withoutStaleMailOff(health), {
    lastOkAt: "2026-10-01T10:00:00.000Z",
    lastMessageAt: "2026-10-01T10:00:00.000Z",
    lastError: "",
    lastErrorHint: "",
    lastErrorAt: null,
  });
});

test("настоящая ошибка канала и пустое состояние не трогаются", () => {
  const health = { lastError: "Сервер не отвечает", lastErrorAt: "2026-10-10T10:00:00.000Z" };
  assert.equal(withoutStaleMailOff(health), health);
  assert.equal(withoutStaleMailOff(undefined), undefined);
  assert.equal(withoutStaleMailOff(null), null);
});

const SANDBOX = describeMailMode({ mode: "sandbox", sandboxRecipient: "test@example.com" });
const SANDBOX_TITLE = "Песочница: вся почта уходит на test@example.com";
const SANDBOX_HINT = "Режим задан на сервере. Настоящие адресаты писем не получают.";

test("песочница без проверки: строка режима как есть, без служебного canCheck", () => {
  for (const result of [null, undefined]) {
    assert.deepEqual(mailModeRowWithCheck(SANDBOX, result), {
      state: "warning",
      title: SANDBOX_TITLE,
      hint: SANDBOX_HINT,
    });
  }
});

test("песочница после удачной проверки: заголовок прежний, исход — первым в подсказке", () => {
  assert.deepEqual(
    mailModeRowWithCheck(SANDBOX, {
      ok: true,
      state: "Тестовое письмо отправлено",
      hint: "Адресат — test@example.com. Если письма нет, проверьте папку «Спам».",
    }),
    {
      state: "warning",
      title: SANDBOX_TITLE,
      hint: `Тестовое письмо отправлено. Адресат — test@example.com. Если письма нет, проверьте папку «Спам». ${SANDBOX_HINT}`,
    },
  );
});

test("песочница после неудачной проверки: заголовок всё равно о режиме, причина — в подсказке", () => {
  const row = mailModeRowWithCheck(SANDBOX, {
    ok: false,
    state: "Сервер отклонил пароль",
    hint: "Проверьте пароль приложения",
  });
  assert.equal(row.title, SANDBOX_TITLE);
  assert.equal(row.state, "warning");
  assert.equal(row.hint, `Сервер отклонил пароль. Проверьте пароль приложения. ${SANDBOX_HINT}`);

  // Исход без пояснения: лишних пробелов и точек нет
  assert.equal(
    mailModeRowWithCheck(SANDBOX, { ok: false, state: "Не удалось выполнить проверку." }).hint,
    `Не удалось выполнить проверку. ${SANDBOX_HINT}`,
  );
});

test("off: проверки нет — исход, оставшийся с прежнего режима, в строку не попадает", () => {
  const off = describeMailMode({ mode: "off", sandboxRecipient: null });
  assert.deepEqual(
    mailModeRowWithCheck(off, { ok: true, state: "Тестовое письмо отправлено", hint: "" }),
    { state: off.state, title: off.title, hint: off.hint },
  );
});
