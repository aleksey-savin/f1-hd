// node --test services/inventory/changeNotifications.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createInventoryChangeNotifier, withDefaults } = require("./changeNotifications");

const ID = "64b0c0ffee0000000000abcd";
const change = (extra = {}) => ({
  _id: ID,
  number: 3,
  title: "Раздать мониторы",
  reason: "склад",
  requestedBy: "req",
  status: "awaiting_requester",
  expiresAt: new Date("2026-10-22T09:30:00Z"),
  operations: [{ kind: "createVendor", text: "Создать производителя «Acme»", result: { state: "done" } }],
  ...extra,
});
const prefs = { notify: { byTelegram: { isActive: true }, byEmail: { isActive: true }, personal: { inventoryChange: true } } };

function build(over = {}) {
  const saved = [], pushed = [];
  const notifier = createInventoryChangeNotifier({
    baseUrl: "https://hd.example.ru",
    loadUsers: async (ids) => ids.map((id) => ({ _id: id, firstName: "Иван", lastName: "Петров", email: "i@x.ru", telegramBot: { isActive: true, chatId: "77" } })),
    loadPrefs: async () => prefs,
    loadContext: async () => ({ timezone: "Europe/Moscow" }),
    saveNotifications: async (d) => void saved.push(...d),
    pushInApp: async (a) => void pushed.push(a),
    ...over,
  });
  return { notifier, saved, pushed };
}

test("proposed: заявителю telegram с кнопками решения, колокольчик на страницу предложения, письмо", async () => {
  const { notifier, saved, pushed } = build();
  // proposed считает только Telegram: письмо тоже ушло, но кнопок в нём нет
  assert.equal(await notifier.proposed(change()), 1);
  assert.equal(saved.length, 2);
  const tg = saved.find((d) => d.instrument === "telegram");
  assert.equal(tg.to.chatId, "77");
  assert.ok(tg.replyMarkup.inline_keyboard[0][0].callback_data.startsWith("ic:a:"));
  assert.ok(tg.text.includes("ИИ-агент предлагает"));
  const mail = saved.find((d) => d.instrument === "email");
  assert.ok(mail.text.includes(`https://hd.example.ru/inventory/changes/${ID}`));
  assert.equal(pushed[0].kind, "inventoryChangeProposed");
  assert.equal(pushed[0].category, "inventoryChange");
  assert.equal(pushed[0].link, `/inventory/changes/${ID}`);
  assert.ok(!pushed[0].text.includes("№"));
});

test("proposed: большой пакет — без кнопок решения", async () => {
  const { notifier, saved } = build();
  const ops = Array.from({ length: 40 }, (_, i) => ({ text: `Операция ${i} ${"я".repeat(120)}` }));
  await notifier.proposed(change({ operations: ops }));
  const tg = saved.find((d) => d.instrument === "telegram");
  assert.ok(!JSON.stringify(tg.replyMarkup).includes("ic:a:"));
});

test("result и decided: текст итога, только ссылка в портал, kind result", async () => {
  const { notifier, saved, pushed } = build();
  const done = change({ status: "done" });
  assert.equal(await notifier.result(done), 2);
  const tg = saved.find((d) => d.instrument === "telegram");
  assert.ok(tg.text.includes("Предложение применено"));
  assert.ok(tg.text.includes("✓ Создать производителя"));
  assert.equal(tg.replyMarkup.inline_keyboard.length, 1);
  assert.equal(pushed[0].kind, "inventoryChangeResult");
  await notifier.decided(change({ status: "rejected" }));
  assert.ok(saved.at(-1).text.includes("Предложение отклонено") || saved.at(-2).text.includes("Предложение отклонено"));
});

test("expired: «Предложение истекло: название»", async () => {
  const { notifier, saved, pushed } = build();
  await notifier.expired(change({ status: "expired" }));
  assert.equal(saved.find((d) => d.instrument === "telegram").text, "Предложение истекло: «Раздать мониторы»");
  assert.equal(pushed[0].kind, "inventoryChangeResult");
});

test("события не бросают: возвращают 0", async () => {
  const { notifier } = build({ loadUsers: async () => { throw new Error("db"); }, log: { log() { throw new Error("x"); } } });
  for (const ev of ["proposed", "decided", "result", "expired"]) assert.equal(await notifier[ev](change()), 0);
});

test("служебный аккаунт заявителя не получает ничего", async () => {
  const { notifier, saved } = build({ loadUsers: async (ids) => ids.map((id) => ({ _id: id, isServiceAccount: true })) });
  assert.equal(await notifier.proposed(change()), 0);
  assert.equal(saved.length, 0);
});

test("настройки без ключа категории читаются как «включено»: Telegram уходит", async () => {
  const bare = { notify: { byTelegram: { isActive: true }, byEmail: { isActive: true }, personal: {} } };
  const { notifier, saved } = build({ loadPrefs: async () => withDefaults(bare) });
  assert.equal(await notifier.proposed(change()), 1);
  assert.equal(saved.length, 2);
  assert.ok(saved.some((d) => d.instrument === "telegram"));
  // явное «выключено» остаётся выключенным
  assert.equal(withDefaults({ notify: { personal: { inventoryChange: false } } }).notify.personal.inventoryChange, false);
});

test("колокольчик: название в кавычках, без «..» при точке в конце", async () => {
  const { notifier, pushed } = build();
  await notifier.proposed(change({ title: "Раздать мониторы." }));
  assert.ok(pushed[0].text.startsWith("«Раздать мониторы.». "));
  assert.ok(!pushed[0].text.includes(".."));
});

test("proposed: Telegram мимо выключателей категории (организации и пользователя); итог — по выключателям", async () => {
  const off = { notify: { byTelegram: { isActive: true }, byEmail: { isActive: true }, personal: { inventoryChange: false } } };
  const muted = (ids) => ids.map((id) => ({ _id: id, email: "i@x.ru", telegramBot: { isActive: true, chatId: "77" }, notify: { byTelegram: { inventoryChange: false } } }));
  const { notifier, saved, pushed } = build({ loadPrefs: async () => off, loadUsers: async (ids) => muted(ids) });
  assert.equal(await notifier.proposed(change()), 1);
  assert.deepEqual(saved.map((d) => d.instrument), ["telegram"]);
  assert.ok(saved[0].replyMarkup.inline_keyboard[0][0].callback_data.startsWith("ic:a:"));
  // итог не экран решения: выключатели действуют
  assert.equal(await notifier.result(change({ status: "done" })), 0);
  assert.equal(saved.length, 1);
  assert.equal(pushed.length, 2);
});

test("proposed: без привязанного бота или с выключенным каналом Telegram — 0 сообщений Telegram", async () => {
  const noBot = build({ loadUsers: async (ids) => ids.map((id) => ({ _id: id, email: "i@x.ru", telegramBot: { isActive: false, chatId: "77" } })) });
  assert.equal(await noBot.notifier.proposed(change()), 0);
  assert.deepEqual(noBot.saved.map((d) => d.instrument), ["email"]);
  const channelOff = build({ loadPrefs: async () => ({ notify: { byTelegram: { isActive: false }, byEmail: { isActive: true }, personal: { inventoryChange: true } } }) });
  assert.equal(await channelOff.notifier.proposed(change()), 0);
});

test("уведомления: колокольчик ведёт на страницу предложения (итог и истечение)", async () => {
  const a = build();
  await a.notifier.result(change({ status: "applied" }));
  assert.equal(a.pushed[0].link, `/inventory/changes/${ID}`);
  const b = build();
  await b.notifier.expired(change({ status: "expired" }));
  assert.equal(b.pushed[0].link, `/inventory/changes/${ID}`);
});
