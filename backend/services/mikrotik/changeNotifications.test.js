// node --test services/mikrotik/changeNotifications.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ROLLBACK_NOTE,
  stepMessage,
  stepKeyboard,
  confirmText,
  confirmFull,
  confirmKeyboard,
  resultMessage,
  createChangeNotifier,
} = require("./changeNotifications");

const NOW = new Date("2026-10-10T09:00:00Z");
const ctx = {
  deviceName: "F1-VLD-GW01",
  companyName: "F1Lab",
  requesterName: "Алексей Савин",
  agentName: "OpenClaw",
  timezone: "Europe/Moscow",
  now: NOW,
  users: new Map(),
};
const ok = (id, extra = {}) => ({
  _id: id,
  firstName: `И${id}`,
  lastName: `Ф${id}`,
  email: `${id}@x.ru`,
  telegramBot: { isActive: true, chatId: `chat-${id}` },
  ...extra,
});
const cmd = (text, extra = {}) => ({ text, action: "add", risk: "normal", ...extra });
const change = (extra = {}) => ({
  _id: "c14",
  number: 14,
  title: "WireGuard для Ивана Петрова",
  requestedBy: "req",
  responsible: "resp",
  status: "awaiting_requester",
  risk: "normal",
  expiresAt: new Date("2026-10-11T09:38:00Z"),
  commands: [
    cmd("/interface wireguard peers add interface=wireguard1 public-key=‹создаст HD›"),
    cmd("/ip firewall address-list set [find where list=x]", {
      action: "set",
      params: { disabled: "yes" },
      before: { disabled: "no" },
    }),
  ],
  steps: [
    { role: "requester", user: "req" },
    { role: "responsible", user: "resp" },
  ],
  ...extra,
});

test("сообщение шага: номер, устройство, компания, название, просит, команды, было, риск, срок", () => {
  const { text, fits } = stepMessage(change(), ctx);
  assert.equal(fits, true);
  assert.match(text, /^Запрос на изменение конфигурации\nF1-VLD-GW01, F1Lab\n\nWireGuard для Ивана Петрова\nПросит: Алексей Савин\nАгент: OpenClaw\n\nКоманды \(2\):\n1\. \/interface/);
  assert.match(text, /2\. \/ip firewall address-list set .*\n {3}было: disabled=no/);
  assert.match(text, /Риск обычный\. Истекает завтра в 12:38\.$/);
});

test("второй шаг: «подтвердил в …»", () => {
  const c = change({
    status: "awaiting_responsible",
    steps: [
      { role: "requester", user: "req", decision: "approve", decidedAt: new Date("2026-10-10T09:41:00Z") },
      { role: "responsible", user: "resp" },
    ],
  });
  assert.match(stepMessage(c, ctx).text, /Просит: Алексей Савин \(подтвердил в 12:41\)/);
});

test("высокий риск: строка про обрыв связи стоит перед командами", () => {
  const c = change({ risk: "high" });
  const { text } = stepMessage(c, ctx);
  const warn = text.indexOf("Может оборвать связь с устройством");
  assert.ok(warn > 0 && warn < text.indexOf("Команды (2):"));
  assert.match(text, /Риск высокий\./);
});

test("30 длинных команд: не помещается, список обрезан, кнопок решения нет", () => {
  const long = "/ip firewall address-list add list=big comment=" + "x".repeat(150);
  const c = change({ commands: Array.from({ length: 30 }, () => cmd(long)) });
  const { text, fits } = stepMessage(c, ctx);
  assert.equal(fits, false);
  assert.ok(text.length <= 3500);
  assert.match(text, /…и ещё \d+ — откройте запрос в HD$/);
  const kb = stepKeyboard(c, fits, { baseUrl: "https://hd.example.com" });
  assert.ok(!JSON.stringify(kb).includes("mc:"));
  assert.equal(kb.inline_keyboard[0][0].text, "Открыть в HD");
});

test("кнопки: шаг заявителя при двух шагах — «Подтвердить», иначе «Утвердить»", () => {
  const opts = { baseUrl: "https://hd.example.com" };
  const k1 = stepKeyboard(change(), true, opts);
  assert.deepEqual(k1.inline_keyboard[0], [
    { text: "Подтвердить", callback_data: "mc:a:c14" },
    { text: "Отклонить", callback_data: "mc:r:c14" },
  ]);
  assert.deepEqual(k1.inline_keyboard[1], [
    { text: "Открыть в HD", url: "https://hd.example.com/devices/mikrotik/changes/c14" },
  ]);
  const second = change({
    status: "awaiting_responsible",
    steps: [{ role: "requester", user: "req", decision: "approve" }, { role: "responsible", user: "resp" }],
  });
  assert.equal(stepKeyboard(second, true, opts).inline_keyboard[0][0].text, "Утвердить");
  const only = change({ steps: [{ role: "requester", user: "req" }] });
  assert.equal(stepKeyboard(only, true, opts).inline_keyboard[0][0].text, "Утвердить");
});

test("localhost или http: кнопки-ссылки нет вовсе", () => {
  for (const baseUrl of ["http://localhost:3000", "", "http://hd.example.com", "https://localhost"]) {
    const kb = stepKeyboard(change(), true, { baseUrl });
    assert.ok(!JSON.stringify(kb).includes("url"), baseUrl);
    assert.equal(kb.inline_keyboard.length, 1);
  }
  assert.equal(stepKeyboard(change(), false, { baseUrl: "" }), undefined);
});

test("«Вы уверены?»: число команд, устройство, ROLLBACK_NOTE", () => {
  const text = confirmText(change(), ctx);
  assert.match(text, /^Запрос на изменение конфигурации, F1-VLD-GW01, F1Lab\nWireGuard для Ивана Петрова\n\nПрименить 2 команды на роутере\?\nHD снимет резервную копию\. /);
  assert.ok(text.endsWith(ROLLBACK_NOTE));
  assert.deepEqual(confirmKeyboard(change()).inline_keyboard[0].map((b) => b.text), ["Да, применить", "Назад"]);
});

test("итог: применён, с копией и сроком конфигурации", () => {
  const c = change({
    status: "applied",
    steps: [
      { role: "requester", user: "req", decision: "approve", decidedAt: new Date("2026-10-10T09:41:00Z") },
      { role: "responsible", user: "resp", decision: "approve", decidedAt: new Date("2026-10-10T09:51:00Z") },
    ],
    wireguard: { keysExpireAt: new Date("2026-10-11T09:52:00Z") },
  });
  const users = new Map([["resp", ok("resp", { firstName: "Олег", lastName: "Миронов" })]]);
  const text = resultMessage(c, { ...ctx, users, backupAt: new Date("2026-10-10T09:51:00Z") });
  assert.match(text, /^Запрос на изменение конфигурации применён\nF1-VLD-GW01, F1Lab\nWireGuard для Ивана Петрова\n\n2 команды выполнены, устройство отвечает\./);
  assert.match(text, /Утвердил: Олег Миронов, 12:51/);
  assert.match(text, /Резервная копия снята в 12:51\./);
  assert.match(text, /Конфигурация для сотрудника готова, скачать можно до 11\.10, 12:52\./);
});

test("итог: откачен, не применён, отклонён, истёк", () => {
  const titles = {
    rolled_back: "Запрос на изменение конфигурации откачен",
    not_applied: "Запрос на изменение конфигурации не применён",
    rejected: "Запрос на изменение конфигурации отклонён",
    expired: "Запрос на изменение конфигурации истёк",
  };
  for (const [status, head] of Object.entries(titles)) {
    assert.ok(resultMessage(change({ status, failure: "boom" }), ctx).startsWith(head), status);
  }
  assert.match(resultMessage(change({ status: "expired" }), ctx), /Никто не решил за 24 часа/);
});

test("в Telegram-текстах нет HTML и значений подстановок", () => {
  const c = change({ risk: "high", status: "applied", failure: null });
  for (const t of [stepMessage(c, ctx).text, confirmText(c, ctx), resultMessage(c, ctx)]) {
    assert.ok(!/<[a-z/][^>]*>/i.test(t), t);
  }
});

// ---------------------------------------------------------------- адресаты

const prefsOn = { notify: { byTelegram: { isActive: true }, byEmail: { isActive: true }, personal: { mikrotikChange: true } } };

function harness({ prefs = prefsOn, baseUrl = "https://hd.example.com", people } = {}) {
  const dir = new Map(
    (people || ["req", "resp", "other"]).map((id) => [id, ok(id)]),
  );
  const saved = [];
  const pushed = [];
  const notifier = createChangeNotifier({
    loadUsers: async (ids) => ids.map((i) => dir.get(String(i))).filter(Boolean),
    loadContext: async () => ({ ...ctx, users: dir }),
    loadPrefs: async () => prefs,
    saveNotifications: async (docs) => void saved.push(...docs),
    pushInApp: async (args) => void pushed.push(args),
    baseUrl,
    log: { log() {} },
  });
  return { notifier, saved, pushed, dir };
}
const bellIds = (pushed) => pushed.flatMap((p) => p.recipients.map((u) => u._id)).sort();
const tgIds = (saved) => saved.filter((d) => d.instrument === "telegram").map((d) => d.to.chatId).sort();

test("step: только человек текущего шага; три канала; колокольчик с force", async () => {
  const { notifier, saved, pushed } = harness();
  await notifier.step(change());
  assert.deepEqual(bellIds(pushed), ["req"]);
  assert.equal(pushed[0].force, true);
  assert.equal(pushed[0].category, "mikrotikChange");
  assert.equal(pushed[0].kind, "mikrotikChangeStep");
  assert.equal(pushed[0].link, "/devices/mikrotik/changes/c14");
  assert.equal(pushed[0].title, "Запрос на изменение конфигурации ждёт вашего решения");
  const tg = saved.find((d) => d.instrument === "telegram");
  assert.equal(tg.to.chatId, "chat-req");
  assert.equal(tg.replyMarkup.inline_keyboard[0][0].callback_data, "mc:a:c14");
  const mail = saved.find((d) => d.instrument === "email");
  assert.equal(mail.title, "Запрос на изменение конфигурации: F1-VLD-GW01");
  assert.equal(mail.to.email, "req@x.ru");
  assert.equal(mail.replyMarkup, undefined);
  // Финальная волна (A3): письмо — HTML, ссылка настоящая
  assert.ok(mail.text.endsWith('<a href="https://hd.example.com/devices/mikrotik/changes/c14">Открыть в HD</a>'));
  assert.ok(!/mc:/.test(JSON.stringify(mail)));
});

test("step на втором шаге — ответственному", async () => {
  const { notifier, pushed } = harness();
  await notifier.step(change({
    status: "awaiting_responsible",
    steps: [{ role: "requester", user: "req", decision: "approve" }, { role: "responsible", user: "resp" }],
  }));
  assert.deepEqual(bellIds(pushed), ["resp"]);
});

test("decided с отказом — заявителю и решавшим, без повторов", async () => {
  const { notifier, pushed, saved } = harness();
  await notifier.decided(change({
    status: "rejected",
    steps: [
      { role: "requester", user: "req", decision: "approve" },
      { role: "responsible", user: "resp", decision: "reject", comment: "Нет" },
    ],
  }));
  assert.deepEqual(bellIds(pushed), ["req", "resp"]);
  assert.deepEqual(tgIds(saved), ["chat-req", "chat-resp"]);
  assert.equal(pushed[0].title, "Запрос на изменение конфигурации отклонён");
  assert.match(pushed[0].text, /Нет/);
  assert.ok(!JSON.stringify(saved.map((d) => d.replyMarkup)).includes("mc:"));
});

test("result — заявителю и всем решавшим; заявитель-он-же-решавший один раз", async () => {
  const { notifier, pushed } = harness();
  await notifier.result(change({
    status: "applied",
    requestedBy: "req",
    steps: [
      { role: "requester", user: "req", decision: "approve" },
      { role: "responsible", user: "resp", decision: "approve" },
    ],
  }));
  assert.deepEqual(bellIds(pushed), ["req", "resp"]);
  assert.equal(pushed[0].kind, "mikrotikChangeResult");
  // решавший не из заявителей
  const h = harness();
  await h.notifier.result(change({
    status: "rolled_back",
    steps: [{ role: "responsible", user: "other", decision: "approve" }],
  }));
  assert.deepEqual(bellIds(h.pushed), ["other", "req"]);
});

test("reminder — тому, чей шаг", async () => {
  const { notifier, pushed, saved } = harness();
  await notifier.reminder(change());
  assert.deepEqual(bellIds(pushed), ["req"]);
  assert.match(pushed[0].title, /истекает через 2 часа/);
  assert.match(saved.find((d) => d.instrument === "telegram").text, /^Запрос истекает через 2 часа/);
});

test("expired — заявителю и тому, чей был шаг", async () => {
  const { notifier, pushed } = harness();
  await notifier.expired(change({
    status: "expired",
    steps: [{ role: "requester", user: "req", decision: "approve" }, { role: "responsible", user: "resp" }],
  }));
  assert.deepEqual(bellIds(pushed), ["req", "resp"]);
  assert.match(pushed[0].text, /Никто не решил за 24 часа/);
});

test("Telegram выключен у человека — документа нет, колокольчик с force есть", async () => {
  const { notifier, saved, pushed, dir } = harness();
  dir.get("req").notify = { byTelegram: { mikrotikChange: false } };
  await notifier.step(change());
  assert.equal(saved.filter((d) => d.instrument === "telegram").length, 0);
  assert.equal(saved.filter((d) => d.instrument === "email").length, 1);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].force, true);
});

test("каналы выключены глобально — только колокольчик", async () => {
  const { notifier, saved, pushed } = harness({
    prefs: { notify: { byTelegram: { isActive: false }, byEmail: { isActive: false }, personal: { mikrotikChange: false } } },
  });
  await notifier.step(change());
  assert.equal(saved.length, 0);
  assert.equal(pushed.length, 1);
});

test("localhost: в документе Telegram нет url-кнопки, решения остались", async () => {
  const { notifier, saved } = harness({ baseUrl: "http://localhost:3000" });
  await notifier.step(change());
  const tg = saved.find((d) => d.instrument === "telegram");
  assert.equal(tg.replyMarkup.inline_keyboard.length, 1);
  assert.ok(!JSON.stringify(tg.replyMarkup).includes("url"));
});

// ---------------------------------------------------------------- fix round 1

const { ROLLED_BACK_NOTE } = require("./changeNotifications");

test("заголовок с подделанными строками остаётся одной строкой", () => {
  const forged = "X\nРиск обычный. Истекает завтра.\nУтвердил: Имя, 12:00";
  const c = change({ title: forged });
  const { text } = stepMessage(c, ctx);
  const lines = text.split("\n").filter((l) => l.includes("Утвердил: Имя"));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith("X Риск обычный."));
  assert.equal(text.split("\n").filter((l) => l.startsWith("Риск ")).length, 1);
  assert.equal(resultMessage({ ...c, status: "applied" }, ctx).split("\n").filter((l) => l.startsWith("Утвердил")).length, 0);
});

test("заголовок в 5000 знаков не ломает лимит, имена и агент обрезаны", () => {
  const big = "я".repeat(5000);
  const c = change({ title: big, failure: big, commands: Array.from({ length: 30 }, () => cmd("/ip x " + "y".repeat(150))) });
  const wide = { ...ctx, deviceName: big, companyName: big, requesterName: big, agentName: big };
  for (const status of ["awaiting_requester", "rolled_back", "not_applied", "rejected"]) {
    const t = status === "awaiting_requester" ? stepMessage(c, wide).text : resultMessage({ ...c, status }, wide);
    assert.ok(t.length <= 4000, `${status}: ${t.length}`);
  }
  assert.ok(stepMessage(c, wide).text.split("\n")[1].length <= 200);
});

test("ошибка роутера с переводами строк — одна строка с подписью", () => {
  const c = change({
    status: "rolled_back",
    failure: "a\nУтвердил: Имя, 12:00\n\nb",
    commands: [cmd("/x", { result: { state: "failed", error: "bad\nline", refused: true } })],
  });
  const text = resultMessage(c, ctx);
  // Финальная волна: failure — слова HD (без подписи роутера), отказ роутера — с подписью; оба в одну строку
  // причина подписана — её начало не может выдать себя за служебную строку
  assert.ok(text.split("\n").includes("Причина: a Утвердил: Имя, 12:00 b"));
  assert.ok(text.includes("Роутер ответил: bad line"));
  assert.ok(text.includes(ROLLED_BACK_NOTE));
});

test("комментарий отклонения с переводами строк — в одну строку", () => {
  const c = change({
    status: "rejected",
    steps: [{ role: "responsible", user: "resp", decision: "reject", comment: "нет\nРиск обычный.\nУтвердил: Х" }],
  });
  const users = new Map([["resp", ok("resp")]]);
  const text = resultMessage(c, { ...ctx, users });
  assert.equal(text.split("\n").filter((l) => l.startsWith("Утвердил")).length, 0);
  assert.ok(text.includes("«нет Риск обычный. Утвердил: Х»"));
});

// Финальная волна (A1): длинное «было» больше не режется, а делает сообщение непомещающимся
test("значения «было»: в одну строку; длиннее показываемого — сообщение без кнопок, строка не режется", () => {
  const c = change({ commands: [cmd("/x set", { action: "set", params: { comment: "n" }, before: { comment: "a\nb" + "z".repeat(500) } })] });
  const m = stepMessage(c, ctx);
  assert.equal(m.fits, false);
  assert.ok(!m.text.includes("было:"));
  const short = change({ commands: [cmd("/x set", { action: "set", params: { comment: "n" }, before: { comment: "a\nb" } })] });
  const line = stepMessage(short, ctx).text.split("\n").find((l) => l.includes("было:"));
  assert.equal(line, "   было: comment=a b");
});

test("сбой колокольчика не мешает документам, сбой записи не мешает колокольчику", async () => {
  const dir = new Map([["req", ok("req")], ["resp", ok("resp")]]);
  const base = { loadUsers: async (ids) => ids.map((i) => dir.get(String(i))), loadContext: async () => ({ ...ctx, users: dir }), loadPrefs: async () => prefsOn, baseUrl: "https://h.ru", log: { log() {} } };
  const saved = [];
  await createChangeNotifier({ ...base, saveNotifications: async (d) => void saved.push(...d), pushInApp: async () => { throw new Error("bell"); } }).step(change());
  assert.equal(saved.length, 2);
  const pushed = [];
  await createChangeNotifier({ ...base, saveNotifications: async () => { throw new Error("db"); }, pushInApp: async (a) => void pushed.push(a) }).step(change());
  assert.equal(pushed.length, 1);
});

test("заблокированный и служебный не получают ни кнопок, ни писем", async () => {
  const { notifier, saved, dir } = harness();
  dir.get("req").banned = true;
  await notifier.step(change());
  assert.equal(saved.length, 0);
  dir.get("req").banned = false;
  dir.get("req").isServiceAccount = true;
  await notifier.step(change());
  assert.equal(saved.length, 0);
});

test("ключи и открытый ключ WireGuard не попадают ни в один текст", async () => {
  const secrets = ["PUB-KEY-AAA", "PRIV-ENC-BBB", "PSK-ENC-CCC"];
  const wireguard = { publicKey: secrets[0], privateKey: secrets[1], presharedKey: secrets[2], keysExpireAt: new Date("2026-10-11T09:52:00Z") };
  for (const [method, extra] of [["step", {}], ["result", { status: "applied" }]]) {
    const { notifier, saved, pushed } = harness();
    await notifier[method](change({ wireguard, ...extra, steps: [{ role: "requester", user: "req", decision: "approve" }, { role: "responsible", user: "resp", decision: "approve" }].slice(0, method === "step" ? 0 : 2).concat(method === "step" ? [{ role: "requester", user: "req" }] : []) }));
    const all = JSON.stringify([saved, pushed]);
    assert.ok(saved.length > 0 && pushed.length > 0);
    for (const s of secrets) assert.ok(!all.includes(s), s);
  }
  for (const t of [stepMessage(change({ wireguard }), ctx).text, confirmText(change({ wireguard }), ctx)]) {
    for (const s of secrets) assert.ok(!t.includes(s));
  }
});

test("cancelled — только тому, чей шаг ждал; сам заявитель не уведомляется", async () => {
  const { notifier, pushed } = harness();
  await notifier.cancelled(change({
    status: "cancelled",
    steps: [{ role: "requester", user: "req", decision: "approve" }, { role: "responsible", user: "resp" }],
  }));
  assert.deepEqual(bellIds(pushed), ["resp"]);
  assert.equal(pushed[0].title, "Запрос на изменение конфигурации отозван");
  assert.match(pushed[0].text, /отозвал/);
  // ждал сам заявитель — писать некому
  const h = harness();
  await h.notifier.cancelled(change({ status: "cancelled" }));
  assert.deepEqual(bellIds(h.pushed), []);
});

test("confirmFull: вопрос подтверждения, затем все команды с «было»", () => {
  const text = confirmFull(change(), ctx);
  assert.ok(text.startsWith(confirmText(change(), ctx)));
  assert.match(text, /\n\nКоманды \(2\):\n1\. \/interface wireguard peers add/);
  assert.match(text, /\n2\. \/ip firewall address-list set/);
  assert.match(text, /было: disabled=no/);
  // каждая команда из исходного сообщения видна и на шаге подтверждения
  const step = stepMessage(change(), ctx);
  for (const line of step.text.split("\n").filter((l) => /^\d+\. /.test(l))) assert.ok(text.includes(line));
});

test("confirmFull: не помещается в 4000 знаков — null", () => {
  const many = change({ commands: Array.from({ length: 30 }, (_, i) => cmd(`/ip firewall address-list add list=x address=10.0.0.${i} comment=${"я".repeat(150)}`)) });
  assert.equal(confirmFull(many, ctx), null);
});

// --- parse mode: в Telegram уходит HTML-экранированный текст, везде в остальном — обычный

const unescape = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const nasty = () => change({
  title: "Правка <b>x</b> & y > z",
  commands: [cmd("/ip firewall address-list add comment=<b>&</b>>")],
});

test("parse mode: документ Telegram и письмо экранированы, колокольчик — нет, видимое то же", async () => {
  const { notifier, saved, pushed } = harness();
  await notifier.step(nasty());
  const tg = saved.find((d) => d.instrument === "telegram");
  const mail = saved.find((d) => d.instrument === "email");
  assert.ok(!/<b>/.test(tg.text));
  assert.match(tg.text, /&lt;b&gt;x&lt;\/b&gt; &amp; y &gt; z/);
  // Финальная волна (A3): outbox отдаёт text письма как HTML
  assert.ok(!/<b>/.test(mail.text));
  assert.match(mail.text, /&lt;b&gt;x&lt;\/b&gt; &amp; y &gt; z/);
  assert.match(pushed[0].text, /<b>x<\/b> & y > z/);
  assert.equal(unescape(tg.text), stepMessage(nasty(), ctx).text);
});

test("parse mode: итог тоже экранирован для Telegram", async () => {
  const { notifier, saved } = harness();
  await notifier.result(nasty());
  const tg = saved.find((d) => d.instrument === "telegram");
  assert.ok(!/<b>/.test(tg.text));
});

test("parse mode: fits и потолок считаются по экранированной длине", () => {
  // 25 команд из «&»: обычная длина меньше 3500, экранированная (&amp;) — больше
  const amp = change({ commands: Array.from({ length: 25 }, () => cmd(`/x ${"&".repeat(120)}`)) });
  const m = stepMessage(amp, ctx);
  assert.equal(m.fits, false);
  assert.ok(m.text.replace(/&/g, "&amp;").length <= 4000);
  assert.equal(confirmFull(amp, ctx), null);
  const r = resultMessage(change({ status: "applied", title: "<".repeat(5000) }), { ...ctx });
  assert.ok(r.replace(/</g, "&lt;").length <= 4000);
});

// ---------------------------------------------------------------- финальная волна: A1

const { displayCommand } = require("./changeRender");

// Пир WireGuard, у которого первым идёт длинный комментарий: всё важное — за 600-м знаком
const hiddenPeer = () => {
  const command = {
    path: "/interface wireguard peers",
    action: "add",
    params: { comment: "к".repeat(490), interface: "wireguard1", "public-key": "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg=", "allowed-address": "0.0.0.0/0" },
  };
  return { ...command, text: displayCommand(command), risk: "normal" };
};

test("A1: команда длиннее показываемого — fits=false, без кнопок решения, обрезанной команды в тексте нет", () => {
  const peer = hiddenPeer();
  assert.ok(peer.text.length > 600 && peer.text.length < 700, String(peer.text.length));
  const c = change({ commands: [peer] });
  const { text, fits } = stepMessage(c, ctx);
  assert.equal(fits, false);
  assert.ok(!text.includes("кккк"), "обрезанная команда не показывается");
  assert.match(text, /…и ещё 1 — откройте запрос в HD$/);
  const kb = stepKeyboard(c, fits, { baseUrl: "https://hd.example.com" });
  assert.ok(!JSON.stringify(kb).includes("mc:"));
  assert.equal(confirmFull(c, ctx), null);
});

test("A1: показываются целые команды до длинной, остальные — счётом", () => {
  const c = change({ commands: [cmd("/ip dns static add name=a address=10.0.0.1"), hiddenPeer(), cmd("/ip dns static add name=b address=10.0.0.2")] });
  const { text, fits } = stepMessage(c, ctx);
  assert.equal(fits, false);
  assert.match(text, /Команды \(3\):\n1\. \/ip dns static add name=a address=10\.0\.0\.1\n…и ещё 2 — откройте запрос в HD$/);
});

test("A1: длинное «было» — тоже не помещается, строка не режется", () => {
  const c = change({ commands: [cmd("/x set", { action: "set", params: { comment: "n" }, before: { comment: "z".repeat(121) } })] });
  const { text, fits } = stepMessage(c, ctx);
  assert.equal(fits, false);
  assert.ok(!text.includes("было:"));
  assert.equal(confirmFull(c, ctx), null);
  // ровно на границе — помещается целиком
  const edge = change({ commands: [cmd("/x set", { action: "set", params: { comment: "n" }, before: { comment: "z".repeat(120) } })] });
  assert.equal(stepMessage(edge, ctx).fits, true);
  assert.ok(stepMessage(edge, ctx).text.includes(`было: comment=${"z".repeat(120)}`));
  assert.ok(confirmFull(edge, ctx).includes(`было: comment=${"z".repeat(120)}`));
});

test("A1: обычный запрос из трёх команд помещается, с кнопками и шагом подтверждения", () => {
  const c = change({ commands: [...change().commands, cmd("/ip dns static add name=a address=10.0.0.1")] });
  const { text, fits } = stepMessage(c, ctx);
  assert.equal(fits, true);
  assert.match(text, /Команды \(3\):/);
  assert.ok(JSON.stringify(stepKeyboard(c, fits, {})).includes("mc:a:c14"));
  assert.ok(confirmFull(c, ctx).includes("3. /ip dns static add name=a address=10.0.0.1"));
});

test("A1: команда ровно в 600 знаков показывается целиком", () => {
  const text600 = `/x add comment=${"y".repeat(600 - 15)}`;
  assert.equal(text600.length, 600);
  const c = change({ commands: [cmd(text600)] });
  const m = stepMessage(c, ctx);
  assert.equal(m.fits, true);
  assert.ok(m.text.includes(text600));
});

// ---------------------------------------------------------------- финальная волна: A3 — письмо уходит как HTML

const phishing = () => change({ title: 'WG <a href="https://evil.example">Открыть в HD</a>' });

test("A3: название от агента приходит в письме экранированным, переводы строк — <br>", async () => {
  const { notifier, saved, pushed } = harness();
  await notifier.step(phishing());
  const mail = saved.find((d) => d.instrument === "email");
  assert.ok(!mail.text.includes("<a href=\"https://evil.example\">"), "чужая разметка не должна быть живой");
  assert.ok(mail.text.includes("WG &lt;a href=\"https://evil.example\"&gt;Открыть в HD&lt;/a&gt;"));
  assert.ok(!mail.text.includes("\n"));
  assert.match(mail.text, /Запрос на изменение конфигурации<br>F1-VLD-GW01, F1Lab<br><br>WG &lt;a/);
  // единственная живая ссылка — на страницу запроса, из baseUrl и фиксированного пути
  const links = mail.text.match(/<a [^>]*>/g);
  assert.deepEqual(links, ['<a href="https://hd.example.com/devices/mikrotik/changes/c14">']);
  assert.ok(mail.text.endsWith('<br><br><a href="https://hd.example.com/devices/mikrotik/changes/c14">Открыть в HD</a>'));
  assert.ok(!mail.html, "своей вёрстки нет: письмо собирается из text");
  // колокольчик — обычный текст без экранирования
  assert.ok(pushed[0].text.includes('WG <a href="https://evil.example">Открыть в HD</a>'));
  assert.ok(!pushed[0].text.includes("&lt;"));
});

test("A3: письмо об итоге тоже экранировано; без baseUrl ссылки нет", async () => {
  const { notifier, saved } = harness({ baseUrl: "" });
  await notifier.result({ ...phishing(), status: "not_applied", failure: "<script>x</script>" });
  const mail = saved.find((d) => d.instrument === "email");
  assert.ok(!/<(a|script)\b/.test(mail.text));
  assert.ok(mail.text.includes("&lt;script&gt;"));
  assert.ok(mail.text.includes("<br>"));
});

// ---------------------------------------------------------------- финальная волна: A4 — «требует проверки» и полнота итогов

const { STATUS, isFinal } = require("./changeSteps");

test("A4: needs_attention — заголовок, суть, «Что известно», утвердившие и копия", async () => {
  const c = change({
    status: "needs_attention",
    failure: "Состояние устройства неясно;\nпроверка показала: на месте команды 1",
    steps: [
      { role: "requester", user: "req", decision: "approve", decidedAt: new Date("2026-10-10T09:41:00Z") },
      { role: "responsible", user: "resp", decision: "approve", decidedAt: new Date("2026-10-10T09:51:00Z") },
    ],
  });
  const users = new Map([["req", ok("req", { firstName: "Иван", lastName: "Петров" })], ["resp", ok("resp", { firstName: "Олег", lastName: "Миронов" })]]);
  const lines = resultMessage(c, { ...ctx, users, backupAt: new Date("2026-10-10T09:52:00Z") }).split("\n");
  assert.equal(lines[0], "Запрос на изменение конфигурации требует проверки");
  assert.ok(lines.includes("HD не может поручиться за состояние устройства — проверьте его вручную."));
  assert.ok(lines.includes("Что известно: Состояние устройства неясно; проверка показала: на месте команды 1"));
  assert.ok(lines.includes("Утвердил: Олег Миронов, 12:51"));
  assert.ok(lines.includes("Резервная копия снята в 12:52."));
  assert.ok(!lines.some((l) => l.startsWith("Роутер ответил")));

  const { notifier, pushed, saved } = harness();
  await notifier.result(c);
  assert.equal(pushed[0].title, "Запрос на изменение конфигурации требует проверки");
  assert.match(pushed[0].text, /HD не может поручиться за состояние устройства/);
  assert.match(saved.find((d) => d.instrument === "telegram").text, /Что известно: Состояние устройства неясно/);
});

test("A4: у каждого итогового статуса есть заголовок и суть — в сообщении и в колокольчике", async () => {
  const finals = Object.values(STATUS).filter(isFinal);
  assert.ok(finals.length >= 7);
  const via = { [STATUS.rejected]: "decided", [STATUS.expired]: "expired", [STATUS.cancelled]: "cancelled" };
  for (const status of finals) {
    const c = change({
      status,
      steps: [
        { role: "requester", user: "req", decision: status === STATUS.rejected ? "reject" : "approve", decidedAt: NOW },
        { role: "responsible", user: "resp" },
      ],
    });
    const lines = resultMessage(c, ctx).split("\n");
    assert.notEqual(lines[0], "Запрос на изменение конфигурации", `${status}: пустой заголовок`);
    assert.match(lines[0], /^Запрос на изменение конфигурации \S+/, status);
    // тело: после заголовка, устройства, названия и пустой строки идёт суть
    assert.ok((lines[4] || "").trim().length > 5, `${status}: пустая суть`);
    const { notifier, pushed } = harness();
    await notifier[via[status] || "result"](c);
    assert.ok(pushed.length > 0, `${status}: колокольчик`);
    assert.equal(pushed[0].title, lines[0], status);
    assert.ok(String(pushed[0].text || "").trim().length > 5, `${status}: пустой текст колокольчика`);
  }
});

// ---------------------------------------------------------------- финальная волна: «Роутер ответил» — только при отказе роутера

test("слова HD не подписываются ответом роутера; отказ роутера — подписывается", () => {
  const base = { status: "rolled_back", failure: "Команда 1 не выполнилась, роутер откатил изменения" };
  const refused = resultMessage(change({ ...base, commands: [cmd("/x", { result: { state: "failed", error: "failure: already have such entry", refused: true } })] }), ctx).split("\n");
  assert.ok(refused.includes("Причина: Команда 1 не выполнилась, роутер откатил изменения"));
  assert.ok(refused.includes("Роутер ответил: failure: already have such entry"));
  assert.equal(refused.filter((l) => l.startsWith("Роутер ответил")).length, 1);

  for (const own of ["timed out", "not confirmed", "не найдена при проверке"]) {
    const lines = resultMessage(change({ ...base, commands: [cmd("/x", { result: { state: "failed", error: own } })] }), ctx).split("\n");
    assert.ok(!lines.some((l) => l.startsWith("Роутер ответил")), own);
    assert.ok(lines.includes(`Не подтверждена: ${own}`), own);
  }
});

// ---------------------------------------------------------------- финальная волна: B4 — обещание отката по режиму

const { NO_ROLLBACK_NOTE } = require("./changeNotifications");

const withMode = (value, fn) => {
  const before = process.env.MIKROTIK_CHANGE_EXECUTOR;
  if (value === undefined) delete process.env.MIKROTIK_CHANGE_EXECUTOR;
  else process.env.MIKROTIK_CHANGE_EXECUTOR = value;
  try { return fn(); } finally {
    if (before === undefined) delete process.env.MIKROTIK_CHANGE_EXECUTOR;
    else process.env.MIKROTIK_CHANGE_EXECUTOR = before;
  }
};

test("B4: safe-mode — обещание отката; api — честное «отката нет»", () => {
  assert.equal(NO_ROLLBACK_NOTE, "HD снимет резервную копию. Автоматического отката нет: если команда не пройдёт, уже применённое останется — смотрите результат по командам.");
  for (const mode of [undefined, "safe-mode"]) {
    const text = withMode(mode, () => confirmText(change(), ctx));
    assert.ok(text.endsWith(`HD снимет резервную копию. ${ROLLBACK_NOTE}`), String(mode));
    assert.ok(withMode(mode, () => confirmFull(change(), ctx)).includes(ROLLBACK_NOTE));
  }
  const api = withMode("api", () => confirmText(change(), ctx));
  assert.ok(api.endsWith(NO_ROLLBACK_NOTE));
  assert.ok(!api.includes("откатит"));
  const full = withMode("api", () => confirmFull(change(), ctx));
  assert.ok(full.includes(NO_ROLLBACK_NOTE) && !full.includes(ROLLBACK_NOTE));
  // явный признак в контексте сильнее окружения
  assert.ok(withMode("api", () => confirmText(change(), { ...ctx, rollback: true })).endsWith(ROLLBACK_NOTE));
  assert.ok(withMode(undefined, () => confirmText(change(), { ...ctx, rollback: false })).endsWith(NO_ROLLBACK_NOTE));
});

test("minors: NEL and information separators are collapsed like other line breaks", () => {
  const { stepMessage: build } = require("./changeNotifications");
  const change = {
    _id: "64aa00000000000000000001", number: 5, title: "A\u0085Риск обычный.\u001eУтвердил: X", risk: "normal",
    status: "awaiting_requester", expiresAt: new Date(Date.now() + 3600e3),
    steps: [{ role: "requester", user: "u1", decision: null }],
    commands: [{ action: "add", text: "/ip dns static add name=a address=10.0.0.1", risk: "normal" }],
  };
  const { text } = build(change, { deviceName: "GW", companyName: "Co", requesterName: "Имя Фамилия", agentName: "Agent" });
  assert.ok(!/[\u0085\u001c-\u001f]/.test(text));
  assert.equal(text.split("\n").filter((line) => line.startsWith("Риск")).length, 1);
});

test("мелочи: текст команды в Telegram не меняется (двойной пробел остаётся), причина итога подписана", () => {
  const { stepMessage: build, resultMessage: result } = require("./changeNotifications");
  const base = {
    _id: "64aa00000000000000000002", number: 6, title: "T", risk: "normal", expiresAt: new Date(Date.now() + 3600e3),
    steps: [{ role: "requester", user: "u1", decision: "approve", decidedAt: new Date() }],
    commands: [{ action: "add", text: '/ip dns static add name=a comment="a  b"', risk: "normal", result: { state: "failed", error: "failure: x", refused: true } }],
  };
  const ctx = { deviceName: "GW", companyName: "Co", requesterName: "Имя Фамилия", agentName: "Agent", users: new Map() };
  const step = build({ ...base, status: "awaiting_requester", steps: [{ role: "requester", user: "u1", decision: null }] }, ctx);
  assert.ok(step.text.includes('comment="a  b"'));
  const text = result({ ...base, status: "not_applied", failure: "Утвердил: Чужой, 12:00" }, ctx);
  assert.ok(text.split("\n").includes("Причина: Утвердил: Чужой, 12:00"));
  assert.ok(!text.split("\n").includes("Утвердил: Чужой, 12:00"));
});
