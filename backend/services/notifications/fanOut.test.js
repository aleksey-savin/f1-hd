// node --test services/notifications/fanOut.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createFanOut } = require("./fanOut");

const user = (id, extra = {}) => ({ _id: id, firstName: "И", lastName: id, email: `${id}@x.ru`, telegramBot: { isActive: true, chatId: `c${id}` }, ...extra });
const prefs = { notify: { byTelegram: { isActive: true }, byEmail: { isActive: true }, personal: { demo: true } } };

function build(over = {}) {
  const saved = [], pushed = [];
  const fan = createFanOut({
    category: "demo",
    loadUsers: async (ids) => ids.map((id) => user(id)),
    loadPrefs: async () => prefs,
    saveNotifications: async (d) => void saved.push(...d),
    pushInApp: async (a) => void pushed.push(a),
    ...over,
  });
  return { fan, saved, pushed };
}
const args = { ids: ["a", "a", "b"], kind: "k", title: "T", mailTitle: "M", telegram: { text: "<x>", replyMarkup: { r: 1 } }, bell: "B", mail: "ML", link: "/l" };

test("telegram + почта на каждого, дубли ids схлопнуты, текст экранирован, колокольчик с link и force", async () => {
  const { fan, saved, pushed } = build();
  assert.equal(await fan({ number: 1 }, args), 4);
  assert.equal(saved.filter((d) => d.instrument === "telegram").length, 2);
  assert.equal(saved[0].text, "&lt;x&gt;");
  assert.equal(pushed[0].link, "/l");
  assert.equal(pushed[0].force, true);
  assert.equal(pushed[0].category, "demo");
  assert.equal(pushed[0].recipients.length, 2);
});

test("служебные и забаненные отсекаются, личный выключатель гасит канал", async () => {
  const { fan, saved } = build({
    loadUsers: async () => [user("a", { isServiceAccount: true }), user("b", { banned: true }), user("c", { notify: { byTelegram: { demo: false } } })],
  });
  assert.equal(await fan({ number: 1 }, args), 1);
  assert.equal(saved[0].instrument, "email");
});

test("сбой колокольчика не отменяет очередь; сбой очереди даёт 0", async () => {
  const a = build({ pushInApp: async () => { throw new Error("bell"); } });
  assert.equal(await a.fan({ number: 1 }, args), 4);
  const b = build({ saveNotifications: async () => { throw new Error("db"); } });
  assert.equal(await b.fan({ number: 1 }, args), 0);
});

test("telegram.force: мимо выключателей категории, но не мимо канала и привязки бота; count: telegram", async () => {
  const off = { notify: { byTelegram: { isActive: true }, byEmail: { isActive: true }, personal: { demo: false } } };
  const { fan, saved } = build({
    loadPrefs: async () => off,
    loadUsers: async () => [user("a", { notify: { byTelegram: { demo: false } } }), user("b", { telegramBot: { isActive: false, chatId: "cb" } })],
  });
  const forced = { ...args, telegram: { ...args.telegram, force: true }, count: "telegram" };
  assert.equal(await fan({ number: 1 }, forced), 1);
  assert.deepEqual(saved.map((d) => [d.instrument, d.to.chatId]), [["telegram", "ca"]]);
  // без force тот же случай — ничего
  const plain = build({ loadPrefs: async () => off, loadUsers: async () => [user("a")] });
  assert.equal(await plain.fan({ number: 1 }, args), 0);
  // канал Telegram выключен целиком — force его не обходит
  const channelOff = build({ loadPrefs: async () => ({ notify: { byTelegram: { isActive: false }, byEmail: { isActive: true }, personal: { demo: true } } }) });
  assert.equal(await channelOff.fan({ number: 1 }, forced), 0);
  assert.deepEqual(channelOff.saved.map((d) => d.instrument), ["email", "email"]);
});
