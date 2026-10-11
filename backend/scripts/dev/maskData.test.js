const test = require("node:test");
const assert = require("node:assert/strict");
const {
  maskedPerson,
  maskedUser,
  maskedCompany,
  assertSafeTarget,
  buildContext,
  rewriteDocument,
  leakFinder,
  collectLeftovers,
  groupLeftovers,
  classifyPath,
  isMaskedPath,
  SNAPSHOTS,
  OWN_FIELDS,
  FREE_TEXT,
  LABELS,
  EMPTIED,
  KEPT_LOCAL,
} = require("./maskData");

const ID = "64f1a2b3c4d5e6f708192a3b";
const OTHER = "64f1a2b3c4d5e6f708192a3c";
const GONE = "64f1a2b3c4d5e6f7081fffff";

test("a person is derived from the id alone and is stable", () => {
  const first = maskedPerson(ID, false);
  assert.deepEqual(maskedPerson(ID, false), first);
  assert.equal(first.email, `u${ID}@example.com`);
  assert.match(first.phone, /^7900\d{7}$/);
  assert.equal(first.firstName, "Сотрудник");
  assert.match(first.lastName, /^[0-9A-F]{6}$/);
  assert.equal(maskedPerson(ID, true).firstName, "Клиент");
});

test("different ids give different e-mails and phones", () => {
  const other = maskedPerson("64f1a2b3c4d5e6f708192a3c", false);
  assert.notEqual(other.email, maskedPerson(ID, false).email);
  assert.notEqual(other.phone, maskedPerson(ID, false).phone);
});

test("a user update rewrites identity and removes secrets", () => {
  const update = maskedUser({ _id: ID, isEndUser: true, email: "real@corp.test", phone: "74951234567" });
  assert.equal(update.$set.email, `u${ID}@example.com`);
  assert.equal(update.$set.firstName, "Клиент");
  assert.equal(update.$set["telegramBot.isActive"], false);
  assert.equal(update.$set["telegramBot.chatId"], "");
  for (const field of ["password", "verifyToken", "resetToken", "profileImagePath", "backgroundImagePath", "activeDirectoryObjectGUID"]) {
    assert.ok(field in update.$unset, field);
  }
  assert.ok(!JSON.stringify(update).includes("real@corp.test"));
});

test("a user update also removes the legacy secrets and the remote-access key", () => {
  const update = maskedUser({ _id: ID, isEndUser: false });
  for (const field of ["notifications.password", "notifications.resetToken", "notify.byTelegram.chatId"]) {
    assert.ok(field in update.$unset, field);
  }
  assert.equal(update.$set["getScreen.api"], "");
  assert.equal(update.$set.twoFactorEnabled, false);
});

test("masking twice gives the same result", () => {
  const once = maskedUser({ _id: ID, isEndUser: false });
  const twice = maskedUser({ _id: ID, isEndUser: false, ...once.$set });
  assert.deepEqual(twice, once);
});

test("a company keeps its shape and loses its identity and keys", () => {
  const update = maskedCompany({ _id: ID, alias: "Настоящая", fullTitle: "ООО Настоящая", phones: ["74951234567", "74957654321"], emailDomains: ["corp.test"] });
  assert.match(update.$set.alias, /^Компания [0-9A-F]{6}$/);
  assert.equal(update.$set.fullTitle, `ООО «${update.$set.alias}»`);
  assert.equal(update.$set.phones.length, 2);
  assert.ok(update.$set.phones.every((phone) => /^7900\d{7}$/.test(phone)));
  assert.deepEqual(update.$set.emailDomains, []);
  assert.deepEqual(update.$set.apiKeys, []);
  assert.equal(update.$set.address, "");
  assert.equal(update.$set.linkToMap, "");
  for (const field of ["profileImagePath", "location", "locationSettings"]) assert.ok(field in update.$unset, field);
  assert.ok(!JSON.stringify(update).includes("Настоящая"));
});

test("it refuses anything that is not the local dev database", () => {
  const env = { NODE_ENV: "development", MONGODB_DATABASE: "hd-dev" };
  assert.doesNotThrow(() => assertSafeTarget(env, "hd-dev"));
  assert.throws(() => assertSafeTarget({ ...env, NODE_ENV: "production" }, "hd-dev"), /production/);
  assert.throws(() => assertSafeTarget(env, "hd-prod"), /hd-prod/);
  assert.throws(() => assertSafeTarget({ NODE_ENV: "development" }, "hd-dev"), /MONGODB_DATABASE/);
  assert.throws(() => assertSafeTarget({ ...env, NODE_ENV: undefined }, "hd-dev"), /NODE_ENV/);
});

// --- Снимки -------------------------------------------------------------------

const USERS = [
  { _id: ID, isEndUser: false, email: "ivanov@corp.test", firstName: "Иван", lastName: "Иванов" },
  { _id: OTHER, isEndUser: true, email: "petrova@client.test", firstName: "Анна", lastName: "Петрова" },
];
const ctx = buildContext(USERS);

// Применить правку так, как это сделает MongoDB: только верхние поля
const apply = (doc, update) => {
  const next = { ...doc, ...(update?.$set || {}) };
  for (const key of Object.keys(update?.$unset || {})) delete next[key];
  return next;
};

test("the snapshot table is well-formed", () => {
  const kinds = new Set(["person", "company", "personName", "personByName", "personNameByName", "subdivisionName"]);
  assert.ok(SNAPSHOTS.length > 40);
  const seen = new Set();
  for (const entry of SNAPSHOTS) {
    assert.equal(typeof entry.collection, "string");
    assert.equal(typeof entry.path, "string");
    assert.ok(kinds.has(entry.kind), `${entry.collection}.${entry.path}: ${entry.kind}`);
    assert.ok("idField" in entry, `${entry.collection}.${entry.path}: idField`);
    if (["personName", "personNameByName", "subdivisionName"].includes(entry.kind)) assert.equal(typeof entry.field, "string");
    const key = `${entry.collection}|${entry.path}|${entry.field || ""}`;
    assert.ok(!seen.has(key), `дубль: ${key}`);
    seen.add(key);
  }
});

test("a ticket's snapshots show the same masked person as the user record", () => {
  const ticket = {
    _id: "74f1a2b3c4d5e6f708192a3b",
    title: "Не печатает принтер у Ивановой",
    applicant: { _id: OTHER, firstName: "Анна", lastName: "Петрова", email: "petrova@client.test", phone: "74951234567", position: "Бухгалтер", role: "user", isActive: true },
    responsibles: [
      { _id: ID, firstName: "Иван", lastName: "Иванов", email: "ivanov@corp.test", phone: "", position: "Инженер" },
      { _id: GONE, firstName: "Пётр", lastName: "Уволенный", email: "gone@corp.test", phone: "74950000001" },
    ],
    removedFromResponsibles: [],
    checklist: [{ title: "Проверить кабель", checkedBy: { _id: ID, firstName: "Иван", lastName: "Иванов" } }, { title: "Без отметки" }],
    company: { _id: OTHER, alias: "Настоящая" },
    realSender: "Petrova Anna <petrova@client.test>",
  };
  const update = rewriteDocument("tickets", ticket, ctx);
  const masked = apply(ticket, update);

  const applicant = maskedPerson(OTHER, true);
  assert.deepEqual(masked.applicant, { ...ticket.applicant, ...applicant });
  assert.equal(masked.applicant.position, "Бухгалтер");

  const engineer = maskedPerson(ID, false);
  assert.equal(masked.responsibles[0].firstName, "Сотрудник");
  assert.equal(masked.responsibles[0].lastName, engineer.lastName);
  assert.equal(masked.responsibles[0].email, engineer.email);
  // Пустого телефона не выдумываем: форма снимка сохраняется
  assert.equal(masked.responsibles[0].phone, "");
  // Человека уже нет в users — имя всё равно берётся из идентификатора
  assert.equal(masked.responsibles[1].firstName, "Клиент");
  assert.equal(masked.responsibles[1].email, `u${GONE}@example.com`);

  assert.equal(masked.checklist[0].checkedBy.lastName, engineer.lastName);
  assert.equal(masked.checklist[0].title, "Проверить кабель");
  assert.deepEqual(masked.checklist[1], { title: "Без отметки" });
  assert.match(masked.company.alias, /^Компания [0-9A-F]{6}$/);
  assert.equal(masked.realSender, `u${OTHER}@example.com`);
  // Свободный текст не трогается, и в правку он не попадает
  assert.ok(!("title" in update.$set));
  assert.ok(!("removedFromResponsibles" in update.$set));
  for (const real of ["Иванов", "Петрова", "corp.test", "client.test", "Настоящая", "7495"]) {
    assert.ok(!JSON.stringify(update).includes(real), real);
  }
});

test("a second pass over a masked document changes nothing", () => {
  const work = {
    _id: "84f1a2b3c4d5e6f708192a3b",
    createdBy: { _id: ID, firstName: "Иван", lastName: "Иванов" },
    finishedBy: { _id: ID, firstName: "Иван", lastName: "Иванов", profileImagePath: "uploads/a.png" },
    updatedBy: ID, // ссылка вместо снимка — не трогаем
  };
  const first = rewriteDocument("works", work, ctx);
  assert.ok(!("profileImagePath" in first.$set.finishedBy));
  assert.ok(!("updatedBy" in first.$set));
  assert.equal(rewriteDocument("works", apply(work, first), ctx), null);
});

test("a snapshot without a usable id gets the constant person", () => {
  const update = rewriteDocument("works", { _id: ID, createdBy: { firstName: "Иван", lastName: "Иванов" } }, ctx);
  assert.deepEqual(update.$set.createdBy, { firstName: "Клиент", lastName: "000000" });
});

test("a snapshot stored without an id is resolved by the name it carries", () => {
  const log = { _id: "94f1a2b3c4d5e6f708192a3b", event: "Заявка взята в работу", user: { firstName: "Иван", lastName: "Иванов" } };
  const first = rewriteDocument("ticketlogs", log, ctx);
  assert.deepEqual(first.$set.user, { firstName: "Сотрудник", lastName: maskedPerson(ID, false).lastName });

  // Повторный прогон видит уже обезличенных людей и приходит к тому же
  const maskedCtx = buildContext(USERS.map((user) => ({ ...user, ...maskedUser(user).$set })));
  assert.equal(rewriteDocument("ticketlogs", apply(log, first), maskedCtx), null);

  const stranger = rewriteDocument("ticketlogs", { _id: ID, user: { firstName: "Некто", lastName: "Неизвестный" } }, ctx);
  assert.deepEqual(stranger.$set.user, { firstName: "Клиент", lastName: "000000" });
  assert.equal(rewriteDocument("ticketlogs", apply({ _id: ID }, stranger), maskedCtx), null);
});

test("embedded people and the company list inside a company are masked", () => {
  const company = {
    _id: OTHER,
    users: [{ _id: OTHER, fullName: "Петрова Анна", email: "petrova@client.test", phone: "74951234567", position: "Бухгалтер" }],
    responsibles: [{ id: ID, _id: GONE, firstName: "Иван", lastName: "Иванов", email: "ivanov@corp.test", phone: "74950000002" }],
    servicePlans: [{ _id: ID, approver: { _id: OTHER, firstName: "Анна", lastName: "Петрова" } }],
  };
  const masked = apply(company, rewriteDocument("companies", company, ctx));
  const client = maskedPerson(OTHER, true);
  assert.equal(masked.users[0].fullName, `${client.lastName} ${client.firstName}`);
  assert.equal(masked.users[0].email, client.email);
  assert.equal(masked.users[0].phone, client.phone);
  // Объявленная в схеме ссылка `id` главнее автоматического _id вложенного документа
  assert.equal(masked.responsibles[0].email, `u${ID}@example.com`);
  assert.equal(masked.servicePlans[0].approver.lastName, client.lastName);
});

test("notification recipients lose addresses, chat ids and names", () => {
  const notification = {
    _id: ID,
    text: "Иванов назначил вас ответственным",
    to: { email: "Petrova@client.test", chatId: "123456789", applicant: "Петрова Анна", responsible: "Чужой Человек", globalChat: true },
    intendedEmail: "nobody@elsewhere.test",
  };
  const update = rewriteDocument("notifications", notification, ctx);
  const client = maskedPerson(OTHER, true);
  assert.deepEqual(update.$set.to, {
    email: client.email,
    chatId: "0",
    applicant: `${client.lastName} ${client.firstName}`,
    responsible: "000000 Клиент",
    globalChat: true,
  });
  assert.equal(update.$set.intendedEmail, "unknown@example.com");
  assert.equal(rewriteDocument("notifications", apply(notification, update), ctx), null);
});

test("live links, tokens and directory logins are removed from their collections", () => {
  const report = rewriteDocument(
    "serviceplanreports",
    { _id: ID, accessTokens: [{ token: "secret", user: { _id: OTHER, firstName: "Анна", lastName: "Петрова" } }], parts: [{ subdivision: OTHER, subdivisionName: "Филиал на Ленина", decidedBy: { _id: OTHER, firstName: "Анна", lastName: "Петрова" } }] },
    ctx,
  );
  assert.deepEqual(report.$set.accessTokens, []);
  assert.match(report.$set.parts[0].subdivisionName, /^Подразделение [0-9A-F]{6}$/);
  assert.equal(report.$set.parts[0].decidedBy.firstName, "Клиент");

  const connection = rewriteDocument("pro32connections", { _id: ID, inviteUrl: "https://x.test/i", connectUrl: "https://x.test/c", inviteCode: "123", clientName: "BUH-PC" }, ctx);
  assert.equal(connection.$set.inviteUrl, "");
  assert.equal(connection.$set.connectUrl, "");
  assert.equal(connection.$set.inviteCode, "");
  assert.match(connection.$set.clientName, /^ПК [0-9A-F]{6}$/);

  const log = { _id: ID, userId: OTHER, activeDirectoryObjectGUID: "6f9619ff-8b86-d011-b42d-00c04fc964ff", activeDirectoryLogin: "petrova.a", firstName: "Анна", lastName: "Петрова", computerName: "BUH-PETROVA" };
  const first = rewriteDocument("companylogs", log, ctx);
  assert.match(first.$set.activeDirectoryObjectGUID, /^00000000-0000-4000-8000-[0-9a-f]{12}$/);
  assert.equal(first.$set.lastName, maskedPerson(OTHER, true).lastName);
  assert.ok(!JSON.stringify(first).toLowerCase().includes("petrova"));
  assert.equal(rewriteDocument("companylogs", apply(log, first), ctx), null);

  // Несвязанная учётка: один и тот же GUID всегда даёт одного и того же «человека»
  const loose = { ...log, _id: OTHER, userId: null };
  const again = { ...log, _id: GONE, userId: null };
  const a = rewriteDocument("companylogs", loose, ctx).$set;
  const b = rewriteDocument("companylogs", again, ctx).$set;
  assert.equal(a.lastName, b.lastName);
  assert.equal(a.activeDirectoryLogin, b.activeDirectoryLogin);
  assert.equal(rewriteDocument("companylogs", apply(loose, { $set: a }), ctx), null);
});

test("a collection outside the map is left alone", () => {
  assert.equal(rewriteDocument("clientdevices", { _id: ID, hostname: "BUH-PC" }, ctx), null);
});

// --- Отчёт --------------------------------------------------------------------

test("the report finds leftover e-mails, phones and names, and ignores masked values", () => {
  const find = leakFinder({
    emails: ["Ivanov@corp.test", `u${ID}@example.com`],
    phones: ["74951234567", "79001234567", ""],
    names: ["Иванов", "Настоящая", "Клиент", "3F2A1B", "Компания 3F2A1B"],
  });
  assert.deepEqual(find("Пишите на ivanov@corp.test, спасибо"), ["email"]);
  assert.deepEqual(find("тел. +7 (495) 123-45-67"), ["phone"]);
  assert.deepEqual(find("8 495 123 45 67"), ["phone"]);
  assert.deepEqual(find("Иванов"), ["name"]);
  // Имя ищется целым значением: в свободном тексте фамилии не считаем
  assert.deepEqual(find("Звонил Иванов"), []);
  for (const masked of [`u${ID}@example.com`, "79001234567", "Клиент", "3F2A1B", "Компания 3F2A1B", ""]) {
    assert.deepEqual(find(masked), [], masked);
  }
  assert.equal(find.size, 4);
});

test("on an already masked database the report has nothing to look for", () => {
  const user = { _id: ID, isEndUser: false, ...maskedUser({ _id: ID, isEndUser: false }).$set };
  const company = maskedCompany({ _id: OTHER, phones: ["74951234567"] }).$set;
  const find = leakFinder({
    emails: [user.email, "unknown@example.com", `s${ID}@example.com`],
    phones: [user.phone, ...company.phones],
    names: [user.firstName, user.lastName, `${user.lastName} ${user.firstName}`, `${user.firstName} ${user.lastName}`, company.alias, company.fullTitle, "Подразделение 3F2A1B", `Поставщик ${ID}`],
  });
  assert.equal(find.size, 0);
});

test("a mailed ticket and a mailed comment lose the Message-ID with the sender's mail host", () => {
  const ticket = rewriteDocument("tickets", { _id: ID, emailMessageId: "<abc123@mail.client.test>", title: "Письмо" }, ctx);
  assert.deepEqual(ticket, { $unset: { emailMessageId: "" } });
  const comment = rewriteDocument("comments", { _id: ID, content: "Ответ", emailMessageId: "<def456@mail.client.test>" }, ctx);
  assert.deepEqual(comment, { $unset: { emailMessageId: "" } });
  assert.equal(rewriteDocument("comments", { _id: ID, content: "Ответ" }, ctx), null);
});

test("a device record stays, the licence key in it does not", () => {
  const device = { _id: ID, hostname: "BUH-PC", installedSoftware: [{ name: "Редактор", version: "2", licenseKey: "AAAA-BBBB" }, { name: "Без ключа" }] };
  const update = rewriteDocument("clientdevices", device, ctx);
  assert.deepEqual(update.$set.installedSoftware, [{ name: "Редактор", version: "2", licenseKey: "" }, { name: "Без ключа" }]);
  assert.ok(!("hostname" in update.$set));
  assert.equal(rewriteDocument("clientdevices", apply(device, update), ctx), null);
});

test("a masked copy cannot reach the source installation's devices", () => {
  const router = {
    _id: ID,
    name: "gw-office",
    monitoringEnabled: true,
    credentials: { host: "192.0.2.10", port: 8729, user: "hd", password: "v1:aaa:bbb:ccc", useTls: true, tlsCert: "PEM", knockSequence: "v1:ddd:eee:fff", sshPort: 22, sshHostKey: "SHA256:x" },
    schedules: { backup: { frequency: "daily", time: "03:00" }, export: { frequency: "off" } },
  };
  const update = rewriteDocument("mikrotiks", router, ctx);
  assert.deepEqual(update.$set.credentials, { host: "192.0.2.10", port: 8729, user: "hd", useTls: true, tlsCert: "PEM", sshPort: 22, sshHostKey: "SHA256:x" });
  assert.equal(update.$set.monitoringEnabled, false);
  assert.deepEqual(update.$set.schedules, { backup: { frequency: "off", time: "03:00" }, export: { frequency: "off" } });
  assert.ok(!("name" in update.$set));
  assert.equal(rewriteDocument("mikrotiks", apply(router, update), ctx), null);
  // Запись без учётных данных и с выключенным опросом не трогается
  assert.equal(rewriteDocument("mikrotiks", { _id: ID, name: "spare", monitoringEnabled: false }, ctx), null);

  const change = { _id: ID, title: "VPN", wireguard: { publicKey: "pub", privateKey: "v1:a:b:c", presharedKey: "v1:d:e:f", client: { address: "10.0.0.2/32" } } };
  const masked = rewriteDocument("mikrotikchanges", change, ctx);
  assert.deepEqual(masked.$set.wireguard, { publicKey: "pub", client: { address: "10.0.0.2/32" } });
  assert.equal(rewriteDocument("mikrotikchanges", apply(change, masked), ctx), null);

  for (const path of ["credentials.password", "credentials.knockSequence"]) assert.equal(classifyPath("mikrotiks", path), "structured");
  assert.equal(classifyPath("mikrotikchanges", "wireguard.privateKey"), "structured");
  assert.equal(classifyPath("mikrotiks", "credentials.host"), "label");
});

test("a supplier's name is unique by construction", () => {
  const a = rewriteDocument("suppliers", { _id: "64f1a2b3c4d5e6f708192a3b", name: "Первый" }, ctx).$set.name;
  // Те же последние шесть знаков у другого идентификатора
  const b = rewriteDocument("suppliers", { _id: "74f1a2b3c4d5e6f708192a3b", name: "Второй" }, ctx).$set.name;
  assert.notEqual(a, b);
  assert.equal(a, "Поставщик 64f1a2b3c4d5e6f708192a3b");
  assert.equal(leakFinder({ names: [a] }).size, 0);
});

// --- Классы полей ---------------------------------------------------------------

test("a field is a structured leftover, free text or a label", () => {
  assert.equal(classifyPath("tickets", "description"), "free");
  assert.equal(classifyPath("comments", "content"), "free");
  assert.equal(classifyPath("tickets", "aiGuide.sources[].title"), "free");
  assert.equal(classifyPath("knowledgenotes", "plainText"), "free");
  assert.equal(classifyPath("tickets", "attachments[].speechToText.segments[].speaker"), "free");
  assert.equal(classifyPath("locations", "name"), "label");
  assert.equal(classifyPath("tickets", "responsibles[].position"), "label");
  assert.equal(classifyPath("serviceplans", "title"), "label");
  assert.equal(classifyPath("mikrotiks", "name"), "label");
  assert.equal(classifyPath("clientdevices", "hostname"), "label");
  // Поле, которое скрипт правит, — всегда недоработка, даже внутри «названий»
  assert.equal(classifyPath("tickets", "applicant.email"), "structured");
  assert.equal(classifyPath("clientdevices", "installedSoftware[].licenseKey"), "structured");
  assert.equal(classifyPath("mikrotikevents", "actor.name"), "structured");
  assert.equal(classifyPath("locations", "address"), "structured");
  assert.equal(classifyPath("tickets", "emailMessageId"), "structured");
  assert.equal(classifyPath("authSessions", "token"), "structured");
  // Нигде не описанное — тоже: о новом поле надо принять решение
  assert.equal(classifyPath("somethingNew", "owner.email"), "structured");
  assert.equal(classifyPath("tickets", "brandNewField"), "structured");
});

test("the report walk counts leftovers by path and sorts them into the three groups", () => {
  const find = leakFinder({ emails: ["ivanov@corp.test"], phones: ["74951234567"], names: ["Иванов", "Склад"] });
  const counts = new Map();
  collectLeftovers(find, "tickets", {
    _id: ID,
    description: "Пишите на ivanov@corp.test или +7 (495) 123-45-67",
    responsibles: [{ lastName: "Иванов", position: "Иванов" }, { lastName: "Иванов" }],
    comments: [ID],
  }, counts);
  collectLeftovers(find, "knowledgenotes", { plainText: "Контакт: ivanov@corp.test" }, counts);
  collectLeftovers(find, "locations", { name: "Склад", notes: "Склад" }, counts);
  collectLeftovers(find, "newcollection", { tags: ["Иванов"], nested: [[{ mail: "ivanov@corp.test" }]] }, counts);

  assert.deepEqual(groupLeftovers(counts), {
    structured: [
      "newcollection.nested[][].mail: 1 (email 1)",
      "newcollection.tags[]: 1 (name 1)",
      "tickets.responsibles[].lastName: 2 (name 2)",
    ],
    free: [
      "knowledgenotes.plainText: 1 (email 1)",
      "tickets.description: 2 (email 1, phone 1)",
    ],
    label: [
      "locations.name: 1 (name 1)",
      "locations.notes: 1 (name 1)",
      "tickets.responsibles[].position: 1 (name 1)",
    ],
  });
});

// --- Сверка со схемами -----------------------------------------------------------

// Строковые и Mixed-поля всех моделей: [коллекция, путь]. Поля-перечисления не в
// счёт — в них лежит одно из заранее известных значений.
const modelPaths = () => {
  const fs = require("node:fs");
  const path = require("node:path");
  require("module-alias/register");
  const mongoose = require("mongoose");
  // Подключения нет и не будет: запрос, который одна из моделей шлёт при
  // загрузке, должен отказать сразу, а не держать процесс до тайм-аута
  mongoose.set("bufferCommands", false);
  const root = path.resolve(__dirname, "../../models");
  const files = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => (item.isDirectory() ? files(path.join(dir, item.name)) : [path.join(dir, item.name)]));
  for (const file of files(root)) if (file.endsWith(".js") && !file.endsWith(".test.js")) require(file);

  const out = { text: [], all: [] };
  const walk = (collection, schema, prefix) =>
    schema.eachPath((name, type) => {
      const full = prefix + name;
      if (type.schema) return walk(collection, type.schema, `${full}${type.$isMongooseArray ? "[]." : "."}`);
      const inner = type.$isMongooseArray ? type.embeddedSchemaType || type.caster : type;
      const leaf = type.$isMongooseArray ? `${full}[]` : full;
      out.all.push([collection, leaf]);
      const isEnum = Boolean(inner?.enumValues?.length);
      if ((inner?.instance === "String" && !isEnum) || inner?.instance === "Mixed") out.text.push([collection, leaf]);
    });
  for (const name of mongoose.modelNames()) walk(mongoose.model(name).collection.name, mongoose.model(name).schema, "");
  return out;
};

test("every text field of every model is masked, free text or a label", () => {
  const { text } = modelPaths();
  assert.ok(text.length > 300, `полей найдено: ${text.length}`);
  // Идентификаторы-строки собственных счётчиков
  const technical = new Set(["counters._id", "inventorycounters._id", "mikrotikfirmwarestates._id"]);
  const undecided = text
    .filter(([collection]) => !KEPT_LOCAL.includes(collection))
    .filter(([collection, path]) => !technical.has(`${collection}.${path}`))
    .filter(([collection, path]) => !isMaskedPath(collection, path) && classifyPath(collection, path) === "structured")
    .map(([collection, path]) => `${collection}.${path}`);
  assert.deepEqual(undecided, [], "поле модели не описано: добавьте его в SNAPSHOTS/OWN_FIELDS, FREE_TEXT или LABELS");

  // Проверка не пустая: без записи о plainText заметка базы знаний была бы недоработкой
  const saved = FREE_TEXT.knowledgenotes;
  FREE_TEXT.knowledgenotes = saved.filter((entry) => entry !== "plainText");
  try {
    assert.equal(classifyPath("knowledgenotes", "plainText"), "structured");
  } finally {
    FREE_TEXT.knowledgenotes = saved;
  }
});

test("the tables name no field that the models do not have", () => {
  const { all } = modelPaths();
  const collections = new Set(all.map(([collection]) => collection));
  const exists = (collection, prefix) =>
    prefix === "*"
      ? collections.has(collection)
      : all.some(([name, path]) => name === collection && (path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[]`)));
  const phantoms = [];
  for (const [table, entries] of Object.entries({ FREE_TEXT, LABELS })) {
    for (const [collection, prefixes] of Object.entries(entries)) {
      for (const prefix of prefixes) if (!exists(collection, prefix)) phantoms.push(`${table}.${collection}: ${prefix}`);
    }
  }
  for (const [collection, rule] of Object.entries(OWN_FIELDS)) {
    // Коллекции без модели: прежнее имя сеансов удалённого доступа и better-auth
    if (["getscreenconnections", "organization"].includes(collection)) continue;
    for (const prefix of rule.masks) if (!exists(collection, prefix)) phantoms.push(`OWN_FIELDS.${collection}: ${prefix}`);
  }
  assert.deepEqual(phantoms, []);
  for (const collection of EMPTIED) assert.equal(classifyPath(collection, "anything"), "structured");
});
