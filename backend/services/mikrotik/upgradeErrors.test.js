// node --test services/mikrotik/upgradeErrors.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { describeUpgradeError, RIGHTS_FIX } = require("./upgradeErrors");

const coded = (code, message) => Object.assign(new Error(message), { code });

test("missing rights yield the group fix command", () => {
  const out = describeUpgradeError(new Error("not enough permissions (9)"), { step: "download" });
  assert.match(out.message, /нет прав write и reboot/);
  assert.equal(out.fix, RIGHTS_FIX);
  assert.equal(RIGHTS_FIX, "/user group set hd-mgmt policy=api,read,write,reboot,test,ssh");
});

test("rights text inside an incomplete download output is still a rights error", () => {
  const out = describeUpgradeError(coded("MIKROTIK_DOWNLOAD_INCOMPLETE", "not enough permissions (9)"));
  assert.equal(out.fix, RIGHTS_FIX);
});

test("an ERROR status from check-for-updates means the device has no internet", () => {
  const out = describeUpgradeError(coded("MIKROTIK_UPDATE_STATUS", "ERROR: could not resolve dns name"), { step: "check" });
  assert.match(out.message, /не смогло связаться с сервером обновлений MikroTik/);
  assert.match(out.message, /could not resolve dns name/);
  assert.equal(out.fix, undefined);
});

test("a channel mismatch is reported as is, without the «Ошибка:» prefix", () => {
  const text = "Устройство сообщило ветку stable вместо long-term — обновление остановлено";
  const out = describeUpgradeError(coded("MIKROTIK_CHANNEL_MISMATCH", text), { step: "check" });
  assert.equal(out.message, text);
  assert.equal(out.fix, undefined);
});

test("an incomplete download says so", () => {
  const out = describeUpgradeError(coded("MIKROTIK_DOWNLOAD_INCOMPLETE", "status: finding out latest version..."));
  assert.match(out.message, /Загрузка пакета не завершилась/);
});

test("a connection failure reuses the connection message", () => {
  const out = describeUpgradeError(new Error("Socket timeout"), { step: "export" });
  assert.match(out.message, /Не удалось открыть соединение с устройством/);
});

test("an unknown error keeps its text", () => {
  const out = describeUpgradeError(new Error("что-то странное"));
  assert.equal(out.message, "Ошибка: что-то странное");
});
