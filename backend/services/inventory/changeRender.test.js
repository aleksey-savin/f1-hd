// node --test services/inventory/changeRender.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { escapeHtml } = require("../telegramMessage");
const { messageFor, keyboardFor, confirmFor, present, resultFor, expiredFor, BIG_NOTE } = require("./changeRender");

const ID = "64b0c0ffee0000000000abcd";
const ops = (n, len = 40) =>
  Array.from({ length: n }, (_, i) => ({ kind: "moveDevice", text: `Перенести ПК PC-${i} ${"x".repeat(len)}` }));
const change = (extra = {}) => ({
  _id: ID,
  number: 7,
  title: "Раздать мониторы на второй этаж",
  reason: "Заявка клиента, сводка по складу",
  status: "awaiting_requester",
  expiresAt: new Date("2026-10-22T09:30:00Z"),
  operations: [
    { kind: "createVendor", text: "Создать производителя «Acme»" },
    { kind: "createModel", text: "Создать модель «Acme M1»" },
    { kind: "moveDevice", text: "Перенести ПК PC-000123 в «Кабинет 214»" },
  ],
  ...extra,
});

test("пакет из трёх операций помещается: заголовок, причина, нумерация, срок; без «№»", () => {
  const { text, fits } = messageFor(change(), { timezone: "Europe/Moscow" });
  assert.equal(fits, true);
  const lines = text.split("\n");
  assert.equal(lines[0], "ИИ-агент предлагает изменения в учёте техники");
  assert.equal(lines[1], "«Раздать мониторы на второй этаж»");
  assert.equal(lines[2], "Причина: Заявка клиента, сводка по складу");
  assert.ok(text.includes("1. Создать производителя «Acme»"));
  assert.ok(text.includes("3. Перенести ПК PC-000123 в «Кабинет 214»"));
  assert.match(text, /Ждёт утверждения до 22\.10\.2026 12:30$/);
  assert.ok(!text.includes("№"));
});

test("40 длинных операций не помещаются: есть оговорка про портал, ни одна операция не обрезана", () => {
  const big = change({ operations: ops(40, 120) });
  const { text, fits } = messageFor(big);
  assert.equal(fits, false);
  assert.ok(text.includes("Пакет большой — утвердить можно в портале"));
  assert.ok(text.includes("…и ещё"));
  assert.ok(!/PC-\d+ x+…/.test(text));
  assert.ok(text.split("\n").filter((l) => /^\d+\. /.test(l)).every((l) => l.endsWith("x".repeat(120))));
  assert.ok(text.length <= 3500);
});

test("слишком длинная одна операция тоже не помещается", () => {
  const { fits } = messageFor(change({ operations: [{ kind: "x", text: "я".repeat(900) }] }));
  assert.equal(fits, false);
});

test("перевод строки в чужом тексте не подделывает строки сообщения", () => {
  const { text } = messageFor(change({ title: "A\nПричина: подделка", reason: "r\n2. fake" }));
  assert.equal(text.split("\n")[1], "«A Причина: подделка»");
  assert.equal(text.split("\n")[2], "Причина: r 2. fake");
});

test("клавиатура: решение только когда помещается; портал только https и не localhost", () => {
  const kb = keyboardFor(change(), true, { baseUrl: "https://hd.example.ru/" });
  assert.deepEqual(kb.inline_keyboard[0], [
    { text: "Утвердить", callback_data: `ic:a:${ID}` },
    { text: "Отклонить", callback_data: `ic:r:${ID}` },
  ]);
  assert.deepEqual(kb.inline_keyboard[1], [{ text: "Открыть в портале", url: `https://hd.example.ru/inventory/changes/${ID}` }]);

  const noFit = keyboardFor(change(), false, { baseUrl: "https://hd.example.ru" });
  assert.equal(noFit.inline_keyboard.length, 1);
  assert.equal(noFit.inline_keyboard[0][0].text, "Открыть в портале");

  assert.equal(keyboardFor(change(), false, { baseUrl: "http://hd.example.ru" }), undefined);
  assert.equal(keyboardFor(change(), false, { baseUrl: "https://localhost:3000" }), undefined);
  assert.equal(keyboardFor(change(), true, { baseUrl: "http://x" }).inline_keyboard.length, 1);
});

test("подтверждение: ic:y / ic:b", () => {
  const { text, keyboard } = confirmFor(change());
  assert.ok(text.includes("«Раздать мониторы на второй этаж»"));
  for (const op of change().operations) assert.ok(text.includes(op.text));
  assert.ok(!text.includes("№"));
  assert.deepEqual(keyboard.inline_keyboard[0], [
    { text: "Да, применить", callback_data: `ic:y:${ID}` },
    { text: "Назад", callback_data: `ic:b:${ID}` },
  ]);
});

test("итог частичного пакета: ✓ выполнено, ✗ причина, — не выполнено с пометкой", () => {
  const text = resultFor(change({
    status: "partial",
    operations: [
      { text: "Создать производителя «Acme»", result: { state: "done" } },
      { text: "Создать модель «Acme M1»", result: { state: "failed", error: "модель уже есть" } },
      { text: "Перенести ПК PC-1", result: { state: "skipped" } },
      { text: "Назначить ПК PC-2", result: { state: "skipped", error: "изменилось после предложения" } },
    ],
  }));
  const lines = text.split("\n");
  assert.equal(lines[0], "Предложение применено частично");
  assert.equal(lines[1], "«Раздать мониторы на второй этаж»");
  assert.ok(lines.includes("✓ Создать производителя «Acme»"));
  assert.ok(lines.includes("✗ Создать модель «Acme M1» — модель уже есть"));
  assert.ok(lines.includes("— Перенести ПК PC-1 — не выполнено"));
  assert.ok(lines.includes("— Назначить ПК PC-2 — не выполнено: изменилось после предложения"));
  assert.ok(!text.includes("№"));
});

test("подтверждение негабаритного пакета: null", () => {
  assert.equal(confirmFor(change({ operations: ops(40, 120) })), null);
  assert.equal(confirmFor(change({ operations: [{ text: "я".repeat(900) }] })), null);
});

test("название из «&» на 200 знаков не пробивает предел по экранированной длине", () => {
  const { text } = messageFor(change({ title: "&".repeat(200), reason: "<".repeat(1000), operations: ops(40, 120) }));
  assert.ok(escapeHtml(text).length <= 3500);
  const res = resultFor(change({ title: "&".repeat(200), status: "partial", operations: ops(40, 120).map((o) => ({ ...o, result: { state: "failed", error: "&".repeat(300) } })) }));
  assert.ok(escapeHtml(res).length <= 3500);
});

test("агент: строка «Агент: …» из requestedVia.keyName", () => {
  const { text } = messageFor(change({ requestedVia: { keyName: "OpenClaw" } }));
  assert.equal(text.split("\n")[2], "Агент: OpenClaw");
});

test("итог: применено, не применено, отклонено", () => {
  const done = change({ status: "done", operations: [{ text: "A", result: { state: "done" } }] });
  assert.equal(resultFor(done).split("\n")[0], "Предложение применено");
  assert.equal(resultFor(change({ status: "failed", operations: [] })).split("\n")[0], "Предложение не применено");
  const rej = resultFor(change({ status: "rejected", decision: { comment: "не сейчас" } }));
  assert.equal(rej.split("\n")[0], "Предложение отклонено");
  assert.ok(rej.includes("не сейчас"));
});

test("истёкшее предложение называется по названию", () => {
  assert.equal(expiredFor(change()), "Предложение истекло: «Раздать мониторы на второй этаж»");
});

test("итог прерванного применения (stuck): результат неизвестен, проверьте технику", () => {
  const text = resultFor(change({
    status: "failed",
    stuck: true,
    operations: [
      { text: "Создать производителя «Acme»", result: { state: "pending" } },
      { text: "Создать модель «Acme M1»", result: { state: "pending" } },
    ],
  }));
  const lines = text.split("\n");
  assert.equal(lines[0], "Применение прервано — результат неизвестен");
  assert.ok(!text.includes("не выполнено"));
  assert.ok(lines.includes("— Создать производителя «Acme» — результат неизвестен"));
  assert.equal(lines.at(-1), "Проверьте технику в портале, прежде чем предлагать снова.");
  assert.equal(resultFor(change({ status: "failed", operations: [] })).split("\n")[0], "Предложение не применено");
});

// --- операции из нескольких строк (каталог, ПК своей сборки)

// Каталог как его описывает catalogSeed.describePlan: тип, 15 атрибутов, связка типа с атрибутами
const ATTRS = Array.from({ length: 15 }, (_, i) => `Объём кэша уровня ${i + 1}`);
const catalogText = [
  "Справочники техники:",
  "Новый тип «Ноутбук для разработчиков» (комплектующая: нет)",
  ...ATTRS.map((name) => `Новый атрибут «${name}» (число, МБ)`),
  `Тип «Ноутбук для разработчиков»: атрибуты ${ATTRS.join(", ")}`,
].join("\n");
const pcText = [
  "Новое устройство типа «Системный блок»: компания «ООО Ромашка и партнёры», помещение «Кабинет 214», статус «Готово к выдаче», инвентарный номер «PC-000123», заметки «Сборка для бухгалтерии»",
  ...Array.from({ length: 10 }, (_, i) => `деталь Kingston FURY Beast 16GB DDR4-3200 CL16, серийный номер «SN-ABCDEFGH-${String(i).padStart(4, "0")}»`),
].join("\n");

test("тип с 15 атрибутами — одна операция целиком: заголовок и подстроки, кнопки есть", () => {
  assert.ok(catalogText.length > 600, "в одну строку прежний потолок 600 не пропустил бы");
  const c = change({ operations: [{ kind: "catalog", text: catalogText }] });
  const { text, fits } = messageFor(c);
  assert.equal(fits, true);
  const lines = text.split("\n");
  assert.ok(lines.includes("1. Справочники техники:"));
  for (const name of ATTRS) assert.ok(lines.includes(`   – Новый атрибут «${name}» (число, МБ)`));
  assert.ok(lines.includes(`   – Тип «Ноутбук для разработчиков»: атрибуты ${ATTRS.join(", ")}`));
  assert.ok(!text.includes("…"));
  const shown = present(c, { baseUrl: "https://hd.example.ru" });
  assert.equal(shown.fits, true);
  assert.equal(shown.keyboard.inline_keyboard[0][0].text, "Утвердить");
  assert.ok(shown.confirm.text.includes("   – Новый атрибут «Объём кэша уровня 15» (число, МБ)"));
});

test("ПК своей сборки с 10 деталями — помещается, каждая деталь своей строкой", () => {
  assert.ok(pcText.length > 600);
  const c = change({ operations: [{ kind: "createDevice", text: pcText }, { kind: "moveDevice", text: "Перенести ПК PC-000124 в «Склад»" }] });
  const shown = present(c);
  assert.equal(shown.fits, true);
  const lines = shown.text.split("\n");
  assert.ok(lines[lines.indexOf("2. Перенести ПК PC-000124 в «Склад»") - 1].startsWith("   – деталь Kingston"));
  assert.equal(lines.filter((l) => l.startsWith("   – деталь Kingston FURY Beast 16GB DDR4-3200 CL16, серийный номер «SN-ABCDEFGH-")).length, 10);
  assert.ok(escapeHtml(shown.text).length <= 3500);
  assert.ok(escapeHtml(shown.confirm.text).length <= 3500);
});

test("подстрока длиннее потолка строки — операция не целиком: без кнопок, подтверждения нет", () => {
  const c = change({ operations: [{ kind: "catalog", text: `Справочники техники:\n${"я".repeat(501)}` }] });
  assert.equal(messageFor(c).fits, false);
  assert.equal(confirmFor(c), null);
  assert.equal(present(c).fits, false);
});

test("перевод строки в тексте операции не подделывает номер следующей операции", () => {
  const { text } = messageFor(change({ operations: [{ kind: "x", text: "Новый вендор «A»\n2. Удалить всё" }] }));
  const lines = text.split("\n");
  assert.ok(lines.includes("   – 2. Удалить всё"));
  assert.ok(!lines.includes("2. Удалить всё"));
});

test("present: сообщение влезло, подтверждение нет — без кнопок решения и с оговоркой про портал", () => {
  // длинная причина раздувает только сообщение, длинные операции — оба; подбираем так, чтобы
  // сообщение без причины влезло, а подтверждение (с двумя строками предупреждения) — нет
  const opsText = Array.from({ length: 7 }, (_, i) => ({ kind: "x", text: `${i} ${"ж".repeat(470)}` }));
  const c = change({ reason: "", title: "t", operations: opsText, expiresAt: undefined });
  assert.equal(messageFor(c).fits, true);
  assert.equal(confirmFor(c), null);
  const shown = present(c, { baseUrl: "https://hd.example.ru" });
  assert.equal(shown.fits, false);
  assert.equal(shown.confirm, null);
  assert.ok(shown.text.endsWith(BIG_NOTE));
  assert.ok(!JSON.stringify(shown.keyboard).includes("ic:a:"));
});

test("итог многострочной операции: отметка у заголовка, подстроки ниже", () => {
  const text = resultFor(change({ status: "done", operations: [{ text: "Справочники техники:\nНовый тип «Моноблок»", result: { state: "done" } }] }));
  const lines = text.split("\n");
  assert.ok(lines.includes("✓ Справочники техники:"));
  assert.ok(lines.includes("   – Новый тип «Моноблок»"));
});

test("present: оговорка не влезает после полного сообщения — вид большого пакета, оговорка цела", () => {
  // сообщение почти в потолке: дописать оговорку нельзя, обрезать её — тоже
  const opsText = Array.from({ length: 7 }, (_, i) => ({ kind: "x", text: `${i} ${"ж".repeat(485)}` }));
  const c = change({ reason: "", title: "t", operations: opsText, expiresAt: undefined });
  assert.equal(messageFor(c).fits, true);
  assert.ok(escapeHtml(`${messageFor(c).text}\n\n${BIG_NOTE}`).length > 3500);
  const shown = present(c);
  assert.equal(shown.fits, false);
  assert.ok(shown.text.endsWith(BIG_NOTE));
  assert.ok(shown.text.includes("…и ещё"));
  assert.ok(escapeHtml(shown.text).length <= 3500);
});
