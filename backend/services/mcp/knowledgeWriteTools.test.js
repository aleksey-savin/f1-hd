// node --test services/mcp/knowledgeWriteTools.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createKnowledgeWriteTools, secretFields, DAILY_LIMIT } = require("./knowledgeWriteTools");

/**
 * Запись в базу знаний ИИ-агентом: что агент может завести и поправить и на
 * чём получает отказ. Источник — заготовка в памяти: модуль не знает о базе.
 */

const CALLER = { keyId: "66aa000000000000000000aa", keyName: "OpenClaw" };
const NOW = new Date("2026-10-11T10:00:00.000Z");
const id = (n) => `64f0${String(n).padStart(20, "0")}`;

const makeSource = (overrides = {}) => {
  const notes = overrides.notes || [];
  const source = {
    notes,
    created: [],
    updated: [],
    findRequester: async (telegramId) => (telegramId === "1001" ? { _id: "u1", canManage: true } : null),
    loadDirectory: async () => ({
      companies: [
        { _id: "c1", alias: "Ромашка", fullTitle: "ООО «Ромашка»" },
        { _id: "c2", alias: "Ромашка-Строй", fullTitle: "ООО «Ромашка-Строй»" },
        { _id: "c3", alias: "Василёк", fullTitle: "ООО «Василёк»" },
      ],
      categories: [{ _id: "k1", title: "Сеть" }, { _id: "k2", title: "Сетевые принтеры" }],
    }),
    listLiveNotes: async () => notes.filter((item) => item.archivedAt == null),
    countCreatedSince: async () => 0,
    findForWrite: async (noteId) => notes.find((item) => String(item._id) === noteId) || null,
    createNote: async (doc) => {
      const saved = { _id: id(100 + notes.length), title: doc.title, type: doc.type, companies: [], categories: [], agent: doc.agent, approved: false, archivedAt: null };
      notes.push(saved);
      source.created.push(doc);
      return saved;
    },
    updateNote: async (noteId, patch) => {
      source.updated.push({ noteId, patch });
      const current = notes.find((item) => String(item._id) === noteId);
      return { ...current, ...("title" in patch ? { title: patch.title } : {}) };
    },
    ...overrides,
  };
  return source;
};

const make = (overrides) => {
  const source = makeSource(overrides);
  const logs = [];
  const tools = createKnowledgeWriteTools({
    source,
    baseUrl: "https://hd.example.ru/",
    log: (level, message, meta) => logs.push(meta),
    now: () => NOW,
  });
  return { source, tools, logs };
};

const GOOD = { requester: 1001, title: "Ромашка: маршрутизатор офиса", content: "Стоит в серверной, адрес 10.0.5.1." };
const textOf = (result) => result.content[0].text;
// Причина правила полей — постоянный текст с номером строки: из присланного в ней
// нет ничего, ни имени поля, ни значения. Возвращает номера строк из ответа.
const FIELD_REASON = /^- the content sets a secret-named field to a value on line (\d+): leave the line out, remove the value, or say where the value is kept instead$/;
const fieldLines = (result) =>
  textOf(result)
    .split("\n")
    .filter((reason) => /field/.test(reason))
    .map((reason) => {
      const match = FIELD_REASON.exec(reason);
      assert.ok(match, reason);
      return Number(match[1]);
    });

const agentNote = (n, overrides = {}) => ({
  _id: id(n),
  title: `Заметка агента ${n}`,
  content: "Старый текст",
  type: "info",
  companies: [{ _id: "c3", alias: "Василёк" }],
  categories: [],
  users: [{ _id: "u9", firstName: "Пётр", lastName: "Петров" }],
  approved: true,
  agent: { keyId: CALLER.keyId, keyName: "OpenClaw", at: NOW },
  archivedAt: null,
  pendingDeletion: false,
  secretsScan: { flagged: false, ignoredHashes: [] },
  ...overrides,
});

test("create saves a draft authored by the requester and marked with the key", async () => {
  const { source, tools, logs } = make();
  const result = await tools.create({ ...GOOD, type: "instructions", companies: ["Ромашка"], categories: ["Сеть"] }, CALLER);

  assert.equal(result.isError, undefined);
  const doc = source.created[0];
  assert.equal(doc.requesterId, "u1");
  assert.deepEqual(doc.agent, { keyId: CALLER.keyId, keyName: "OpenClaw", at: NOW });
  assert.equal(doc.type, "instructions");
  assert.deepEqual(doc.companyIds, ["c1"]); // точное имя выигрывает у «Ромашка-Строй»
  assert.deepEqual(doc.categoryIds, ["k1"]);
  assert.equal(doc.plainText.includes("10.0.5.1"), true);
  assert.match(textOf(result), /https:\/\/hd\.example\.ru\/knowledge-base\//);
  assert.match(textOf(result), /unverified draft/);
  // В лог — три последние цифры, не весь id и не текст заметки
  const line = logs.at(-1);
  assert.equal(line.requester, "001");
  assert.equal(line.outcome, "created");
  assert.equal(JSON.stringify(line).includes("серверной"), false);
});

test("create refuses an unknown requester and one without the right", async () => {
  const { source, tools } = make();
  const unknown = await tools.create({ ...GOOD, requester: 7 }, CALLER);
  assert.equal(unknown.isError, true);
  assert.match(textOf(unknown), /The note was not saved:/);
  assert.match(textOf(unknown), /no employee with this Telegram id/);

  const noRight = make({ findRequester: async () => ({ _id: "u2", canManage: false }) });
  assert.match(textOf(await noRight.tools.create(GOOD, CALLER)), /not allowed to manage the knowledge base/);

  const twins = make({ findRequester: async () => ({ error: "more than one employee has this Telegram id" }) });
  assert.match(textOf(await twins.tools.create(GOOD, CALLER)), /more than one employee/);
  assert.equal(source.created.length, 0);
});

test("create reports every bad field at once", async () => {
  const { source, tools } = make();
  const result = await tools.create({ requester: 1001, title: "  ", content: "   " }, CALLER);
  assert.match(textOf(result), /title is empty/);
  assert.match(textOf(result), /content is empty/);
  assert.equal(source.created.length, 0);
});

test("a title with a line break and oversized text are refused", async () => {
  const { tools } = make();
  assert.match(textOf(await tools.create({ ...GOOD, title: "Одна\nДве" }, CALLER)), /title must be one line/);
  assert.match(textOf(await tools.create({ ...GOOD, title: "я".repeat(201) }, CALLER)), /title is longer than 200/);
  assert.match(textOf(await tools.create({ ...GOOD, content: "я".repeat(40_001) }, CALLER)), /content is longer than 40000/);
});

test("ambiguous and unknown names list the options instead of guessing", async () => {
  const { source, tools } = make();
  const several = await tools.create({ ...GOOD, categories: ["Сет"] }, CALLER);
  assert.match(textOf(several), /Several categories match "Сет": Сеть; Сетевые принтеры/);
  const none = await tools.create({ ...GOOD, companies: ["Лютик"] }, CALLER);
  assert.match(textOf(none), /No company matches "Лютик"/);
  assert.equal(source.created.length, 0);
});

test("a title that differs only by case, ё or spaces is a duplicate", async () => {
  const mine = agentNote(1, { title: "Ромашка: Маршрутизатор Офиса", approved: false });
  const { source, tools } = make({ notes: [mine] });
  const result = await tools.create({ ...GOOD, title: "  ромашка: маршрутизатор офиса " }, CALLER);
  assert.equal(result.isError, true);
  assert.match(textOf(result), new RegExp(`already exists.*${mine._id}.*update_knowledge_note`));
  assert.equal(source.created.length, 0);

  const yo = make({ notes: [agentNote(2, { title: "Учёт адресов" })] });
  assert.equal((await yo.tools.create({ ...GOOD, title: "Учет адресов" }, CALLER)).isError, true);
});

test("a duplicate written by a person gives its id only when the agent can read it", async () => {
  const verified = agentNote(3, { title: GOOD.title, agent: undefined, approved: true });
  const visible = await make({ notes: [verified] }).tools.create(GOOD, CALLER);
  assert.match(textOf(visible), new RegExp(String(verified._id)));
  assert.match(textOf(visible), /written by a person/);

  const hidden = agentNote(4, { title: GOOD.title, agent: undefined, approved: false });
  const answer = textOf(await make({ notes: [hidden] }).tools.create(GOOD, CALLER));
  assert.match(answer, /a note with this title already exists/);
  assert.equal(answer.includes(String(hidden._id)), false);
});

test("two creates with one title at once leave one note", async () => {
  const { source, tools } = make();
  const [first, second] = await Promise.all([tools.create(GOOD, CALLER), tools.create(GOOD, CALLER)]);
  assert.equal(source.created.length, 1);
  assert.equal([first, second].filter((result) => result.isError).length, 1);
});

test("embedded images and base64 are refused", async () => {
  const { tools } = make();
  const image = await tools.create({ ...GOOD, content: "Схема: ![x](data:image/png;base64,AAAA)" }, CALLER);
  assert.match(textOf(image), /embedded images and data: URIs/);
});

test("a secret refuses the write whatever the scanning preference is", async () => {
  const { source, tools } = make();
  const result = await tools.create({ ...GOOD, content: "Вход: password = R00tP@ss123" }, CALLER);
  assert.equal(result.isError, true);
  assert.match(textOf(result), /looks like a credential/);
  assert.equal(textOf(result).includes("R00tP@ss123"), false); // значение в ответ не возвращается
  assert.equal(source.created.length, 0);
});

test("the daily limit refuses the next note", async () => {
  let asked;
  const { source, tools } = make({ countCreatedSince: async (keyId, since) => ((asked = { keyId, since }), DAILY_LIMIT) });
  const result = await tools.create(GOOD, CALLER);
  assert.match(textOf(result), /30 notes in the last 24 hours/);
  assert.equal(asked.keyId, CALLER.keyId);
  assert.equal(asked.since.toISOString(), "2026-10-10T10:00:00.000Z");
  assert.equal(source.created.length, 0);
});

test("update changes only what was passed and resets nothing by itself", async () => {
  const mine = agentNote(10);
  const { source, tools } = make({ notes: [mine] });
  const result = await tools.update({ requester: 1001, id: String(mine._id), content: "Новый текст" }, CALLER);

  assert.equal(result.isError, undefined);
  const { patch } = source.updated[0];
  assert.deepEqual(Object.keys(patch).sort(), ["content", "plainText", "requesterId"]);
  assert.equal(patch.requesterId, "u1");
  assert.match(textOf(result), /unverified draft/);
});

test("an empty list clears bindings, an omitted one keeps them", async () => {
  const mine = agentNote(11);
  const cleared = make({ notes: [mine] });
  await cleared.tools.update({ requester: 1001, id: String(mine._id), companies: [] }, CALLER);
  assert.deepEqual(cleared.source.updated[0].patch.companyIds, []);

  const kept = make({ notes: [mine] });
  await kept.tools.update({ requester: 1001, id: String(mine._id), title: "Новое имя" }, CALLER);
  assert.equal("companyIds" in kept.source.updated[0].patch, false);
  assert.equal("userIds" in kept.source.updated[0].patch, false); // людей агент не трогает никогда
});

test("update needs something to change", async () => {
  const mine = agentNote(12);
  const { tools } = make({ notes: [mine] });
  assert.match(textOf(await tools.update({ requester: 1001, id: String(mine._id) }, CALLER)), /nothing to change/);
});

test("a note written by a person cannot be updated", async () => {
  const human = agentNote(13, { agent: undefined });
  const { source, tools } = make({ notes: [human] });
  const result = await tools.update({ requester: 1001, id: String(human._id), content: "x" }, CALLER);
  assert.match(textOf(result), /written by a person/);
  assert.equal(source.updated.length, 0);
});

test("a missing, hidden or malformed id gets one and the same answer", async () => {
  const hiddenHuman = agentNote(14, { agent: undefined, approved: false });
  const archived = agentNote(15, { archivedAt: new Date() });
  const { tools } = make({ notes: [hiddenHuman, archived] });
  const answers = await Promise.all(
    [String(hiddenHuman._id), String(archived._id), id(999), "not-an-id"].map(async (noteId) =>
      textOf(await tools.update({ requester: 1001, id: noteId, content: "x" }, CALLER)),
    ),
  );
  assert.equal(new Set(answers).size, 1);
  assert.match(answers[0], /Note not available/);
});

test("renaming a note into another note's title is a duplicate, keeping its own is not", async () => {
  const mine = agentNote(16, { title: "Первая" });
  const other = agentNote(17, { title: "Вторая" });
  const { source, tools } = make({ notes: [mine, other] });
  assert.equal((await tools.update({ requester: 1001, id: String(mine._id), title: "вторая" }, CALLER)).isError, true);
  assert.equal((await tools.update({ requester: 1001, id: String(mine._id), title: "Первая", content: "x" }, CALLER)).isError, undefined);
  assert.equal(source.updated.length, 1);
});

test("a value a moderator marked as not a secret does not block an update", async () => {
  const { hashValue } = require("@/services/secretsScanner");
  const mine = agentNote(18, { secretsScan: { flagged: false, ignoredHashes: [hashValue("R00tP@ss123")] } });
  const { source, tools } = make({ notes: [mine] });
  const content = "Учётка на стенде: admin / R00tP@ss123 (тестовая)";
  assert.equal((await make({ notes: [agentNote(18)] }).tools.update({ requester: 1001, id: String(mine._id), content }, CALLER)).isError, true);
  const result = await tools.update({ requester: 1001, id: String(mine._id), content }, CALLER);
  assert.equal(result.isError, undefined, textOf(result));
  assert.equal(source.updated.length, 1);
});

// Пометка «не секрет» снимает находку сканера (у неё есть хэш значения). Правило
// полей хэшей не знает: «password = …» остаётся отказом и с пометкой модератора.
test("a moderator's mark does not lift the field rule", async () => {
  const { hashValue } = require("@/services/secretsScanner");
  const mine = agentNote(19, { secretsScan: { flagged: false, ignoredHashes: [hashValue("R00tP@ss123")] } });
  const { source, tools } = make({ notes: [mine] });
  const result = await tools.update({ requester: 1001, id: String(mine._id), content: "Вход: password = R00tP@ss123" }, CALLER);
  assert.equal(result.isError, true);
  assert.deepEqual(fieldLines(result), [1]);
  assert.doesNotMatch(textOf(result), /looks like a credential/); // находка сканера снята пометкой
  assert.equal(textOf(result).includes("R00tP@ss123"), false);
  assert.equal(source.updated.length, 0);
});

// Сохраняется сырой Markdown, поэтому секрет ищем и в нём: проекция в простой текст
// теряет блоки кода, адреса ссылок и подчёркивания.
test("a credential hidden from the plain-text projection still refuses the write", async () => {
  const samples = [
    "Роутер:\n```\npassword = R00tP@ss123\n```",
    "Ключ:\n~~~\nAKIAABCDEFGHIJKLMNOP\n~~~",
    "[тут](https://admin:R00tP@ss123@10.0.0.1/)",
    "Токен ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ лежит в заметке",
    "Текст <!-- password = R00tP@ss123 --> дальше",
  ];
  for (const content of samples) {
    const { source, tools } = make();
    const result = await tools.create({ ...GOOD, content }, CALLER);
    assert.equal(result.isError, true, content);
    assert.match(textOf(result), /looks like a credential|URL with a password/, content);
    assert.equal(textOf(result).includes("R00tP@ss123"), false, content);
    assert.equal(source.created.length, 0, content);
  }
});

// Сырой Markdown проверяем только правилами известных форматов; эвристики сканера
// остаются за простым текстом, где обычная конфигурация в блоках кода не видна.
const CONFIG_LINES = [
  "/ip address add address=10.0.5.1/24 interface=ether1-WAN",
  "/ip dhcp-server add name=dhcp1 interface=bridge1",
  "/system identity set name=RT-OFFICE-01",
  "/ip route add gateway=192.168.1.1",
  '/interface wireguard peers add allowed-address=10.8.0.2/32 public-key="hB3xQ9Zk2LmN7pR4sT6vW8yA1cE3gI5jK7mO9qS1uW0="',
];

test("ordinary router configuration inside a code block is accepted", async () => {
  const content = [
    "# Роутер офиса",
    "Стоит в серверной на втором этаже, питание через ИБП.",
    "| Порт | Назначение |\n|---|---|\n| ether1-WAN | Провайдер |\n| ether2 | Офис |",
    "Документация: [Firewall](https://help.mikrotik.com/docs/display/ROS/Firewall)",
    `\`\`\`\n${CONFIG_LINES.join("\n")}\n/ip service set telnet disabled=yes\n\`\`\``,
    "MAC: AA:BB:CC:11:22:33; хост srv-dc01.romashka.local; серийный номер HEX0A1B2C3D; прошивка 7.15.3.",
  ].join("\n\n");
  const { source, tools } = make();
  const result = await tools.create({ ...GOOD, content }, CALLER);
  assert.equal(result.isError, undefined, textOf(result));
  assert.equal(source.created.length, 1);
});

test("the same configuration written as prose outside a code block is still refused", async () => {
  for (const line of CONFIG_LINES) {
    const { source, tools } = make();
    const result = await tools.create({ ...GOOD, content: `Настройка: ${line}` }, CALLER);
    assert.equal(result.isError, true, line);
    assert.equal(source.created.length, 0, line);
  }
});

test("a real secret next to ordinary configuration in a code block is refused", async () => {
  const { source, tools } = make();
  const content = `\`\`\`\n${CONFIG_LINES[0]}\n/ppp secret add name=user1 password=R00tP@ss123\n\`\`\``;
  const result = await tools.create({ ...GOOD, content }, CALLER);
  assert.equal(result.isError, true);
  assert.equal(textOf(result).includes("R00tP@ss123"), false);
  assert.equal(source.created.length, 0);
});

test("update refuses a credential inside a fenced block",async () => {
  const mine = agentNote(20);
  const { source, tools } = make({ notes: [mine] });
  const result = await tools.update({ requester: 1001, id: String(mine._id), content: "```\npassword = R00tP@ss123\n```" }, CALLER);
  assert.equal(result.isError, true);
  assert.match(textOf(result), /looks like a credential/);
  assert.equal(source.updated.length, 0);
});

// ── Линейное время на тексте агента ─────────────────────────────────────────
// MCP живёт в одном цикле событий с веб-приложением: 40 000 знаков, на которых
// проверка секретов думает секунду, останавливают всех. Время — процессорное
// (как в knowledgeTools.test.js): стенные часы под нагрузкой дают ложные падения.
const FILL = 40_000;
const fill = (unit, head = "") => (head + unit.repeat(Math.ceil(FILL / unit.length))).slice(0, FILL);
const ADVERSARIAL = {
  letters: fill("a"),
  "«a-» ×N": fill("a-"),
  "«-eyJ» ×N": fill("-eyJ"),
  "«a://» + letters": fill("a", "a://"),
  "«a://u:» + letters": fill("a", "a://u:"),
  "«a=» ×N": fill("a="),
  "«password=» ×N": fill("password="),
  '«key="» ×N': fill('key="'),
  "«://a:» ×N": fill("://a:"),
  "«[скрыто]» ×N": fill("[скрыто]"),
  "«[скрипт скрыт: 1» ×N": fill("[скрипт скрыт: 1"),
  "«Key = » ×N": fill("Key = "),
  "«key» + spaces + «=» ×N": fill(`key${" ".repeat(40)}=`),
  '«"[скрыто]"» ×N': fill('"[скрыто]"'),
  "«password=[скрыто]⏎» ×N": fill("password=[скрыто]\n"),
  "«[скрыто] » ×N": fill("[скрыто] "),
  '«="» ×N': fill('="'),
};

test("create: 40 000 знаков любой формы проверяются за линейное время", { timeout: 30_000 }, async () => {
  for (const [label, content] of Object.entries(ADVERSARIAL)) {
    const { tools } = make();
    const cpuBefore = process.cpuUsage();
    await tools.create({ ...GOOD, content }, CALLER);
    const cpu = process.cpuUsage(cpuBefore);
    const ms = (cpu.user + cpu.system) / 1000;
    assert.ok(ms < 250, `${label}: ${ms.toFixed(1)} мс`);
  }
});

test("a URL with a password is refused, ordinary addresses and paths are not", async () => {
  for (const content of ["Архив: ftp://backup:Zx9qLm@10.0.0.7/dumps", "Вход https://admin:R00tP@ss123@10.0.0.1/ для админа"]) {
    const { source, tools } = make();
    const result = await tools.create({ ...GOOD, content }, CALLER);
    assert.equal(result.isError, true, content);
    assert.match(textOf(result), /URL with a password/, content);
    assert.equal(/Zx9qLm|R00tP@ss123/.test(textOf(result)), false, content);
    assert.equal(source.created.length, 0, content);
  }
  for (const content of [
    "Панель: http://host:8080/path",
    "Вход по ssh://user@host",
    "Писать на admin@romashka.example",
    "Файл лежит в C:\\Users\\bob\\file.txt",
  ]) {
    const { source, tools } = make();
    const result = await tools.create({ ...GOOD, content }, CALLER);
    assert.equal(result.isError, undefined, `${content}: ${textOf(result)}`);
    assert.equal(source.created.length, 1, content);
  }
});

// ── Поле с секретным именем в блоке кода ───────────────────────────────────
// Правила известных форматов не знают RouterOS: private-key="…" в блоке кода
// проходил и сырой проход, и простой текст (блоки кода в него не попадают).
const fenced = (...lines) => `Настройка:\n\`\`\`\n${lines.join("\n")}\n\`\`\``;

test("a secret-named field with a value inside a code block is refused", async () => {
  const samples = {
    "private-key": fenced('/interface wireguard add name=wg1 private-key="kD5vT1pZ8wQ3rY6uI9oP2aS4dF7gH0jK2lZ4xC6vB8n="'),
    "wpa2-pre-shared-key": fenced("/interface wireless security-profiles add name=office wpa2-pre-shared-key=Qw3rtyUi0p"),
    password: fenced("/ppp secret add name=u1 password=qwe123"),
    "preshared-key": fenced('/interface wireguard peers add preshared-key="mN3bV5cX7zL9kJ1hG3fD5sA7pO9iU1yT3rE5wQ7uI9o="'),
  };
  const values = /kD5vT1pZ|Qw3rtyUi0p|qwe123|mN3bV5cX/;
  for (const [field, content] of Object.entries(samples)) {
    const { source, tools } = make();
    const result = await tools.create({ ...GOOD, content }, CALLER);
    assert.equal(result.isError, true, field);
    assert.deepEqual(fieldLines(result), [3], `${field}: ${textOf(result)}`);
    assert.equal(textOf(result).includes(field), false, field); // имени поля в ответе нет
    assert.equal(values.test(textOf(result)), false, field);
    assert.equal(source.created.length, 0, field);
  }
});

test("an empty value, a placeholder and public fields are not secrets", async () => {
  const content = fenced(
    '/ppp secret add name=u1 password=""',
    "/ppp secret add name=u2 password=[...]",
    "/ppp secret add name=u3 password=<спросить у администратора>",
    "/ppp secret add name=u4 password=",
    ...CONFIG_LINES,
  );
  const { source, tools } = make();
  const result = await tools.create({ ...GOOD, content }, CALLER);
  assert.equal(result.isError, undefined, textOf(result));
  assert.equal(source.created.length, 1);
});

// Само правило полей, без сканера: «password=[скрыто]» через create не проверить —
// правило сканера generic-api-key принимает восемь знаков заглушки за значение.
test("secretFields: which name=value pairs count", () => {
  const none = [
    "password=[скрыто]",
    'password="[секрет скрыт]"',
    "private-key={{wireguard.private-key}}",
    "password=***",
    "`password=`",
    'password="" comment=x',
    // Пробел только после «=» — значение пустое (так кончается и хвост base64: «…Q= user@host»)
    "password= потом пробел",
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKeyPsk= user@host",
    "password=yes PASSWORD=No private-key=\"none\" ApiKey = Disabled token=`auto`",
    "PublicKey = hB3xQ9Zk2LmN7pR4sT6vW8yA1cE3gI5jK7mO9qS1uW0=",
    "Заголовок\n=====\nPassword\n===\nтекст",
    'public-key="hB3xQ9Zk2LmN7pR4sT6vW8yA1cE3gI5jK7mO9qS1uW0="',
    "key-size=2048 passthrough=yes interface=ether1-WAN allowed-address=10.8.0.2/32",
    "a == b, x=1, =пусто",
    // Хвост base64 — не имя поля, даже если в нём случайно сложилось «key» или «psk»
    "AAAAC3NzaC1lZDI1NTE5AAAAIKeyPSKtokenAAAA== user@host",
    `${"KeyPsk0".repeat(12)}=значение`,
  ];
  for (const text of none) assert.deepEqual(secretFields(text), [], text);

  assert.deepEqual(secretFields("add name=u1 password=qwe123 PASSWORD=другой"), ["password"]);
  assert.deepEqual(secretFields('private-key="aaa bbb"'), ["private-key"]);
  assert.deepEqual(secretFields("`secret=abc`, а ещё --api_key=xyz и ?token=1"), ["secret", "api_key", "token"]);
  assert.deepEqual(secretFields("password=[не закрыто"), ["password"]);
  // Заглушка — только всё значение целиком, а не начало настоящего
  assert.deepEqual(secretFields("private-key=[x]kD5vT1pZ8wQ3 password=<y>qwe123"), ["private-key", "password"]);
  assert.deepEqual(secretFields('private-key="[x]", password=<y>.'), []);
  // «Имя = значение» с пробелами и табуляцией; CamelCase приводится к виду RouterOS
  assert.deepEqual(secretFields("PrivateKey = abc\nPresharedKey\t=\tdef\napiKey =ghi\nprivate-key = jkl"), ["private-key", "preshared-key", "api-key"]);
  assert.deepEqual(secretFields("password = yes123, token = truely"), ["password", "token"]);
  // В ответе не больше пяти имён, сколько бы их ни было в тексте
  assert.equal(secretFields(Array.from({ length: 40 }, (unused, n) => `key${n}=v`).join(" ")).length, 5);
});

// ── Пометки самого портала — не секреты ────────────────────────────────────
// Обычный источник заметки — конфигурация, прочитанная через MCP портала: секреты
// в ней уже заменены пометками. Такой фрагмент должен сохраняться как есть.
test("the helpdesk's own redaction markers are not secrets", async () => {
  const content = fenced(
    "/ppp secret add name=u1 password=[скрыто]",
    '/interface wireguard add name=wg1 private-key="[секрет скрыт]"',
    '/system script add name=x source="[скрипт скрыт: 12 строк]"',
    "/snmp community set name=[скрыто] comment=[секрет скрыт]",
    "on-event=[скрипт скрыт] token=[секрет скрыт]",
    ...CONFIG_LINES,
  );
  const { source, tools } = make();
  const result = await tools.create({ ...GOOD, title: "Роутер: пароль [секрет скрыт]", content: `Звонить [телефон], писать [e-mail].\n\n${content}` }, CALLER);
  assert.equal(result.isError, undefined, textOf(result));
  // Пометки убираются только из проверяемой копии: сохраняется текст как прислан
  assert.equal(source.created[0].content.includes("password=[скрыто]"), true);
  assert.equal(source.created[0].title, "Роутер: пароль [секрет скрыт]");

  const mine = agentNote(28);
  const updated = make({ notes: [mine] });
  assert.equal((await updated.tools.update({ requester: 1001, id: String(mine._id), content }, CALLER)).isError, undefined);
});

test("a real value glued to a marker is still refused", async () => {
  for (const line of ["/ppp secret add name=u1 password=[скрыто]R00tP@ss123", '/ppp secret add name=u1 password="qwe[секрет скрыт]123"', "password=[скры[скрыто]то]qwe123"]) {
    const { source, tools } = make();
    const result = await tools.create({ ...GOOD, content: fenced(line) }, CALLER);
    assert.equal(result.isError, true, line);
    assert.equal(/R00tP@ss123|qwe123/.test(textOf(result)), false, line);
    assert.equal(source.created.length, 0, line);
  }
});

// ── Слова-переключатели RouterOS — не значение секрета ─────────────────────
test("a secret-named field set to a switch word is accepted, anything else is not", async () => {
  const content = fenced(
    "/ip ssh set always-allow-password-login=yes strong-crypto=yes",
    "/ip dhcp-client add interface=ether1 use-peer-dns=yes add-default-route=no",
    '/interface wireless security-profiles set default group-key-update=5m static-key-0="" management-protection-key=none',
    "/user settings set minimum-password-length=default password-expiry=DISABLED",
    '/tool e-mail set tls=yes password-auth="Auto"',
    ...CONFIG_LINES,
  );
  const { source, tools } = make();
  const result = await tools.create({ ...GOOD, content }, CALLER);
  assert.equal(result.isError, undefined, textOf(result));
  assert.equal(source.created.length, 1);

  for (const [line, field] of [["/ppp secret add name=u1 password=yes123", "password"], ["/snmp set trap-community=public", "trap-community"], ["key=value", "key"], ["password=no-way", "password"]]) {
    const refused = make();
    const answer = await refused.tools.create({ ...GOOD, content: fenced(line) }, CALLER);
    assert.equal(answer.isError, true, line);
    assert.deepEqual(fieldLines(answer), [3], `${line}: ${textOf(answer)}`);
    assert.equal(textOf(answer).split("\n").length, 2, `${field}: ${textOf(answer)}`); // других причин нет
    assert.equal(/yes123|public|no-way|trap-community/.test(textOf(answer)), false, line);
  }
});

// ── wg-quick / INI: «Имя = значение» ───────────────────────────────────────
const WG_PUBLIC = ["PublicKey = hB3xQ9Zk2LmN7pR4sT6vW8yA1cE3gI5jK7mO9qS1uW0=", "Endpoint = 1.2.3.4:51820", "AllowedIPs = 10.8.0.0/24", "PersistentKeepalive = 25"];

test("a WireGuard client config with a private key is refused, with public fields only it is accepted", async () => {
  const secret = fenced("[Interface]", "PrivateKey = kD5vT1pZ8wQ3rY6uI9oP2aS4dF7gH0jK2lZ4xC6vB8n=", "Address = 10.8.0.2/32", "", "[Peer]", ...WG_PUBLIC);
  const refused = make();
  const result = await refused.tools.create({ ...GOOD, content: secret }, CALLER);
  assert.equal(result.isError, true);
  assert.deepEqual(fieldLines(result), [4], textOf(result));
  assert.equal(textOf(result).includes("kD5vT1pZ"), false);
  assert.equal(refused.source.created.length, 0);

  const preshared = await make().tools.create({ ...GOOD, content: fenced("[Peer]", "PresharedKey\t=\tmN3bV5cX7zL9kJ1hG3fD5sA7pO9iU1yT3rE5wQ7uI9o=") }, CALLER);
  assert.deepEqual(fieldLines(preshared), [4], textOf(preshared));
  assert.equal(textOf(preshared).includes("mN3bV5cX"), false);

  const accepted = make();
  const ok = await accepted.tools.create({ ...GOOD, content: fenced("[Interface]", "Address = 10.8.0.2/32", "ListenPort = 51820", "", "[Peer]", ...WG_PUBLIC) }, CALLER);
  assert.equal(ok.isError, undefined, textOf(ok));
  assert.equal(accepted.source.created.length, 1);
});

test("update refuses a secret-named field in new content", async () => {
  const mine = agentNote(21);
  const { source, tools } = make({ notes: [mine] });
  const result = await tools.update({ requester: 1001, id: String(mine._id), content: fenced("/ppp secret add name=u1 password=qwe123") }, CALLER);
  assert.equal(result.isError, true);
  assert.deepEqual(fieldLines(result), [3]);
  assert.equal(textOf(result).includes("qwe123"), false);
  assert.equal(source.updated.length, 0);
});

// ── Правка без content проверяет только то, что меняется ───────────────────
// Сохранённый текст мог править человек (и оставить в нём то, что агенту в новом
// тексте не разрешили бы): переименование и смена привязок из-за него не падают.
const STORED_WITH_SECRETS = ["Архив: ftp://backup:Zx9qLm@10.0.0.7/dumps", "```\npassword = R00tP@ss123\n```", "Вход: password = R00tP@ss123"];

test("a title-only update does not rescan the stored content", async () => {
  for (const content of STORED_WITH_SECRETS) {
    const mine = agentNote(22, { content });
    const renamed = make({ notes: [mine] });
    const result = await renamed.tools.update({ requester: 1001, id: String(mine._id), title: "Новое имя" }, CALLER);
    assert.equal(result.isError, undefined, `${content}: ${textOf(result)}`);
    assert.deepEqual(Object.keys(renamed.source.updated[0].patch).sort(), ["requesterId", "title"]);

    const retyped = make({ notes: [mine] });
    assert.equal((await retyped.tools.update({ requester: 1001, id: String(mine._id), type: "backlog", companies: [] }, CALLER)).isError, undefined, content);
    assert.equal(retyped.source.updated.length, 1);
  }
});

test("a title-only update with a credential in the new title is refused", async () => {
  const mine = agentNote(23);
  const { source, tools } = make({ notes: [mine] });
  const result = await tools.update({ requester: 1001, id: String(mine._id), title: "Роутер: password = R00tP@ss123" }, CALLER);
  assert.equal(result.isError, true);
  assert.match(textOf(result), /the title has a value that looks like a credential/);
  assert.equal(textOf(result).includes("R00tP@ss123"), false);
  assert.equal(source.updated.length, 0);
});

test("update with content checks the new content and the current title", async () => {
  const mine = agentNote(24);
  const { source, tools } = make({ notes: [mine] });
  const result = await tools.update({ requester: 1001, id: String(mine._id), content: "Вход: password = R00tP@ss123" }, CALLER);
  assert.equal(result.isError, true);
  assert.match(textOf(result), /the content has a value that looks like a credential/);
  assert.equal(textOf(result).includes("R00tP@ss123"), false);
  assert.equal(source.updated.length, 0);
});

// ── Заголовок: одна строка обычных знаков ──────────────────────────────────
test("a title with control or invisible characters is refused", async () => {
  const bad = { tab: "Роутер\tофиса", "zero-width space": "Роутер\u200bофиса", "U+2028": "Роутер\u2028офиса", CR: "Роутер\rофиса", DEL: "Роутер\u007fофиса", BOM: "Роутер\ufeffофиса" };
  for (const [label, title] of Object.entries(bad)) {
    const { source, tools } = make();
    const result = await tools.create({ ...GOOD, title }, CALLER);
    assert.equal(result.isError, true, label);
    assert.match(textOf(result), /title must be one line of ordinary characters/, label);
    assert.equal(source.created.length, 0, label);
  }
  const { source, tools } = make();
  const ok = await tools.create({ ...GOOD, title: "Ромашка: «ещё один» маршрутизатор — офис №2 (\"старый\" корпус)" }, CALLER);
  assert.equal(ok.isError, undefined, textOf(ok));
  assert.equal(source.created.length, 1);
});

// ── Сначала человек, потом всё остальное ───────────────────────────────────
// Пока неизвестно, кто просит, агенту не отвечают ни про заметку (есть ли она,
// чья), ни именами из справочника.
test("update answers with the requester reason before it looks at the note", async () => {
  const mine = agentNote(25);
  const human = agentNote(26, { agent: undefined });
  const cases = {
    unknown: [{}, { requester: 7 }, /no employee with this Telegram id/],
    "no right": [{ findRequester: async () => ({ _id: "u2", canManage: false }) }, { requester: 1001 }, /not allowed to manage the knowledge base/],
  };
  for (const [label, [overrides, who, reason]] of Object.entries(cases)) {
    for (const noteId of [String(mine._id), String(human._id), id(999), "not-an-id"]) {
      const asked = [];
      const { source, tools, logs } = make({
        notes: [mine, human],
        ...overrides,
        findForWrite: async () => (asked.push("note"), null),
        loadDirectory: async () => (asked.push("directory"), { companies: [], categories: [] }),
      });
      const result = await tools.update({ ...who, id: noteId, content: "x", companies: ["Ромаш"] }, CALLER);
      assert.equal(result.isError, true, label);
      assert.match(textOf(result), reason, label);
      assert.doesNotMatch(textOf(result), /Note not available|written by a person/, label);
      assert.deepEqual(asked, [], label);
      assert.equal(source.updated.length, 0, label);
      assert.equal(logs.at(-1).outcome, "refused: requester", label);
    }
  }
});

test("create with a bad requester gives no names from the directory", async () => {
  let asked = 0;
  const { source, tools } = make({
    loadDirectory: async () => ((asked += 1), { companies: [{ _id: "c1", alias: "Ромашка" }, { _id: "c2", alias: "Ромашка-Строй" }], categories: [{ _id: "k1", title: "Сеть" }, { _id: "k2", title: "Сетевые принтеры" }] }),
  });
  const result = await tools.create({ ...GOOD, requester: 7, title: " ", companies: ["Ромаш"], categories: ["Сет"] }, CALLER);
  assert.equal(result.isError, true);
  assert.match(textOf(result), /no employee with this Telegram id/);
  assert.match(textOf(result), /title is empty/); // остальные причины по-прежнему собираются
  assert.doesNotMatch(textOf(result), /Ромашка|Several|Сеть/);
  assert.equal(asked, 0);
  assert.equal(source.created.length, 0);
});

test("a blank name in a list is a reason, not a silent skip", async () => {
  const mine = agentNote(27);
  const { source, tools } = make({ notes: [mine] });
  const result = await tools.update({ requester: 1001, id: String(mine._id), companies: [" "] }, CALLER);
  assert.equal(result.isError, true);
  assert.match(textOf(result), /companies: a name is empty/);
  assert.equal(source.updated.length, 0);

  const created = make();
  assert.match(textOf(await created.tools.create({ ...GOOD, categories: ["Сеть", ""] }, CALLER)), /categories: a name is empty/);
  assert.equal(created.source.created.length, 0);
});

// ── Раунд 2: пометка и то, что к ней приклеено ─────────────────────────────
// Копия без пометок должна одновременно: не принять настоящее значение,
// приклеенное к пометке (и через «:», и через «=», и в кавычках), и не принять за
// значение начало следующей строки, когда пометка стоит в конце своей.
const prose = (line) => `Доступ: ${line}`;
const GLUED = /R00tP@ss/;

const GLUED_REFUSED = [
  "password: [скрыто]R00tP@ss123",
  "password=[скрыто]R00tP@ss123",
  'password="[скрыто]R00tP@ss123"',
  "password: [секрет скрыт]R00tP@ss123",
  "ftp://user:[скрыто]R00tP@ss@host/path",
  "ftp://user:R00tP@ss123@host",
  // Пометка на месте логина исчезает из копии: пароль после «:» остаётся паролем
  "ftp://[e-mail]:Zx9qLm@10.0.0.7/dumps",
  "ftp://[скрыто]:R00tP@ss123@host/path",
];

test("a real value glued to a marker is refused in a fence and in prose alike", async () => {
  for (const line of GLUED_REFUSED) {
    for (const [where, content] of [["fence", fenced(line)], ["prose", prose(line)]]) {
      const { source, tools } = make();
      const result = await tools.create({ ...GOOD, content }, CALLER);
      assert.equal(result.isError, true, `${where}: ${line}`);
      assert.equal(GLUED.test(textOf(result)), false, `${where}: ${line}: ${textOf(result)}`);
      assert.equal(source.created.length, 0, `${where}: ${line}`);
    }
  }
});

// Принимается и в блоке кода, и прозой
const MARKER_ACCEPTED = [
  "password: [скрыто]",
  "логин: [e-mail], телефон: [телефон]",
  "ftp://user:[скрыто]@host/path",
  "[скрипт скрыт: 12 строк]",
];
// Только в блоке кода. Прозой «password=» — отказ эвристики сканера и без всякой
// пометки (слово-ключ со знаком «=» само похоже на пароль), как и строка
// конфигурации «name=wg1» (см. тест ниже)
const MARKER_ACCEPTED_FENCED = [
  "password=[скрыто]\n/interface wireguard add name=wg1",
  "password=[скрыто]",
  'password="[скрыто]"',
  'password=[скрыто] comment="x"',
  "password: [скрыто]\n/interface wireguard add name=wg1",
  "PrivateKey = [скрыто]\nAddress = 10.8.0.2/32",
];

test("«password=» in prose is refused with a marker exactly as without one", async () => {
  for (const line of ["password=", 'password=""', 'password="[скрыто]"', "password=[скрыто]", 'password=[скрыто] comment="x"']) {
    const result = await make().tools.create({ ...GOOD, content: prose(line) }, CALLER);
    assert.equal(result.isError, true, line);
    assert.match(textOf(result), /password-near-keyword: pass•ord=/, line);
  }
});

test("a marker alone is accepted: at a line end, quoted, before another field, in a URL", async () => {
  const cases = [
    ...MARKER_ACCEPTED.flatMap((line) => [["fence", line, fenced(line)], ["prose", line, prose(line)], ["bare", line, line]]),
    ...MARKER_ACCEPTED_FENCED.map((line) => ["fence", line, fenced(line)]),
  ];
  for (const [where, line, content] of cases) {
    const { source, tools } = make();
    const result = await tools.create({ ...GOOD, content }, CALLER);
    assert.equal(result.isError, undefined, `${where}: ${line}: ${textOf(result)}`);
    assert.equal(source.created[0].content, content, `${where}: ${line}`); // сохраняется как прислано
  }
});

// ── Раунд 2: инструмент и скан сохранённой заметки смотрят одну копию ──────
// Принятое инструментом не должно быть помечено пересчётом перед сохранением:
// иначе агенту отвечают «сохранено», а заметка скрыта от него же.
test("what the tool accepts, the on-save rescan does not flag", async () => {
  const { markdownToPlainText } = require("@/helpers/markdownToPlainText");
  const { rescanNoteDerived } = require("@/helpers/knowledgeNoteDerived");
  const off = { loadKbConfig: async () => ({ scanForSecrets: false }) };
  const contents = [
    "Доступ: password: [скрыто], логин: [e-mail]",
    "Вход: логин: [e-mail]\n\nпароль: [секрет скрыт]",
    fenced("password=[скрыто]"),
    "ftp://user:[скрыто]@host/path",
    ...MARKER_ACCEPTED.flatMap((line) => [fenced(line), prose(line), line]),
    ...MARKER_ACCEPTED_FENCED.map((line) => fenced(line)),
  ];
  for (const content of contents) {
    const { source, tools } = make();
    const result = await tools.create({ ...GOOD, title: "Роутер: пароль [секрет скрыт]", content }, CALLER);
    assert.equal(result.isError, undefined, `${content}: ${textOf(result)}`);
    const doc = source.created[0];
    assert.equal(doc.plainText, markdownToPlainText(content), content);
    const note = { title: doc.title, plainText: doc.plainText, content: doc.content, agent: { keyId: CALLER.keyId } };
    await rescanNoteDerived(note, off);
    assert.equal(note.secretsScan.flagged, false, `${content}: ${JSON.stringify(note.secretsScan.findings)}`);
  }
});

// Настоящий вывод портала — вычищенный экспорт RouterOS (mikrotik/configRedact.js)
// в блоке кода: принимается, и пересчёт перед сохранением его не помечает
test("a redacted RouterOS export pasted into a code block is accepted and not flagged", async () => {
  const { redactConfig } = require("@/services/mikrotik/configRedact");
  const { rescanNoteDerived } = require("@/helpers/knowledgeNoteDerived");
  const exported = [
    "/ppp secret",
    "add name=u1 password=R00tP@ss123 service=l2tp",
    "add name=u2 password=An0ther!Pass",
    "/interface wireguard",
    'add name=wg1 private-key="kD5vT1pZ8wQ3rY6uI9oP2aS4dF7gH0jK2lZ4xC6vB8n="',
    "/system script",
    'add name=backup source=":log info a\\n:log info b"',
    "/tool fetch",
    "add url=ftp://backup:Zx9qLm@10.0.0.7/dumps",
    "/ip address",
    "add address=10.0.5.1/24 interface=ether1-WAN",
  ].join("\n");
  const redacted = redactConfig(exported)
    .sections.flatMap((section) => [section.path, ...section.lines])
    .join("\n");
  assert.equal(/R00tP@ss123|An0ther|kD5vT1pZ|Zx9qLm/.test(redacted), false, redacted);
  assert.match(redacted, /password=\[скрыто\]\n/); // пометка в конце строки

  const { source, tools } = make();
  const result = await tools.create({ ...GOOD, content: `Экспорт:\n\`\`\`\n${redacted}\n\`\`\`` }, CALLER);
  assert.equal(result.isError, undefined, `${textOf(result)}\n${redacted}`);
  const doc = source.created[0];
  const note = { title: doc.title, plainText: doc.plainText, content: doc.content, agent: { keyId: CALLER.keyId } };
  await rescanNoteDerived(note, { loadKbConfig: async () => ({ scanForSecrets: false }) });
  assert.equal(note.secretsScan.flagged, false);
});

// ── Раунд 2: имя поля — только от границы ──────────────────────────────────
// «p=MyS3cretPass=2»: серия знаков перед вторым «=» — значение первого поля, а не
// имя; в отказе её показывать нельзя.
test("a name run that follows «=» is a value: neither refused nor named", async () => {
  const { tools } = make();
  const result = await tools.create({ ...GOOD, content: fenced("p=MyS3cretPass=2") }, CALLER);
  assert.doesNotMatch(textOf(result), /s3cret/i);

  assert.deepEqual(secretFields("p=MyS3cretPass=2"), []);
  assert.deepEqual(secretFields('p="MyS3cretPass=2"'), []);
  assert.deepEqual(secretFields("p='`MyS3cretPass=2"), []);
  // …и через открывающие скобки: в RouterOS «p=(…)» и «p=[…]» — тоже значение
  assert.deepEqual(secretFields('p=(MyS3cretPass=2) q=["MyS3cretPass=2"] r={MyS3cretPass=2}'), []);
  assert.deepEqual(secretFields('connect(password=abc) x["token=1"]'), ["password", "token"]);
  assert.deepEqual(secretFields('x"password=abc'), []);
  assert.deepEqual(secretFields("password=abc=2"), ["password"]);
  assert.deepEqual(secretFields('comment="password=abc"'), []);
  // Граница: начало, перевод строки, пробел, открывающий знак
  assert.deepEqual(secretFields('comment="" password=abc'), ["password"]);
  assert.deepEqual(secretFields("x\npassword=abc"), ["password"]);
  assert.deepEqual(secretFields("x\r\n\ttoken=abc"), ["token"]);
  assert.deepEqual(secretFields('("password=abc") [token=x] {secret=y} :local a;passphrase=z'), ["password", "token", "secret", "passphrase"]);
  // Не граница: знак, который бывает внутри значения
  assert.deepEqual(secretFields("p=abc,MyS3cretPass=2 a/token=1 b:secret=2 c|password=3"), []);

  const named = await make().tools.create({ ...GOOD, content: fenced("password=abc=2") }, CALLER);
  assert.equal(named.isError, true);
  assert.deepEqual(fieldLines(named), [3]);
  assert.doesNotMatch(textOf(named), /abc|password/);

  const comment = await make().tools.create({ ...GOOD, content: fenced('/ip pool add comment="password=abc"') }, CALLER);
  assert.equal(comment.isError, undefined, textOf(comment));
  const longer = await make().tools.create({ ...GOOD, content: fenced('/ip pool add comment="password=abcdefgh1"') }, CALLER);
  assert.equal(longer.isError, true);
  assert.doesNotMatch(textOf(longer), /abcdefgh1|field/);
});

// ── Раунд 2b: отказ правила полей не повторяет ничего из присланного ───────
// Имя поля берётся из текста агента, и за имя может сойти кусок значения
// («Comment = MyS3cretPass=2»). В причине — только номер строки.
test("a field refusal gives the line number and nothing from the content", async () => {
  const content = ["password = x1", "", "Тут пусто", "```", "/ip address add address=10.0.5.1/24", "name=u1 token=abc secret=def", "PrivateKey = kD5vT1pZ8wQ3", "```"].join("\n");
  const { source, tools } = make();
  const result = await tools.create({ ...GOOD, content }, CALLER);
  assert.equal(source.created.length, 0);
  // Строки 1, 6 и 7; две находки в строке 6 — одна причина
  assert.deepEqual(fieldLines(result), [1, 6, 7]);

  const two = await make().tools.create({ ...GOOD, content: fenced("a=1", "b=2", "c=3", "d=4", "password=qwe123").replace("a=1", "wpa2-pre-shared-key=Qw3rty") }, CALLER);
  assert.deepEqual(fieldLines(two), [3, 7]);
  assert.doesNotMatch(textOf(two), /wpa2|password|Qw3rty|qwe123/);

  // CRLF считается одной строкой; не больше пяти причин
  assert.deepEqual(fieldLines(await make().tools.create({ ...GOOD, content: fenced("x\r\ny\r\npassword=qwe123") }, CALLER)), [5]);
  const many = await make().tools.create({ ...GOOD, content: fenced(...Array.from({ length: 40 }, (unused, n) => `key${n}=v`)) }, CALLER);
  assert.deepEqual(fieldLines(many), [3, 4, 5, 6, 7]);
});

test("the I3 shapes: no reason holds a piece of the content", async () => {
  for (const line of ["p=MyS3cretPass=2", "Comment = MyS3cretPass=2", "p=abc&MyS3cretPass=2", 'comment="x MyS3cretPass=2"', "p=a?MyS3cretPass=2"]) {
    const result = await make().tools.create({ ...GOOD, content: fenced(line) }, CALLER);
    assert.doesNotMatch(textOf(result), /s3cret/i, line);
    if (!result.isError) continue;
    // Отказ — заголовок и причины по шаблону, больше ничего
    const [head, ...reasons] = textOf(result).split("\n");
    assert.equal(head, "The note was not saved:", line);
    for (const reason of reasons) assert.match(reason, FIELD_REASON, line);
    assert.deepEqual(fieldLines(result), [3], line);
  }
  assert.equal((await make().tools.create({ ...GOOD, content: fenced("p=MyS3cretPass=2") }, CALLER)).isError, undefined);
  for (const line of ["Comment = MyS3cretPass=2", "p=abc&MyS3cretPass=2"]) {
    assert.equal((await make().tools.create({ ...GOOD, content: fenced(line) }, CALLER)).isError, true, line);
  }
});
