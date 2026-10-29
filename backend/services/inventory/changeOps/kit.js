// Общая механика операций пакета: описание полей, разбор параметров агента,
// ссылки между операциями, имена для текста и цели сверки дрейфа. Видам
// операций (catalogKinds, deviceKinds) остаётся только описать поля, позвать
// сервис и собрать строку текста.
//
// Правило проверки (v1): операция, чей параметр ссылается на ещё не созданное
// в пакете, при предложении проверяется только по форме и по существующим
// сущностям — сервис её не проверяет (документа ещё нет). Так же отложена
// операция над существующим устройством, которое меняет более ранняя операция
// пакета (снять деталь с одного ПК и поставить в другой): проверка сервиса
// сейчас видела бы состояние до пакета. Текст такой операции помечен
// «— полная проверка при утверждении»; полная проверка идёт при применении
// (applyPackage проверяет каждую операцию заново), и отказ там даёт partial.
//
// Ошибки сервисов людям — только по-русски и без id: humanError.
//
// Строки текста операции: подстроки (записи каталога, детали своей сборки)
// дают только сами виды — списком строк; каждая строка схлопывается в одну
// (flat), так что перевод строки внутри значения агента или имени из базы
// подстрокой на экране утверждения не станет.
const { hasForbiddenChars } = require("../../mikrotik/changeRender");
const { oneLine } = require("../changeRender");

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const REF_RE = /^[a-z][a-z0-9_]{0,31}$/;
const PENDING = " (будет создано выше)";
const UNCHECKED = " — полная проверка при утверждении";
const GENERIC_ERROR = "Не удалось выполнить операцию";
const HAS_ID = /[0-9a-f]{24}/i;

const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isId = (value) => typeof value === "string" && OBJECT_ID.test(value);
const blank = (value) => value === undefined || value === null || value === "";
// Строка текста операции — в одну строку, без потолка (потолок ставит changeRender)
const flat = (text) => oneLine(text, Infinity);

// Первое место в значении агента (строка, список, объект — вглубь, ключи тоже),
// где есть перевод строки, управляющий, невидимый или bidi-символ: путь вида
// «attributes[0].options[1]» | null.
const forbiddenPath = (value, path) => {
  if (typeof value === "string") return hasForbiddenChars(value) ? path : null;
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const found = forbiddenPath(item, `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (isPlain(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (hasForbiddenChars(key)) return path;
      const found = forbiddenPath(item, `${path}.${key}`);
      if (found) return found;
    }
  }
  return null;
};

// Сущности, на которые ссылаются параметры. model — имя модели Mongoose (для
// загрузки имени и снимка updatedAt), refKind — что из пакета может её заменить
// (null — только существующая), target — входит ли в сверку дрейфа. Пользователь
// и компания не цели: это не инвентарь, их updatedAt меняется по своим поводам,
// а правила (компания пользователя и т. п.) перепроверяются перед записью.
// missing — причина при применении (без имён параметров); hidden — слово после
// имени в отказе для скрытой записи («тип «X» скрыт»); deleted — то же для
// удалённой (deletedAt), если её называют иначе («устройство X удалено»).
const ENTITIES = {
  type: { model: "DeviceType", label: "тип", missing: "тип не найден", hidden: "скрыт", refKind: "type" },
  vendor: { model: "Vendor", label: "вендор", missing: "вендор не найден", hidden: "скрыт", refKind: "vendor" },
  supplier: { model: "Supplier", label: "поставщик", missing: "поставщик не найден", hidden: "скрыт", refKind: "supplier" },
  model: { model: "DeviceModel", label: "модель", missing: "модель не найдена", hidden: "скрыта", refKind: "model", quote: false },
  configuration: {
    model: "DeviceConfiguration",
    label: "конфигурация",
    missing: "конфигурация не найдена",
    hidden: "скрыта",
    refKind: "configuration",
  },
  build: {
    model: "DeviceBuild",
    label: "сборка",
    missing: "сборка не найдена",
    hidden: "скрыта",
    deleted: "удалена",
    refKind: "build",
  },
  device: {
    model: "ClientDevice",
    label: "устройство",
    missing: "устройство не найдено",
    hidden: "скрыто",
    deleted: "удалено",
    refKind: "device",
    quote: false,
  },
  attribute: {
    model: "DeviceAttribute",
    label: "атрибут",
    missing: "атрибут не найден",
    hidden: "скрыт",
    refKind: "attribute",
  },
  group: { model: "AttributeGroup", label: "группа", missing: "группа не найдена", hidden: "скрыта", refKind: null },
  location: { model: "Location", label: "помещение", missing: "помещение не найдено", hidden: "скрыто", refKind: null },
  company: { model: "Company", label: "компания", missing: "компания не найдена", hidden: "скрыта", refKind: null, target: false },
  user: {
    model: "User",
    label: "пользователь",
    missing: "пользователь не найден",
    hidden: "скрыт",
    refKind: null,
    target: false,
    quote: false,
  },
};

// Подписи полей устройства и справочников по-русски: в тексте операций и в
// причинах отказа вместо имён полей сервиса.
const FIELD_LABELS = {
  deviceModelId: "модель",
  deviceTypeId: "тип",
  companyId: "компания",
  locationId: "помещение",
  userId: "пользователь",
  configurationId: "конфигурация",
  buildId: "сборка",
  parentDeviceId: "в составе",
  supplierId: "поставщик",
  status: "статус",
  inventoryNumber: "инвентарный номер",
  serialNumber: "серийный номер",
  hostname: "имя в сети",
  ipAddress: "IP-адрес",
  macAddress: "MAC-адрес",
  operatingSystem: "ОС",
  quantity: "количество",
  purchasedAt: "дата покупки",
  price: "цена",
  purchaseDocument: "документ покупки",
  warrantyExpirationDate: "гарантия до",
  lastMaintenanceDate: "последнее обслуживание",
  deploymentDate: "дата ввода в эксплуатацию",
  nextMaintenanceDate: "следующее обслуживание",
  comment: "комментарий",
  notes: "заметки",
  name: "название",
  inn: "ИНН",
  kpp: "КПП",
  website: "сайт",
  description: "описание",
};

// Описания полей. name — имя у агента, to — имя у сервиса (по умолчанию то же).
// required — ключ обязателен; nullable — null/"" допустимы (снять значение).
// type простого поля — один из TYPES (по умолчанию строка): объекты и массивы
// до запросов (findOne по инвентарному номеру и т. п.) и до текста не доходят.
const field = (name, opts = {}) => ({ name, type: "string", ...opts });
const entity = (name, kind, { label, missing, ...opts } = {}) => ({
  name,
  entity: { target: true, quote: true, ...ENTITIES[kind], ...(label ? { label, missing } : {}) },
  ...opts,
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const isNumber = (value) =>
  (typeof value === "number" && Number.isFinite(value)) ||
  (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));
const isScalar = (value) => typeof value === "string" || typeof value === "boolean" || isNumber(value);

// Тип простого поля -> [проверка, что ожидается]
const TYPES = {
  string: [(value) => typeof value === "string", "строка"],
  number: [isNumber, "число"],
  date: [(value) => typeof value === "string" && DATE_RE.test(value) && !Number.isNaN(Date.parse(value)), "дата (YYYY-MM-DD)"],
  boolean: [(value) => typeof value === "boolean", "да или нет (true/false)"],
  // значение атрибута конфигурации: скаляр или список (multiselect)
  value: [
    (value) => isScalar(value) || (Array.isArray(value) && value.every((item) => typeof item === "string" || isNumber(item))),
    "строка, число или список",
  ],
  // структура каталога: форму разбирает validateCatalog
  array: [Array.isArray, "список"],
  // карта вариантов слияния атрибута: { вариант источника: вариант цели }
  map: [(value) => isPlain(value) && Object.values(value).every((v) => typeof v === "string"), "объект «вариант источника → вариант цели»"],
};

// Параметр-сущность: id или ссылка { ref } / { ref, key }; иначе null.
const parseEntity = (value) => {
  if (isId(value)) return { id: value };
  if (
    isPlain(value) &&
    typeof value.ref === "string" &&
    Object.keys(value).every((key) => key === "ref" || key === "key") &&
    (value.key === undefined || typeof value.key === "string")
  ) {
    return { ref: value.ref, key: value.key };
  }
  return null;
};

// Форма параметров без базы: лишние ключи, обязательные, вид сущностей,
// перечисления, списки. Возвращает строки причин (без «Операция N:»).
const shapeErrors = (fields, params, prefix = "") => {
  if (!isPlain(params)) {
    return [prefix ? `параметр «${prefix.slice(0, -1)}» должен быть объектом` : "параметры должны быть объектом"];
  }
  const errors = [];
  const known = new Set(fields.map((f) => f.name));
  for (const key of Object.keys(params)) {
    // Ключ — текст агента: в одну строку (многострочны только причины, собранные HD)
    if (!known.has(key)) errors.push(`неизвестный параметр «${prefix}${flat(key)}»`);
  }
  for (const f of fields) {
    const value = params[f.name];
    const path = prefix + f.name;
    if (blank(value)) {
      if (f.required && (value === undefined || !f.nullable)) errors.push(`не указан параметр «${path}»`);
      continue;
    }
    if (f.entity) {
      const parsed = parseEntity(value);
      if (!parsed) errors.push(`параметр «${path}» — нужен id (24 hex) или ссылка { ref }`);
      else if (parsed.ref && !f.entity.refKind) errors.push(`параметр «${path}» не принимает ссылку на операцию`);
    } else if (f.ids) {
      if (!(Array.isArray(value) && value.every(isId))) errors.push(`параметр «${path}» — список id (24 hex)`);
    } else if (f.list) {
      if (!Array.isArray(value)) errors.push(`параметр «${path}» должен быть списком`);
      else value.forEach((item, i) => errors.push(...shapeErrors(f.list, item, `${path}[${i}].`)));
    } else if (!TYPES[f.type][0](value)) {
      errors.push(`параметр «${path}» — ${TYPES[f.type][1]}`);
    } else if (forbiddenPath(value, path)) {
      // Перевод строки, управляющие, невидимые и bidi-символы подделывают строки
      // сообщения — в любом значении агента: строке, числе-строке, списке
      // значений конфигурации, структуре каталога (вглубь)
      errors.push(`параметр «${forbiddenPath(value, path)}» содержит недопустимые символы`);
    } else if (f.oneOf && !f.oneOf.includes(value)) {
      errors.push(`неизвестный ${f.oneOfLabel} «${value}»`);
    }
  }
  return errors;
};

// Параметры-сущности (и во вложенных списках) с путём и записью значения —
// запись меняет переданный объект, поэтому разрешение ссылок идёт по копии.
const entities = (fields, params, prefix = "") => {
  const out = [];
  if (!isPlain(params)) return out;
  for (const f of fields) {
    const value = params[f.name];
    if (blank(value)) continue;
    if (f.entity) {
      const parsed = parseEntity(value);
      if (parsed) {
        out.push({
          path: prefix + f.name,
          spec: f.entity,
          allowHidden: Boolean(f.allowHidden),
          parsed,
          set: (id) => {
            params[f.name] = id;
          },
        });
      }
    } else if (f.list && Array.isArray(value)) {
      value.forEach((item, i) => out.push(...entities(f.list, item, `${prefix}${f.name}[${i}].`)));
    }
  }
  return out;
};

// Копия параметров, где все id (сущности, списки id, вложенные списки) — в
// нижнем регистре: isId принимает hex в любом, а сравнения по id — строковые.
// Вызывать после shapeErrors.
const lowerIds = (fields, params) => {
  if (!isPlain(params)) return params;
  const out = { ...params };
  for (const f of fields) {
    const value = out[f.name];
    if (blank(value)) continue;
    if (f.entity) {
      if (isId(value)) out[f.name] = value.toLowerCase();
    } else if (f.ids) {
      if (Array.isArray(value)) out[f.name] = value.map((id) => (isId(id) ? id.toLowerCase() : id));
    } else if (f.list && Array.isArray(value)) {
      out[f.name] = value.map((item) => lowerIds(f.list, item));
    }
  }
  return out;
};

// Имена агента → имена сервиса; отсутствующие ключи не переносим, null — да.
const toArgs = (fields, params) => {
  const args = {};
  for (const f of fields) {
    if (!Object.hasOwn(params, f.name) || params[f.name] === undefined) continue;
    const value = params[f.name];
    args[f.to ?? f.name] = f.list && Array.isArray(value) ? value.map((item) => toArgs(f.list, item)) : value;
  }
  return args;
};

// Английские тексты сервисов (deviceOps, catalogOps, deviceBuild — портал их
// не меняет) -> по-русски, без id; имя в кавычках сохраняется.
const TRANSLATIONS = [
  [/^Vendor with name "(.*)" already exists$/s, (m) => `Вендор «${m[1]}» уже есть`],
  [/^Device model with name "(.*)" already exists$/s, (m) => `Модель «${m[1]}» уже есть`],
  [/^Device model with id .* not found$/s, () => "Модель не найдена"],
  [/^Device with id .* not found$/s, () => "Устройство не найдено"],
  [/^Component .* not found$/s, () => "Комплектующее не найдено"],
  [/^Assigned user must belong to the same company$/, () => "Человек не из компании устройства"],
  [/^Invalid parent device ID$/, () => "Устройство-хост не найдено"],
  [/^Invalid company ID$/, () => "Компания не найдена"],
  [/^Invalid device model ID$/, () => "Модель не найдена"],
  [/^Invalid device type ID$/, () => "Тип устройства не найден"],
  // Имя поля сервиса -> подпись: «Неверное значение поля «deviceTypeId»» и т. п.
  [
    /^(Неверное значение поля|Некорректная дата в поле|Некорректный идентификатор в поле|Поле) «(\w+)»(.*)$/s,
    (m) => `${m[1]} «${FIELD_LABELS[m[2]] ?? m[2]}»${m[3]}`,
  ],
];

/**
 * Ошибка сервиса или исключение -> текст для человека. Известные английские
 * тексты переводятся; 500, исключение и любой оставшийся текст с id — общий
 * «Не удалось выполнить операцию» (оригинал — в журнал). Русские тексты
 * сервисов проходят как есть.
 */
const humanError = ({ message, status, error } = {}, log) => {
  const text = typeof message === "string" ? message : "";
  if (!error && !(status >= 500)) {
    for (const [pattern, translate] of TRANSLATIONS) {
      const match = text.match(pattern);
      if (match) return translate(match);
    }
    if (text && !HAS_ID.test(text)) return text;
  }
  log?.("error", "Inventory change operation failed", {
    message: text || undefined,
    status,
    error: error ? (error.message ?? String(error)) : undefined,
    stack: error?.stack,
  });
  return GENERIC_ERROR;
};

const asIdMap = (map) => Object.fromEntries(Object.entries(map || {}).map(([key, id]) => [key, String(id)]));

/**
 * Вид операции из описания:
 *   right, refKinds, fields;
 *   label(params, key, refKind) — короткое имя создаваемого (для ссылок);
 *   validate?(params) — доп. причины формы;
 *   service: { check(args, ctx), apply(args, ctx) } — вызовы Task 1–3;
 *   created?(result) — { created, catalogIds? } из ответа сервиса;
 *   cascade — check-близнец отдаёт снимок деталей (affected с updatedAt);
 *   expectedParts?(params, ctx) — состав хоста для отложенной операции с
 *     каскадом: [{ id } | { ref, name }] или null (не вывести);
 *   text(t) — строка или список строк (заголовок, затем подстроки) для
 *     человека (может быть async); каждая строка схлопывается в одну.
 *   page?(t) — { head?, fields?, subs?, links? } для страницы портала (может
 *     быть async): свой заголовок, табличка полей [{ label, value, before? }],
 *     subs — вместо подстрок из text, links — к найденным ссылкам (подпись —
 *     ровно как в подстроке: страница находит её там и делает ссылкой);
 *   drift?(args, snapshot) — сверка снимка refs до любой записи пакета (changeExecutor):
 *     текст «изменилось после предложения: …» | null;
 *   dataIds?(params, refs) — id, на которых стоит операция (источник, цель, снимок):
 *     слияния и скрытия идут только по данным базы (правило пакета в changeOps);
 *   mentions?(params, refs) — строки, упоминание которых в параметрах другой операции
 *     пакета задевает эту: id источника и цели (у атрибута — ещё их коды: значения
 *     конфигураций называют атрибут кодом). Без него — id сущностей параметров.
 *
 * check при предложении отдаёт и page — вид операции для страницы портала:
 *   { head, subs, fields, links:[{ model, id, label }], deferred }.
 * head и subs — по умолчанию строки text (двоеточие в конце заголовка со
 * списком снято: список и так ниже); пометка «полная проверка при
 * утверждении» в head не входит — это deferred. links — каждая найденная
 * существующая сущность параметров; label — ровно та строка, которой её
 * показывает текст (в кавычках, если quote), чтобы страница нашла её в head и
 * subs. text для Telegram от page не зависит. При применении page не строится.
 *
 * ctx = { userId, now } и служебные: pending — Map ref → { kind, params, def }
 * (ссылки на ещё не созданное, только при предложении); touched — Set id
 * устройств, которые меняют более ранние операции пакета, и earlier — эти
 * операции { kind, ref, params } по порядку (только при предложении); при
 * применении — applying: true (причины без имён параметров), componentIds
 * (снимок каскада из предложения, с id деталей, созданных пакетом) и snapshot
 * (refs операции из предложения).
 *
 * refs — снимок ссылок, который отдала проверка сервиса при предложении
 * (checked.refs); check передаёт его дальше как есть, хранится в операции.
 * checked.targets — цели сверки дрейфа, которых нет в параметрах (документ
 * связи и т. п.): дописываются к целям параметров.
 *
 * deps: describe, attributeNames?, log?(level, message, meta).
 */
const defineKind = (spec, deps) => {
  const fail = (errors) => ({ ok: false, errors, text: "", targets: [] });

  // Вид для страницы портала (правило — в описании defineKind)
  const pageOf = async (t, head, subs, links, deferred) => {
    const custom = spec.page ? await spec.page(t) : null;
    const fields = (custom?.fields ?? []).map(({ label, value, before }) => ({
      label: flat(label),
      value: flat(value),
      ...(blank(before) ? {} : { before: flat(before) }),
    }));
    const extra = (custom?.links ?? [])
      .map((link) => ({ model: link.model, id: String(link.id), label: flat(link.label) }))
      .filter((link) => !links.some((l) => l.model === link.model && l.id === link.id && l.label === link.label));
    return {
      head: custom?.head !== undefined ? flat(custom.head) : subs.length ? head.replace(/:$/, "") : head,
      subs: custom?.subs ? custom.subs.map(flat) : subs,
      fields,
      links: [...links, ...extra],
      deferred,
    };
  };

  const check = async (params, ctx = {}) => {
    const shape = shapeErrors(spec.fields, params);
    if (!shape.length && spec.validate) shape.push(...spec.validate(params));
    if (shape.length) return fail(shape);

    const errors = [];
    const targets = [];
    const view = {};
    // Ссылки страницы: найденные существующие сущности, подпись — как в тексте
    const links = [];
    let pending = false;
    // Устройство, которое меняет более ранняя операция пакета (правило в шапке)
    let deferred = false;
    for (const { path, spec: e, parsed, allowHidden } of entities(spec.fields, params)) {
      if (parsed.ref) {
        const entry = ctx.pending?.get(parsed.ref);
        if (!entry) {
          errors.push(`ссылка ${parsed.ref} ещё не определена`);
          continue;
        }
        const name = entry.def.label(entry.params, parsed.key, e.refKind);
        view[path] = { name, quote: e.quote, pending: true };
        pending = true;
        continue;
      }
      const found = await deps.describe(e.model, parsed.id);
      if (!found) {
        errors.push(ctx.applying ? e.missing : `не найдено: ${e.label} (параметр «${path}»)`);
        continue;
      }
      // Скрытую запись выбрать нельзя (у update* — можно: так её возвращают)
      if (found.hidden && !allowHidden) {
        const word = found.deleted && e.deleted ? e.deleted : e.hidden;
        errors.push(`${e.label} ${e.quote ? `«${found.name}»` : found.name} ${word}`);
        continue;
      }
      view[path] = { name: found.name, quote: e.quote, pending: false };
      const label = flat(e.quote ? `«${found.name}»` : found.name);
      if (!links.some((link) => link.model === e.model && link.id === parsed.id && link.label === label)) {
        links.push({ model: e.model, id: parsed.id, label });
      }
      if (e.target) targets.push({ model: e.model, id: parsed.id, updatedAt: found.updatedAt });
      if (e.model === "ClientDevice" && ctx.touched?.has(parsed.id)) deferred = true;
    }
    if (errors.length) return fail(errors);

    // Со ссылкой на ещё не созданное или на устройство, которое пакет меняет
    // раньше, сервис сейчас не проверить (правило в шапке)
    const unchecked = pending || deferred;
    const args = toArgs(spec.fields, params);
    const checked = unchecked ? null : await spec.service.check(args, ctx);
    if (checked && !checked.ok) return fail([humanError(checked, deps.log)]);
    // Цели сверки, которые знает только сервис (связь тип↔атрибут и т. п.)
    if (Array.isArray(checked?.targets)) targets.push(...checked.targets);

    // Каскад: детали, которые уйдут вместе с устройством, — по именам, в
    // снимок сверки и в componentIds (применение пойдёт ровно по ним).
    const parts = [];
    let componentIds;
    let componentRefs;
    // Состав каскада определится только при утверждении (хост — ссылка, или
    // состав отложенной операции не вывести)
    let partsUnknown = false;
    if (spec.cascade && checked) {
      componentIds = [];
      for (const part of checked.affected) {
        const id = String(part._id);
        const found = await deps.describe("ClientDevice", id);
        componentIds.push(id);
        parts.push(found?.name ?? "деталь без номера");
        targets.push({ model: "ClientDevice", id, updatedAt: part.updatedAt });
      }
    } else if (spec.cascade && params.withComponents !== false) {
      // Отложенная операция над существующим хостом: состав — по базе и более
      // ранним установкам и снятиям пакета; детали, которые пакет создаёт, —
      // ссылками (componentRefs), их id подставит применение
      const expected = deferred && !pending && spec.expectedParts ? await spec.expectedParts(params, ctx) : null;
      if (expected) {
        componentIds = [];
        componentRefs = [];
        for (const part of expected) {
          if (part.ref) {
            componentRefs.push(part.ref);
            parts.push(part.name);
            continue;
          }
          const found = await deps.describe("ClientDevice", part.id);
          componentIds.push(part.id);
          parts.push(found?.name ?? "деталь без номера");
          // Пропавшую деталь сверка увидит как дрейф, как и снимок сервиса
          targets.push({ model: "ClientDevice", id: part.id, updatedAt: found?.updatedAt ?? null });
        }
      } else {
        partsUnknown = true;
      }
    }

    const show = (path) => {
      const v = view[path];
      if (!v) return "";
      return `${v.quote ? `«${v.name}»` : v.name}${v.pending ? PENDING : ""}`;
    };
    // Пометка — в первую строку: остальные строки операции (детали, записи
    // каталога) показываются подстроками. Переводы строк — только между
    // строками вида: внутри строки любой перевод схлопывается (правило в шапке)
    const t = { params, args, view, show, checked, pending: unchecked, parts, partsUnknown, ctx };
    const out = await spec.text(t);
    const [head, ...rest] = (Array.isArray(out) ? out : [out]).map(flat);
    const text = [head + (unchecked ? UNCHECKED : ""), ...rest].join("\n");
    const page = ctx.applying ? null : await pageOf(t, head, rest, links, unchecked);
    return {
      ok: true,
      errors: [],
      text,
      ...(page ? { page } : {}),
      targets,
      ...(componentIds ? { componentIds } : {}),
      ...(componentRefs?.length ? { componentRefs } : {}),
      ...(checked?.refs ? { refs: checked.refs } : {}),
    };
  };

  const apply = async (params, ctx = {}) => {
    const shape = shapeErrors(spec.fields, params);
    if (shape.length) return { ok: false, error: shape.join("; ") };
    if (entities(spec.fields, params).some(({ parsed }) => parsed.ref)) {
      return { ok: false, error: "не создано на предыдущем шаге" };
    }
    const result = await spec.service.apply(toArgs(spec.fields, params), ctx);
    if (!result.ok) return { ok: false, error: humanError(result, deps.log), ...(result.moved ? { moved: result.moved } : {}) };
    // moved — числа перенесённых ссылок (слияния): в итог операции и хронику
    return { ok: true, ...(spec.created ? spec.created(result) : {}), ...(result.moved ? { moved: result.moved } : {}) };
  };

  return Object.freeze({
    right: spec.right,
    refKinds: spec.refKinds,
    fields: spec.fields,
    label: spec.label ?? (() => ""),
    check,
    apply,
    ...(spec.drift ? { drift: (params, snapshot) => spec.drift(toArgs(spec.fields, params), snapshot) } : {}),
    ...(spec.dataIds ? { dataIds: spec.dataIds } : {}),
    ...(spec.mentions ? { mentions: spec.mentions } : {}),
  });
};

module.exports = {
  FIELD_LABELS,
  REF_RE,
  PENDING,
  UNCHECKED,
  humanError,
  flat,
  forbiddenPath,
  isPlain,
  isId,
  blank,
  field,
  entity,
  parseEntity,
  shapeErrors,
  entities,
  lowerIds,
  toArgs,
  asIdMap,
  defineKind,
};
