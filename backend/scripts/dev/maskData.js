/**
 * Обезличивание копии базы после ops/sync-dev-db.sh. Только для разработки:
 * в образ продукта не входит (backend/.dockerignore), на рабочей базе
 * запускаться отказывается.
 *
 * Меняются поля, по которым человека или компанию можно узнать, и всё, чем
 * можно войти. Свободный текст (заявки, комментарии, сообщения) не трогается —
 * копия псевдонимизирована, а не анонимна; см. ops/README.md.
 *
 * Запуск (в dev-контейнере backend):  node scripts/dev/maskData.js [--report]
 *   --report   после обезличивания пройти всю базу и назвать поля, где остались
 *              прежние адреса, телефоны и имена (код 1, если такое поле не
 *              свободный текст)
 *   --target   только назвать базу, к которой скрипт подключился, и выйти
 *   --preflight  без подключения проверить, что запуск здесь возможен
 *              (окружение, пароль, зависимости); этим ops/sync-dev-db.sh
 *              убеждается в этом ДО того, как что-либо скачает или удалит
 */
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");

const hex6 = (id) => String(id).slice(-6).toUpperCase();

// Телефон из идентификатора: 7 900 + семь цифр. Счётчик ObjectId — последние
// три байта, поэтому у соседних документов номера разные.
const phoneOf = (id, salt = 0) =>
  `7900${String((parseInt(String(id).slice(-6), 16) + salt * 7919) % 10_000_000).padStart(7, "0")}`;

const maskedPerson = (id, isEndUser) => ({
  email: `u${String(id)}@example.com`,
  phone: phoneOf(id),
  firstName: isEndUser ? "Клиент" : "Сотрудник",
  lastName: hex6(id),
});

const maskedUser = (doc) => ({
  $set: {
    ...maskedPerson(doc._id, doc.isEndUser === true),
    "telegramBot.isActive": false,
    "telegramBot.chatId": "",
    "telegramBot.linkedAt": null,
    twoFactorEnabled: false,
    // Личный ключ стороннего сервиса удалённого доступа — тот же вход, только не к нам
    "getScreen.api": "",
  },
  $unset: {
    password: "",
    verifyToken: "",
    verifyTokenExpiration: "",
    resetToken: "",
    resetTokenExpiration: "",
    profileImagePath: "",
    backgroundImagePath: "",
    activeDirectoryObjectGUID: "",
    // Следы прежних механизмов: пароль и токен в `notifications`, чат в `notify`
    "notifications.password": "",
    "notifications.resetToken": "",
    "notify.byTelegram.chatId": "",
  },
});

const companyAlias = (id) => `Компания ${hex6(id)}`;

const maskedCompany = (doc) => {
  const alias = companyAlias(doc._id);
  return {
    $set: {
      alias,
      fullTitle: `ООО «${alias}»`,
      phones: (doc.phones || []).map((_, index) => phoneOf(doc._id, index + 1)),
      emailDomains: [],
      apiKeys: [],
      address: "",
      linkToMap: "",
    },
    $unset: { profileImagePath: "", location: "", locationSettings: "" },
  };
};

const assertSafeTarget = (env, dbName) => {
  if (!env.NODE_ENV) throw new Error("NODE_ENV не задан: скрипт работает только в dev-контейнере");
  if (env.NODE_ENV === "production") throw new Error("Отказ: NODE_ENV=production");
  if (!env.MONGODB_DATABASE) throw new Error("MONGODB_DATABASE не задан");
  if (dbName !== env.MONGODB_DATABASE) {
    throw new Error(`Отказ: подключение к базе ${dbName}, а локальная — ${env.MONGODB_DATABASE}`);
  }
  if (/prod/i.test(String(dbName))) throw new Error(`Отказ: имя базы ${dbName} похоже на рабочую`);
};

// --- Снимки людей и компаний в чужих документах --------------------------------

/**
 * Где лежат копии имён, адресов и названий вне `users` и `companies`.
 *
 *   path     путь до объекта-снимка; `[]` — массив объектов, пустой путь — сам
 *            документ
 *   idField  поле снимка со ссылкой на человека или компанию (null — ссылки нет).
 *            Если рядом с `_id` есть поле `id`, берётся оно: в схемах компании
 *            ссылка объявлена как `id`, а `_id` Mongoose выдаёт вложенному
 *            документу сам
 *   kind     person            объект: firstName, lastName, fullName, email, phone
 *            company           объект: alias, fullTitle
 *            personName        одно строковое поле `field` с именем человека;
 *                              `onlyWithId` — без ссылки значение не трогается
 *                              (там имя не человека, а системы или устройства)
 *            personByName      объект { firstName, lastName } без ссылки — человек
 *                              находится по самому имени
 *            personNameByName  строка «Фамилия Имя» без ссылки
 *            subdivisionName   одно строковое поле `field` с названием подразделения
 *
 * Список собран по моделям (grep из плана) и сверен с живыми документами: в
 * базе встречаются поля, которых в схемах уже нет (works.ticketApplicant,
 * tickettemplates.category.users, comments.createdBy объектом). Новое поле со
 * снимком добавляется сюда; пропуск показывает `--report`.
 */
const SNAPSHOTS = [
  { collection: "users", path: "company", idField: "_id", kind: "company" },
  { collection: "users", path: "responsibleForCompanies[]", idField: "_id", kind: "company" },
  // Резервная копия users, оставленная миграцией отключения учёток
  { collection: "users_before_banned", path: "company", idField: "_id", kind: "company" },
  { collection: "users_before_banned", path: "responsibleForCompanies[]", idField: "_id", kind: "company" },

  { collection: "companies", path: "users[]", idField: "_id", kind: "person" },
  { collection: "companies", path: "responsibles[]", idField: "_id", kind: "person" },
  { collection: "companies", path: "clientsSideResponsibles[]", idField: "_id", kind: "person" },
  { collection: "companies", path: "servicePlans[].approver", idField: "_id", kind: "person" },

  { collection: "tickets", path: "applicant", idField: "_id", kind: "person" },
  { collection: "tickets", path: "responsibles[]", idField: "_id", kind: "person" },
  { collection: "tickets", path: "removedFromResponsibles[]", idField: "_id", kind: "person" },
  { collection: "tickets", path: "checklist[].checkedBy", idField: "_id", kind: "person" },
  { collection: "tickets", path: "company", idField: "_id", kind: "company" },
  // Прежняя вложенная категория заявки со списком её людей
  { collection: "tickets", path: "category.users[]", idField: "_id", kind: "person" },

  { collection: "works", path: "createdBy", idField: "_id", kind: "person" },
  { collection: "works", path: "updatedBy", idField: "_id", kind: "person" },
  { collection: "works", path: "finishedBy", idField: "_id", kind: "person" },
  { collection: "works", path: "executor", idField: "_id", kind: "person" },
  { collection: "works", path: "ticketApplicant", idField: "_id", kind: "person" },
  { collection: "works", path: "finances.contractor.confirmedBy", idField: "_id", kind: "person" },
  { collection: "works", path: "finances.customer.confirmedBy", idField: "_id", kind: "person" },

  // У старых комментариев автор вложен объектом, у новых это ссылка
  { collection: "comments", path: "createdBy", idField: "_id", kind: "person" },
  { collection: "comments", path: "channel", idField: null, kind: "personName", field: "authorName" },

  { collection: "ticketlogs", path: "user", idField: null, kind: "personByName" },

  { collection: "tickettemplates", path: "company", idField: "_id", kind: "company" },
  { collection: "tickettemplates", path: "sharedCompanies[]", idField: "_id", kind: "company" },
  { collection: "tickettemplates", path: "sharedUsers[]", idField: "_id", kind: "person" },
  { collection: "tickettemplates", path: "createdBy", idField: "_id", kind: "person" },
  { collection: "tickettemplates", path: "updatedBy", idField: "_id", kind: "person" },
  { collection: "tickettemplates", path: "category.users[]", idField: "_id", kind: "person" },

  { collection: "ticketcategories", path: "users[]", idField: "_id", kind: "person" },

  { collection: "routinetasks", path: "company", idField: "_id", kind: "company" },
  { collection: "routinetasks", path: "applicant", idField: "_id", kind: "person" },
  { collection: "routinetasks", path: "responsibles[]", idField: "_id", kind: "person" },

  { collection: "knowledgenotes", path: "companies[]", idField: "_id", kind: "company" },
  { collection: "knowledgenotes", path: "users[]", idField: "_id", kind: "person" },
  { collection: "knowledgenotes", path: "users[].company", idField: "_id", kind: "company" },

  { collection: "serviceplans", path: "companies[]", idField: "_id", kind: "company" },

  { collection: "serviceplanreports", path: "approval.finalApprover", idField: "_id", kind: "person" },
  { collection: "serviceplanreports", path: "parts[].decidedBy", idField: "_id", kind: "person" },
  { collection: "serviceplanreports", path: "timeline[].by", idField: "_id", kind: "person" },
  { collection: "serviceplanreports", path: "parts[]", idField: "subdivision", kind: "subdivisionName", field: "subdivisionName" },
  { collection: "serviceplanreports", path: "timeline[]", idField: "subdivision", kind: "subdivisionName", field: "subdivisionName" },

  { collection: "aifeedbacks", path: "company", idField: "_id", kind: "company" },
  { collection: "aifeedbacks", path: "createdBy", idField: "_id", kind: "person" },

  { collection: "checklisttemplates", path: "createdBy", idField: "_id", kind: "person" },
  { collection: "checklisttemplates", path: "updatedBy", idField: "_id", kind: "person" },

  { collection: "inappnotifications", path: "actor", idField: "_id", kind: "person" },

  { collection: "notifications", path: "to", idField: null, kind: "personNameByName", field: "applicant" },
  { collection: "notifications", path: "to", idField: null, kind: "personNameByName", field: "responsible" },
  { collection: "notifications", path: "to", idField: null, kind: "personNameByName", field: "manager" },

  // Сеансы удалённого доступа: нынешняя коллекция и её прежнее имя
  { collection: "pro32connections", path: "user", idField: "_id", kind: "person" },
  { collection: "getscreenconnections", path: "user", idField: "_id", kind: "person" },

  { collection: "messages", path: "", idField: "authorUserId", kind: "personName", field: "authorName" },
  { collection: "messages", path: "event", idField: "byUserId", kind: "personName", field: "byName" },
  { collection: "messages", path: "event", idField: null, kind: "personName", field: "targetName" },
  { collection: "conversations", path: "lastMessage", idField: null, kind: "personName", field: "authorName" },

  { collection: "mikrotikevents", path: "actor", idField: "userId", kind: "personName", field: "name", onlyWithId: true },
];

const UNKNOWN_PERSON = { firstName: "Клиент", lastName: "000000" };
const UNKNOWN_EMAIL = "unknown@example.com";
const displayName = (person) => `${person.lastName} ${person.firstName}`;

// Значения, которые выдаёт сам скрипт: повторный прогон их не трогает, а отчёт
// не считает остатком
const MASKED_FIRST_NAMES = new Set(["Клиент", "Сотрудник"]);
const MASKED_EMAIL = /^(u[0-9a-f]{24}|s[0-9a-f]{24}|unknown)@example\.com$/;
const MASKED_PHONE = /^7900\d{7}$/;
const MASKED_FULL_NAME = /^[0-9A-F]{6} (Клиент|Сотрудник)$/;
const MASKED_NAME_EITHER_ORDER = /^([0-9A-F]{6} (Клиент|Сотрудник)|(Клиент|Сотрудник) [0-9A-F]{6})$/;
const MASKED_GUID = /^00000000-0000-4000-8000-[0-9a-f]{12}$/;
const MASKED_LABEL = /^(ООО «Компания [0-9A-F]{6}»|(Компания|Подразделение|ПК|Диалог) [0-9A-F]{6}|Поставщик [0-9a-f]{24}|[0-9A-F]{6}|user-[0-9a-f]{6}|Клиент|Сотрудник|Организация)$/;

const isPlain = (value) => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

// Копия обычных объектов и массивов; ObjectId, даты и буферы остаются теми же
// экземплярами — их скрипт не меняет
const deepClone = (value) => {
  if (Array.isArray(value)) return value.map(deepClone);
  if (!isPlain(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, deepClone(inner)]));
};

const usableId = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return /^[0-9a-f]{24}$/i.test(text) ? text : null;
};

const filled = (value) => typeof value === "string" && value !== "";
const nameKey = (value) => String(value ?? "").trim().toLowerCase();

/**
 * Что нужно знать о людях до обезличивания: кто клиент, а кто сотрудник, и чьи
 * это адрес и имя — для снимков, где ссылки на человека нет. При совпадении имён
 * берётся человек с меньшим идентификатором, чтобы результат не зависел от
 * порядка чтения.
 */
const buildContext = (users) => {
  const known = new Set();
  const endUsers = new Set();
  const byEmail = new Map();
  const byName = new Map();
  const byFullName = new Map();
  const remember = (map, key, id) => {
    if (key && !map.has(key)) map.set(key, id);
  };
  const sorted = [...users].sort((a, b) => String(a._id).localeCompare(String(b._id)));
  for (const user of sorted) {
    const id = String(user._id);
    known.add(id);
    if (user.isEndUser === true) endUsers.add(id);
    remember(byEmail, nameKey(user.email), id);
    const first = nameKey(user.firstName);
    const last = nameKey(user.lastName);
    if (first || last) {
      remember(byName, `${first}\u0000${last}`, id);
      remember(byFullName, `${last} ${first}`.trim(), id);
      remember(byFullName, `${first} ${last}`.trim(), id);
    }
  }
  // Кого в users уже нет, считаем клиентом: сотрудников удаляют редко
  const personOf = (id) => maskedPerson(id, known.has(id) ? endUsers.has(id) : true);
  return { personOf, byEmail, byName, byFullName };
};

const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+/gi;

// Адрес без ссылки на человека: находим владельца по самому адресу
const maskedEmailValue = (value, ctx) => {
  const email = nameKey(value);
  if (MASKED_EMAIL.test(email)) return email;
  const id = ctx.byEmail.get(email);
  return id ? maskedPerson(id, false).email : UNKNOWN_EMAIL;
};

const refOf = (node, entry) => {
  if (entry.idField === null) return null;
  if (entry.idField === "_id" && usableId(node.id)) return usableId(node.id);
  return usableId(node[entry.idField]);
};

const REWRITERS = {
  person(node, entry, ctx) {
    const id = refOf(node, entry);
    const person = id ? ctx.personOf(id) : UNKNOWN_PERSON;
    if ("firstName" in node || "lastName" in node) {
      node.firstName = person.firstName;
      node.lastName = person.lastName;
    }
    if (filled(node.fullName)) node.fullName = displayName(person);
    if (filled(node.email)) node.email = person.email || UNKNOWN_EMAIL;
    if (filled(node.phone)) node.phone = person.phone || phoneOf("000000");
    delete node.profileImagePath;
  },
  company(node, entry) {
    const id = refOf(node, entry);
    const alias = id ? companyAlias(id) : "Компания 000000";
    if ("alias" in node) node.alias = alias;
    if (filled(node.fullTitle)) node.fullTitle = `ООО «${alias}»`;
  },
  personName(node, entry, ctx) {
    if (!filled(node[entry.field])) return;
    const id = refOf(node, entry);
    if (!id && entry.onlyWithId) return;
    node[entry.field] = displayName(id ? ctx.personOf(id) : UNKNOWN_PERSON);
  },
  personByName(node, _entry, ctx) {
    if (!("firstName" in node) && !("lastName" in node)) return;
    // Уже обезличено прошлым прогоном
    if (MASKED_FIRST_NAMES.has(node.firstName) && /^[0-9A-F]{6}$/.test(node.lastName || "")) return;
    const id = ctx.byName.get(`${nameKey(node.firstName)}\u0000${nameKey(node.lastName)}`);
    const person = id ? ctx.personOf(id) : UNKNOWN_PERSON;
    node.firstName = person.firstName;
    node.lastName = person.lastName;
  },
  personNameByName(node, entry, ctx) {
    const value = node[entry.field];
    if (!filled(value) || MASKED_FULL_NAME.test(value)) return;
    const id = ctx.byFullName.get(nameKey(value));
    node[entry.field] = displayName(id ? ctx.personOf(id) : UNKNOWN_PERSON);
  },
  subdivisionName(node, entry) {
    if (!filled(node[entry.field])) return;
    node[entry.field] = `Подразделение ${hex6(refOf(node, entry) || "000000")}`;
  },
};

const visit = (node, segments, fn) => {
  if (!isPlain(node)) return;
  if (!segments.length) return fn(node);
  const [segment, ...rest] = segments;
  const isArray = segment.endsWith("[]");
  const child = node[isArray ? segment.slice(0, -2) : segment];
  if (isArray) {
    if (Array.isArray(child)) child.forEach((item) => visit(item, rest, fn));
  } else {
    visit(child, rest, fn);
  }
};

const segmentsOf = (path) => (path ? path.split(".") : []);
const blank = (node, fields) => {
  for (const field of fields) if (filled(node[field])) node[field] = "";
};

/**
 * Собственные поля коллекций, которые не снимок человека или компании, но тоже
 * называют их или дают доступ: `fields` — верхние поля, которые правило читает
 * и пишет, `masks` — что именно из них правится (по этому списку отчёт отличает
 * недоправленное поле от свободного текста).
 */
const OWN_FIELDS = {
  // Подразделение клиента: название, адрес и контакты выдают компанию
  subdivisions: {
    fields: ["name", "email", "phone", "address", "linkToMap", "location"],
    masks: ["name", "email", "phone", "address", "linkToMap", "location"],
    apply(doc) {
      if (filled(doc.name)) doc.name = `Подразделение ${hex6(doc._id)}`;
      if (filled(doc.email)) doc.email = `s${String(doc._id)}@example.com`;
      if (filled(doc.phone)) doc.phone = phoneOf(doc._id);
      blank(doc, ["address", "linkToMap"]);
      delete doc.location;
    },
  },
  // Поставщик — сторонняя компания с реквизитами. На названии уникальный
  // индекс, поэтому оно выводится из идентификатора целиком: шесть знаков
  // могли бы совпасть у двух поставщиков и оборвать прогон посередине.
  suppliers: {
    fields: ["name", "phone", "email", "website", "address", "inn", "kpp"],
    masks: ["name", "phone", "email", "website", "address", "inn", "kpp"],
    apply(doc) {
      if (filled(doc.name)) doc.name = `Поставщик ${String(doc._id)}`;
      if (filled(doc.email)) doc.email = `s${String(doc._id)}@example.com`;
      if (filled(doc.phone)) doc.phone = phoneOf(doc._id);
      blank(doc, ["website", "address", "inn", "kpp"]);
    },
  },
  // Журнал входов из Active Directory: логин, имя и имя компьютера называют
  // человека. GUID заменяется значением, выведенным из него же: записи одной
  // учётки остаются вместе, а настоящий идентификатор каталога не остаётся.
  companylogs: {
    fields: ["userId", "activeDirectoryObjectGUID", "activeDirectoryLogin", "firstName", "lastName", "computerName"],
    masks: ["activeDirectoryObjectGUID", "activeDirectoryLogin", "firstName", "lastName", "computerName"],
    apply(doc, ctx) {
      const guid = String(doc.activeDirectoryObjectGUID ?? "");
      const masked = MASKED_GUID.test(guid)
        ? guid
        : `00000000-0000-4000-8000-${createHash("sha256").update(guid).digest("hex").slice(0, 12)}`;
      if ("activeDirectoryObjectGUID" in doc) doc.activeDirectoryObjectGUID = masked;
      const id = usableId(doc.userId);
      const person = id ? ctx.personOf(id) : { firstName: "Клиент", lastName: masked.slice(-6).toUpperCase() };
      if ("firstName" in doc) doc.firstName = person.firstName;
      if ("lastName" in doc) doc.lastName = person.lastName;
      if ("activeDirectoryLogin" in doc) doc.activeDirectoryLogin = `user-${person.lastName.toLowerCase()}`;
      if (filled(doc.computerName)) doc.computerName = `ПК ${person.lastName}`;
    },
  },
  // Очередь уведомлений: адрес и чат получателя. Ненулевой чат оставляет запись
  // телеграмной, но отправить её некуда.
  notifications: {
    fields: ["to", "intendedEmail"],
    masks: ["to.email", "to.chatId", "to.companyChat", "intendedEmail"],
    apply(doc, ctx) {
      if (isPlain(doc.to)) {
        if (filled(doc.to.email)) doc.to.email = maskedEmailValue(doc.to.email, ctx);
        if (filled(doc.to.chatId)) doc.to.chatId = "0";
        if (filled(doc.to.companyChat)) doc.to.companyChat = "0";
      }
      if (filled(doc.intendedEmail)) doc.intendedEmail = maskedEmailValue(doc.intendedEmail, ctx);
    },
  },
  // Отправитель письма или собеседник, не опознанный как пользователь, и
  // Message-ID письма: в нём почтовый узел отправителя, то есть домен клиента —
  // то же, что вычищается из companies.emailDomains. Поле нужно только для
  // защиты от повторной обработки входящего письма, индекс по нему разреженный.
  tickets: {
    fields: ["realSender", "emailMessageId"],
    masks: ["realSender", "emailMessageId"],
    apply(doc, ctx) {
      delete doc.emailMessageId;
      if (!filled(doc.realSender)) return;
      const [email] = doc.realSender.match(EMAIL_IN_TEXT) || [];
      doc.realSender = email ? maskedEmailValue(email, ctx) : UNKNOWN_PERSON.firstName;
    },
  },
  comments: {
    fields: ["emailMessageId"],
    masks: ["emailMessageId"],
    apply(doc) {
      delete doc.emailMessageId;
    },
  },
  // Запись об устройстве остаётся как есть, секрет в ней — нет
  clientdevices: {
    fields: ["installedSoftware"],
    masks: ["installedSoftware[].licenseKey"],
    apply(doc) {
      if (!Array.isArray(doc.installedSoftware)) return;
      for (const item of doc.installedSoftware) if (isPlain(item)) blank(item, ["licenseKey"]);
    },
  },
  // Доступ к чужим устройствам. Обезличенная копия не должна уметь войти на
  // роутер исходной установки: пароль и последовательность простукивания
  // удаляются (так же, как их нет у записи без учётных данных — чтение это
  // терпит: decryptSecret и decodeKnockSequence возвращают undefined). Опрос и
  // расписания выключаются, чтобы стенд не стучался к устройству с пустым
  // паролем. Адрес, логин и закреплённые отпечатки (TLS, SSH) — не секреты и
  // остаются частью записи об устройстве.
  mikrotiks: {
    fields: ["credentials", "monitoringEnabled", "schedules"],
    masks: ["credentials.password", "credentials.knockSequence"],
    apply(doc) {
      if (isPlain(doc.credentials)) {
        delete doc.credentials.password;
        delete doc.credentials.knockSequence;
      }
      if (doc.monitoringEnabled === true) doc.monitoringEnabled = false;
      for (const kind of ["backup", "export"]) {
        const schedule = doc.schedules?.[kind];
        if (isPlain(schedule) && filled(schedule.frequency) && schedule.frequency !== "off") schedule.frequency = "off";
      }
    },
  },
  // Ключи WireGuard, выпущенные под запрос на изменение. Само приложение по
  // истечении срока снимает их тем же $unset (changeWorker, purgeKeys).
  mikrotikchanges: {
    fields: ["wireguard"],
    masks: ["wireguard.privateKey", "wireguard.presharedKey"],
    apply(doc) {
      if (!isPlain(doc.wireguard)) return;
      delete doc.wireguard.privateKey;
      delete doc.wireguard.presharedKey;
    },
  },
  // Ссылки на согласование отчёта клиентом — вход без пароля
  serviceplanreports: {
    fields: ["accessTokens"],
    masks: ["accessTokens"],
    apply(doc) {
      if (Array.isArray(doc.accessTokens)) doc.accessTokens = [];
    },
  },
  // Сеансы удалённого доступа: ссылки подключения и имя чужого компьютера
  pro32connections: { fields: ["inviteCode", "inviteUrl", "connectUrl", "clientPreviewUrl", "clientName"], masks: ["inviteCode", "inviteUrl", "connectUrl", "clientPreviewUrl", "clientName"], apply: maskRemoteSession },
  getscreenconnections: { fields: ["inviteCode", "inviteUrl", "connectUrl", "clientPreviewUrl", "clientName"], masks: ["inviteCode", "inviteUrl", "connectUrl", "clientPreviewUrl", "clientName"], apply: maskRemoteSession },
  // Диалоги: идентификаторы чатов мессенджеров. Уникальность (канал + чат)
  // сохраняется — новое значение выводится из идентификатора диалога.
  conversations: {
    fields: ["externalChatId", "externalAliases", "title"],
    masks: ["externalChatId", "externalAliases", "title"],
    apply(doc) {
      if ("externalChatId" in doc) doc.externalChatId = `masked-${String(doc._id)}`;
      if (Array.isArray(doc.externalAliases)) doc.externalAliases = [];
      if (filled(doc.title)) doc.title = `Диалог ${hex6(doc._id)}`;
    },
  },
  messages: {
    fields: ["conversationId", "externalChatId", "externalId", "externalIds", "replyToExternalId"],
    masks: ["externalChatId", "externalId", "externalIds", "replyToExternalId"],
    apply(doc) {
      if ("externalChatId" in doc) doc.externalChatId = `masked-${String(doc.conversationId ?? doc._id)}`;
      // Идентификатор сообщения в WhatsApp содержит номер собеседника
      if (filled(doc.externalId)) doc.externalId = `masked-${String(doc._id)}`;
      if (Array.isArray(doc.externalIds)) doc.externalIds = filled(doc.externalId) ? [doc.externalId] : [];
      if (filled(doc.replyToExternalId)) doc.replyToExternalId = null;
    },
  },
  // Площадка клиента в инвентаре: адрес выдаёт компанию (название — как у устройств)
  locations: {
    fields: ["address"],
    masks: ["address"],
    apply(doc) {
      blank(doc, ["address"]);
    },
  },
  // Название организации-владельца установки
  organization: {
    fields: ["name"],
    masks: ["name"],
    apply(doc) {
      if (filled(doc.name)) doc.name = "Организация";
    },
  },
};

function maskRemoteSession(doc) {
  blank(doc, ["inviteCode", "inviteUrl", "connectUrl", "clientPreviewUrl"]);
  if (filled(doc.clientName)) doc.clientName = `ПК ${hex6(doc._id)}`;
}

const mappedCollections = () => [...new Set([...SNAPSHOTS.map((entry) => entry.collection), ...Object.keys(OWN_FIELDS)])];

// Верхние поля документа, которые нужны правилам коллекции
const topFieldsOf = (collection) => {
  const fields = new Set(OWN_FIELDS[collection]?.fields || []);
  for (const entry of SNAPSHOTS) {
    if (entry.collection !== collection) continue;
    const [head] = segmentsOf(entry.path);
    if (head) fields.add(head.replace("[]", ""));
    else fields.add(entry.field).add(entry.idField);
  }
  fields.delete(null);
  return [...fields];
};

/**
 * Правка одного документа по SNAPSHOTS и OWN_FIELDS: `{ $set, $unset }` по
 * верхним полям или null, если менять нечего (так выглядит повторный прогон).
 */
const rewriteDocument = (collection, doc, ctx) => {
  const fields = topFieldsOf(collection);
  if (!fields.length) return null;

  const work = { _id: doc._id };
  for (const field of fields) if (field in doc) work[field] = deepClone(doc[field]);

  for (const entry of SNAPSHOTS) {
    if (entry.collection !== collection) continue;
    visit(work, segmentsOf(entry.path), (node) => REWRITERS[entry.kind](node, entry, ctx));
  }
  OWN_FIELDS[collection]?.apply(work, ctx);

  const update = {};
  for (const field of fields) {
    if (field === "_id") continue;
    if (!(field in work)) {
      if (field in doc) (update.$unset ||= {})[field] = "";
    } else if (!isDeepStrictEqual(work[field], doc[field])) {
      (update.$set ||= {})[field] = work[field];
    }
  }
  return update.$set || update.$unset ? update : null;
};

// --- Что куда относится ---------------------------------------------------------

// Коллекции со снимком всей учётки (вторая — резервная копия от миграции)
const USER_COLLECTIONS = ["users", "users_before_banned"];

// Удаляются целиком. Первая строка — то, что ops/sync-dev-db.sh и так не
// копирует (NEVER_COPIED): живые сеансы, одноразовые токены, ключи агентов. Она
// повторена здесь, чтобы скрипт был безопасен и на копии, сделанной иначе.
const EMPTIED = [
  "authSessions", "authVerifications", "mcpkeys", "mikrotikdownloadcodes", "impersonationCodes", "telegramPairingCodes",
  // Секреты двухфакторной проверки и личности в мессенджерах
  "authTwoFactors", "channelidentities",
];

// Свои коллекции машины разработчика: синхронизация их не копирует (KEEP_LOCAL),
// поэтому и здесь они не правятся и в отчёт не входят
const KEPT_LOCAL = ["preferences", "channels", "channeljobs"];

/**
 * Свободный текст: прежние адреса, телефоны и имена там ожидаемы и не правятся
 * (ops/README.md, «Limit»). Пути сверены со схемами моделей — тест рядом падает,
 * если строкового поля модели нет ни здесь, ни в LABELS, ни среди обезличиваемых.
 * Запись — поле или его начало: "attachments" покрывает всё, что внутри.
 */
const FREE_TEXT = {
  absences: ["comment", "decisionComment"],
  aifeedbacks: ["text"],
  checklisttemplates: ["title", "items[].description"],
  comments: ["content", "quotedText", "attachments"],
  conversations: ["lastMessage.preview"],
  inappnotifications: ["title", "text", "ticketTitle"],
  // secretsScan и serviceExpiry — выписки сканеров из текста самой заметки
  knowledgenotes: ["title", "content", "plainText", "secretsScan", "serviceExpiry"],
  messages: ["text", "form", "attachments", "revisions", "error"],
  // Готовый текст уведомления во всех его видах
  notifications: ["title", "text", "html", "richMessage", "replyMarkup"],
  routinetasks: ["title", "description", "checklist"],
  serviceplanreports: ["parts[].comment", "timeline[].comment"],
  suppliers: ["notes"],
  // attachments — имена файлов и расшифровки звонков (speechToText: текст и
  // подписи говорящих, расставленные распознаванием)
  tickets: ["title", "description", "htmlDescription", "closingComment", "returningComment", "rejected", "customFields", "attachments", "checklist[].description", "aiGuide", "aiTerms"],
  ticketlogs: ["event", "files"],
  tickettemplates: ["title", "description", "customFields", "checklist"],
  users: ["banReason", "workStatus.note"],
  works: ["description"],
};

/**
 * Записи об устройствах, названия и служебные значения — то, что намеренно
 * остаётся как есть и человека или компанию само не называет: инвентарь,
 * Mikrotik, площадки, должности в снимках, названия категорий и услуг,
 * расписания, пояса. "*" — коллекция целиком. Совпадение с прежним именем здесь
 * отчёт показывает отдельной группой и провалом не считает.
 */
const LABELS = {
  clientdevices: ["*"],
  deviceattributes: ["*"],
  deviceconfigurations: ["*"],
  deviceconfigurationrecommendations: ["*"],
  devicemodels: ["*"],
  devicetypes: ["*"],
  devicetypeattributes: ["*"],
  vendors: ["*"],
  mikrotiks: ["*"],
  mikrotikartifacts: ["*"],
  mikrotikchanges: ["*"],
  mikrotikevents: ["*"],
  mikrotikfirmwarestates: ["*"],
  mikrotikoutages: ["*"],
  mikrotiktraffichours: ["*"],
  mikrotikupgradejobs: ["*"],
  routeroscves: ["*"],
  routerosreleases: ["*"],
  productioncalendars: ["*"],
  counters: ["*"],
  inventorycounters: ["*"],
  locations: ["name", "description", "coordinates", "tags", "notes"],
  aifeedbacks: ["category.title"],
  comments: ["channel.network", "channel.status", "channel.error", "notifications"],
  companies: ["users[].position", "users[].role", "responsibles[].position", "responsibles[].role", "clientsSideResponsibles[].position", "clientsSideResponsibles[].role", "workSchedule", "timezone"],
  conversations: ["handled.how", "lastMessage.direction", "lastMessage.origin"],
  inappnotifications: ["link"],
  knowledgenotes: ["categories[].title"],
  messages: ["event.kind"],
  notifications: ["to.messageThreadId", "leaseId"],
  pro32connections: ["clientOs"],
  routinetasks: ["category.title", "cronSchedule", "responsibles[].position", "responsibles[].role", "sourceTemplate.title"],
  serviceplans: ["title", "customProvisionSchedule", "ticketCategories[].title"],
  serviceplanreports: ["snapshot", "invoice.number"],
  subdivisions: ["timezone"],
  tickets: ["applicant.position", "applicant.role", "responsibles[].position", "responsibles[].role"],
  ticketcategories: ["title", "description", "servicePlans[].title"],
  users: ["position", "role", "categories[].title", "timezone", "workSchedules", "workSchedule", "notifications.lastAction"],
  works: ["notifications"],
};

/**
 * То же для полей и коллекций, которых в схемах уже или вовсе нет, а в базе они
 * есть (сверено с живыми документами): прежние имена полей, коллекции
 * better-auth, резервная копия users.
 */
const LEGACY_FREE_TEXT = {
  changelogs: ["title", "body"],
  comments: ["attachements"],
  knowledgenotes: ["domainExpiry"],
  routinetasks: ["checkList"],
  users_before_banned: FREE_TEXT.users,
};
const LEGACY_LABELS = {
  _counters: ["*"],
  migrations: ["*"],
  member: ["*"],
  organizationRole: ["*"],
  organization: ["slug"],
  authAccounts: ["accountId", "providerId"],
  getscreenconnections: ["clientOs"],
  tickets: ["category.title", "category.description", "notifications"],
  tickettemplates: ["category.title", "category.description"],
  users_before_banned: LABELS.users,
  works: ["ticketCategory.title"],
};

const under = (path, prefix) =>
  prefix === "*" || path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[]`);
const listed = (tables, collection, path) =>
  tables.some((table) => (table[collection] || []).some((prefix) => under(path, prefix)));

const SNAPSHOT_LEAVES = {
  person: ["firstName", "lastName", "fullName", "email", "phone", "profileImagePath"],
  company: ["alias", "fullTitle"],
  personByName: ["firstName", "lastName"],
};
const USER_PATHS = Object.values(maskedUser({ _id: "0".repeat(24) })).flatMap(Object.keys);
const COMPANY_PATHS = Object.values(maskedCompany({ _id: "0".repeat(24) })).flatMap(Object.keys);

/**
 * Правит ли скрипт это поле. Путь — как в отчёте: `responsibles[].phone`.
 * Прежнее значение в таком поле — недоработка правила, а не свободный текст.
 */
const isMaskedPath = (collection, path) => {
  if (EMPTIED.includes(collection)) return true;
  if (collection === "authAccounts" && path === "password") return true;
  if (USER_COLLECTIONS.includes(collection) && USER_PATHS.some((prefix) => under(path, prefix))) return true;
  if (collection === "companies" && COMPANY_PATHS.some((prefix) => under(path, prefix))) return true;
  if ((OWN_FIELDS[collection]?.masks || []).some((prefix) => under(path, prefix))) return true;
  return SNAPSHOTS.some((entry) => {
    if (entry.collection !== collection) return false;
    const leaves = SNAPSHOT_LEAVES[entry.kind] || [entry.field];
    // Сам объект снимка тоже считается: в схеме он может быть объявлен как Mixed
    return path === entry.path || leaves.some((leaf) => path === (entry.path ? `${entry.path}.${leaf}` : leaf));
  });
};

/**
 * К чему относится поле, в котором нашлось прежнее значение:
 *   "structured" — поле, которое скрипт правит, либо не описанное нигде: пропуск
 *                  в SNAPSHOTS или OWN_FIELDS, прогон с --report завершается кодом 1
 *   "free"       — свободный текст, ожидаемо
 *   "label"      — запись об устройстве, название или служебное значение
 */
const classifyPath = (collection, path) => {
  if (isMaskedPath(collection, path)) return "structured";
  if (listed([FREE_TEXT, LEGACY_FREE_TEXT], collection, path)) return "free";
  if (listed([LABELS, LEGACY_LABELS], collection, path)) return "label";
  return "structured";
};

// --- Отчёт об остатках ---------------------------------------------------------

const PHONE_IN_TEXT = /\+?\d[\d\s().-]{8,}\d/g;
const digitsOf = (value) => String(value).replace(/\D/g, "");

/**
 * Искатель остатков: по строке говорит, есть ли в ней прежний адрес ("email"),
 * телефон ("phone") или она целиком равна прежнему имени или названию ("name").
 * Имена сверяются только целым значением — так находится забытое поле снимка, а
 * фамилии посреди свободного текста не считаются.
 */
const leakFinder = ({ emails = [], phones = [], names = [] }) => {
  const emailSet = new Set(emails.map(nameKey).filter((email) => email && !email.endsWith("@example.com")));
  const phoneSet = new Set(
    phones
      .map(digitsOf)
      .filter((digits) => digits.length >= 10 && !MASKED_PHONE.test(digits))
      .map((digits) => digits.slice(-10)),
  );
  const nameSet = new Set(
    names
      .map((name) => String(name ?? "").trim())
      .filter((name) => name.length >= 3 && !MASKED_LABEL.test(name) && !MASKED_NAME_EITHER_ORDER.test(name))
      .map(nameKey),
  );

  const find = (value) => {
    const found = [];
    if (value.includes("@") && (value.match(EMAIL_IN_TEXT) || []).some((email) => emailSet.has(email.toLowerCase()))) {
      found.push("email");
    }
    if (
      phoneSet.size &&
      (value.match(PHONE_IN_TEXT) || []).some((run) => {
        const digits = digitsOf(run);
        return digits.length >= 10 && digits.length <= 15 && !MASKED_PHONE.test(digits) && phoneSet.has(digits.slice(-10));
      })
    ) {
      found.push("phone");
    }
    if (value.length <= 200 && nameSet.has(nameKey(value))) found.push("name");
    return found;
  };
  // Сколько прежних значений известно: ноль — база уже обезличена
  find.size = emailSet.size + phoneSet.size + nameSet.size;
  return find;
};

/**
 * Один документ в счётчик остатков: `counts` — Map «коллекция.путь» →
 * { collection, path, kinds: { email, phone, name } }. Массив в пути — `[]`.
 */
const collectLeftovers = (find, collection, doc, counts = new Map()) => {
  const walk = (value, path) => {
    if (typeof value === "string") {
      for (const kind of find(value)) {
        const key = `${collection}.${path}`;
        if (!counts.has(key)) counts.set(key, { collection, path, kinds: {} });
        const { kinds } = counts.get(key);
        kinds[kind] = (kinds[kind] || 0) + 1;
      }
    } else if (Array.isArray(value)) {
      value.forEach((item) => walk(item, `${path}[]`));
    } else if (isPlain(value)) {
      for (const [key, inner] of Object.entries(value)) walk(inner, path ? `${path}.${key}` : key);
    }
  };
  walk(doc, "");
  return counts;
};

// Счётчик остатков → три группы готовых строк «коллекция.путь: сколько (виды)»
const groupLeftovers = (counts) => {
  const groups = { structured: [], free: [], label: [] };
  const entries = [...counts.values()].sort((a, b) => `${a.collection}.${a.path}`.localeCompare(`${b.collection}.${b.path}`));
  for (const entry of entries) {
    const total = Object.values(entry.kinds).reduce((sum, count) => sum + count, 0);
    const kinds = Object.entries(entry.kinds).map(([kind, count]) => `${kind} ${count}`).join(", ");
    groups[classifyPath(entry.collection, entry.path)].push(`${entry.collection}.${entry.path}: ${total} (${kinds})`);
  }
  return groups;
};

module.exports = {
  maskedPerson,
  maskedUser,
  maskedCompany,
  assertSafeTarget,
  phoneOf,
  hex6,
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
  LEGACY_FREE_TEXT,
  LEGACY_LABELS,
  EMPTIED,
  KEPT_LOCAL,
};

// --- Запуск --------------------------------------------------------------------

const BATCH = 500;

const run = async () => {
  require("module-alias/register");
  const mongoose = require("mongoose");
  const withReport = process.argv.includes("--report");
  const targetOnly = process.argv.includes("--target");

  // Окружение проверяется до подключения: на рабочем узле не открываем и его
  if (!targetOnly) assertSafeTarget(process.env, process.env.MONGODB_DATABASE);

  if (process.argv.includes("--preflight")) {
    if (!process.env.DEV_PASSWORD) throw new Error("DEV_PASSWORD не задан: с ним входят все учётки обезличенной копии");
    require("bcryptjs");
    console.log(`Обезличивание возможно: база ${process.env.MONGODB_DATABASE}`);
    return;
  }

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;
  const dbName = db.databaseName;
  if (targetOnly) {
    // Не только имя: ответ сервера подтверждает адрес, учётные данные и доступ
    await db.command({ ping: 1 });
    console.log(`База: ${dbName}`);
    return;
  }
  assertSafeTarget(process.env, dbName);

  const devPassword = process.env.DEV_PASSWORD;
  if (!devPassword) throw new Error("DEV_PASSWORD не задан: с ним входят все учётки обезличенной копии");

  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));
  const summary = [];
  const note = (collection, text) => summary.push(`  ${collection}: ${text}`);

  console.log(`Обезличивание базы ${dbName}…`);

  // Что было до правок: для отчёта и для снимков без ссылки на человека
  const users = await db
    .collection("users")
    .find({}, { projection: { _id: 1, isEndUser: 1, email: 1, phone: 1, firstName: 1, lastName: 1 } })
    .toArray();
  const ctx = buildContext(users);
  if (users.length && users.every((user) => MASKED_EMAIL.test(String(user.email)))) {
    console.log("Учётки уже обезличены. Если прошлый прогон оборвался, снимки без ссылки на человека");
    console.log("(журнал заявок, получатели уведомлений) по имени уже не сопоставить — они станут «Клиент 000000».");
    console.log("Надёжнее повторить синхронизацию из сохранённого архива (ops/sync-dev-db.sh --from-archive).");
  }
  const needles = withReport ? await collectNeedles(db, users, existing) : null;

  // Пакетная запись нативным драйвером: схема Mongoose заново применила бы
  // сеттеры и проверки
  const rewriteCollection = async (name, projection, toUpdate) => {
    const collection = db.collection(name);
    let seen = 0;
    let changed = 0;
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      const result = await collection.bulkWrite(batch, { ordered: false });
      changed += result.modifiedCount;
      batch = [];
    };
    for await (const doc of collection.find({}, { projection })) {
      seen += 1;
      const update = toUpdate(doc);
      if (update) batch.push({ updateOne: { filter: { _id: doc._id }, update } });
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    return { seen, changed };
  };

  // Первым делом — всё, чем можно войти: если прогон оборвётся дальше, рядом с
  // недоправленными данными не останется ни настоящих хешей паролей, ни секретов
  // двухфакторной проверки. У каждой учётки с паролем он становится DEV_PASSWORD;
  // bcrypt-хеш принимает проверка входа (auth/instance.mjs, verifyWithLegacyBcrypt).
  for (const name of EMPTIED) {
    if (!existing.has(name)) continue;
    const { deletedCount } = await db.collection(name).deleteMany({});
    note(name, `удалено ${deletedCount}`);
  }
  if (existing.has("authAccounts")) {
    const accounts = db.collection("authAccounts");
    // Входы через сторонних поставщиков несут их токены и идентификаторы
    const foreign = await accounts.deleteMany({ providerId: { $ne: "credential" } });
    const bcrypt = require("bcryptjs");
    // Повторный прогон: пароль уже общий и подходит — хеш не пересчитываем, иначе
    // новая соль меняла бы документы при каждом запуске
    const current = await accounts.distinct("password", { providerId: "credential" });
    const alreadySet =
      current.length === 1 && typeof current[0] === "string" && current[0].startsWith("$2") && bcrypt.compareSync(devPassword, current[0]);
    const local = alreadySet
      ? { modifiedCount: 0 }
      : await accounts.updateMany({ providerId: "credential" }, { $set: { password: bcrypt.hashSync(devPassword, 10) } });
    note("authAccounts", `пароль заменён у ${local.modifiedCount}, сторонних входов удалено ${foreign.deletedCount}`);
  }

  // Следом учётки: там второй, унаследованный хеш пароля и токены сброса
  for (const name of USER_COLLECTIONS) {
    if (!existing.has(name)) continue;
    const { seen, changed } = await rewriteCollection(name, { _id: 1, isEndUser: 1 }, maskedUser);
    note(name, `учёток ${seen}, изменено ${changed}`);
  }

  if (existing.has("companies")) {
    const { seen, changed } = await rewriteCollection("companies", { _id: 1, phones: 1 }, maskedCompany);
    note("companies", `компаний ${seen}, изменено ${changed}`);
  }

  for (const name of mappedCollections()) {
    if (!existing.has(name)) continue;
    const projection = Object.fromEntries(topFieldsOf(name).map((field) => [field, 1]));
    const { seen, changed } = await rewriteCollection(name, projection, (doc) => rewriteDocument(name, doc, ctx));
    note(name, `снимки и свои поля: документов ${seen}, изменено ${changed}`);
  }

  console.log("Сделано:");
  summary.forEach((line) => console.log(line));

  let structured = 0;
  if (withReport) structured = await printReport(db, existing, needles);

  console.log("");
  console.log("Свободный текст (заявки, комментарии, сообщения, описания работ) и записи об устройствах");
  console.log("не обезличиваются: копия псевдонимизирована, а не анонимна.");
  if (structured) {
    throw new Error(`В ${structured} структурных полях остались прежние данные — дополните SNAPSHOTS или OWN_FIELDS`);
  }
};

// Прежние адреса, телефоны, имена и названия — то, что отчёт будет искать
const collectNeedles = async (db, users, existing) => {
  const emails = [];
  const phones = [];
  const names = [];
  for (const user of users) {
    emails.push(user.email);
    phones.push(user.phone);
    names.push(user.firstName, user.lastName, `${user.lastName} ${user.firstName}`, `${user.firstName} ${user.lastName}`);
  }
  if (existing.has("companies")) {
    const projection = { alias: 1, fullTitle: 1, phones: 1, "users.email": 1, "users.phone": 1, "users.fullName": 1 };
    for (const list of ["responsibles", "clientsSideResponsibles"]) {
      projection[`${list}.email`] = 1;
      projection[`${list}.phone`] = 1;
    }
    for await (const company of db.collection("companies").find({}, { projection })) {
      names.push(company.alias, company.fullTitle);
      phones.push(...(company.phones || []));
      for (const list of ["users", "responsibles", "clientsSideResponsibles"]) {
        for (const person of company[list] || []) {
          emails.push(person?.email);
          phones.push(person?.phone);
          names.push(person?.fullName);
        }
      }
    }
  }
  for (const name of ["subdivisions", "suppliers"]) {
    if (!existing.has(name)) continue;
    for await (const doc of db.collection(name).find({}, { projection: { name: 1, email: 1, phone: 1 } })) {
      names.push(doc.name);
      emails.push(doc.email);
      phones.push(doc.phone);
    }
  }
  const strings = (list) => list.filter((value) => typeof value === "string");
  return { emails: strings(emails), phones: strings(phones), names: strings(names) };
};

// Обход всей базы и три группы: недоработки, свободный текст, названия
const printReport = async (db, existing, needles) => {
  const find = leakFinder(needles);
  const counts = new Map();
  const scanned = [...existing].filter((name) => !name.startsWith("system.") && !KEPT_LOCAL.includes(name)).sort();
  for (const name of scanned) {
    for await (const doc of db.collection(name).find({})) collectLeftovers(find, name, doc, counts);
  }
  const { structured, free, label } = groupLeftovers(counts);
  const print = (title, lines) => {
    console.log(`${title}: ${lines.length}`);
    lines.forEach((line) => console.log(`  ${line}`));
  };

  console.log("");
  console.log(`Отчёт об остатках (коллекций просмотрено: ${scanned.length}; не входят: ${KEPT_LOCAL.join(", ")})`);
  if (!find.size) console.log("Прежних значений не найдено: база уже обезличена, искать нечего (отчёт имеет смысл на первом прогоне)");
  print("Структурные поля — их быть не должно", structured);
  print("Свободный текст — ожидаемо, не правится", free);
  print("Записи об устройствах и названия — оставлены как есть", label);
  return structured.length;
};

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
