// Что портал отдаёт о предложении ИИ-агента по инвентарю. Белый список полей: всё, чего здесь нет (номер,
// ключ MCP, параметры операций, снимки сверки, контакты людей), наружу не уходит, как бы документ ни был загружен.
// Чистый модуль: без моделей и логгера. Подписи созданного разрешает контроллер (createdRefs → Map).
const { STATUS, STATUS_LABELS, isOpen, isFinal } = require("./changeSteps");
const { REF_TABLE, plural } = require("./catalogRefs");

const idOf = (v) => (v && typeof v === "object" && "_id" in v ? String(v._id) : v == null ? "" : String(v));
const nameOf = (u) => (u && typeof u === "object" ? [u.firstName, u.lastName].filter(Boolean).join(" ") : "");
const time = (v) => (v ? new Date(v).getTime() : NaN);
// Строка в одну, как текст операций (changeOps/kit flat)
// eslint-disable-next-line no-control-regex -- разделители \u001c-\u001f и NEL: JS не считает их пробелами
const flat = (text) => String(text ?? "").replace(/[\s\u0085\u001c-\u001f]+/g, " ").trim();

// Человек — только { _id, name }: ни почты, ни телефона, ни Telegram-id
const person = (u) => (u == null || u === "" ? null : { _id: idOf(u), name: nameOf(u) });

// Пометка отложенной проверки в первой строке text (changeOps/kit UNCHECKED)
const UNCHECKED = " — полная проверка при утверждении";

// Ключ result.created операции → модель. Каталог отдаёт карты «ключ каталога → id» (catalogKinds created())
const CREATED_MODELS = {
  device: "ClientDevice",
  model: "DeviceModel",
  configuration: "DeviceConfiguration",
  vendor: "Vendor",
  supplier: "Supplier",
  build: "DeviceBuild",
};
const CATALOG_MODELS = { type: "DeviceType", attribute: "DeviceAttribute", group: "AttributeGroup" };
const CATALOG_LISTS = { type: "types", attribute: "attributes", group: "groups" };

const KIND_LABELS = {
  DeviceType: "тип",
  DeviceAttribute: "атрибут",
  AttributeGroup: "группа",
  Vendor: "вендор",
  Supplier: "поставщик",
  DeviceModel: "модель",
  DeviceConfiguration: "конфигурация",
  DeviceBuild: "сборка",
  ClientDevice: "устройство",
};

// Вид операции: page из предложения, у старых предложений — из text (первая строка — заголовок)
function pageOf(op) {
  if (op.page && typeof op.page === "object") {
    const p = op.page;
    return {
      head: p.head ?? "",
      subs: Array.isArray(p.subs) ? p.subs : [],
      fields: Array.isArray(p.fields) ? p.fields : [],
      links: Array.isArray(p.links) ? p.links : [],
      deferred: p.deferred === true,
    };
  }
  const [first = "", ...subs] = String(op.text ?? "").split("\n");
  const deferred = first.endsWith(UNCHECKED);
  const head = deferred ? first.slice(0, -UNCHECKED.length) : first;
  // Двоеточие перед списком снято, как в page (список и так ниже)
  return { head: subs.length ? head.replace(/:$/, "") : head, subs, fields: [], links: [], deferred };
}

// Строки операции так, как их записала проверка: заголовок и подстроки
const linesOf = (op) => {
  const { head, subs } = pageOf(op);
  return [head, ...subs].map(flat);
};

// Запись каталога «уже есть» — подхвачена, не создана: ids каталога несут и её (catalogSeed.applyCatalog)
const MATCHED_PREFIX = { type: "Тип", attribute: "Атрибут", group: "Группа" };
function catalogMatched(op, refKind, key) {
  const list = op.params?.[CATALOG_LISTS[refKind]];
  const entry = Array.isArray(list) ? list.find((item) => item?.key === key) : null;
  if (!entry?.name) return false;
  const line = `${MATCHED_PREFIX[refKind]} «${flat(entry.name)}» уже есть`;
  return linesOf(op).some((l) => l.startsWith(line));
}

// Созданное одной операцией: [{ model, id }] по порядку
function refsOf(op) {
  const made = op.result?.created;
  if (!made || typeof made !== "object") return [];
  const refs = [];
  for (const [key, model] of Object.entries(CREATED_MODELS)) {
    if (typeof made[key] === "string" && made[key]) refs.push({ model, id: made[key] });
  }
  for (const [refKind, model] of Object.entries(CATALOG_MODELS)) {
    const map = made[refKind];
    if (!map || typeof map !== "object") continue;
    for (const [key, id] of Object.entries(map)) {
      if (typeof id === "string" && id && !catalogMatched(op, refKind, key)) refs.push({ model, id });
    }
  }
  return refs;
}

// Что контроллер разрешает в подписи и адреса: без повторов, по порядку операций
function createdRefs(change) {
  const seen = new Set();
  const out = [];
  for (const op of change.operations || []) {
    for (const ref of refsOf(op)) {
      const k = `${ref.model}:${ref.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(ref);
    }
  }
  return out;
}

// Разрешённое созданное; пропавший документ — пропущен (ссылки нет, итог прежний)
const resolveRefs = (refs, created) =>
  refs.flatMap((ref) => {
    const found = created?.get(`${ref.model}:${ref.id}`);
    if (!found) return [];
    return [{ model: ref.model, id: ref.id, label: found.label, ...(found.to ? { to: found.to } : {}) }];
  });

// Сводка для диалога «Применить?»: что создаст пакет, сколько существующих устройств изменит
// и строки правок, слияний и скрытия справочников (catalog, по порядку операций)
const CREATE_KINDS = {
  createVendor: "vendor",
  createSupplier: "supplier",
  createModel: "model",
  createConfiguration: "configuration",
  createBuild: "build",
};
const CATALOG_NEW = [
  ["group", "Новая группа «"],
  ["type", "Новый тип «"],
  ["attribute", "Новый атрибут «"],
];
const NAMES_MAX = 2;

// Правки, слияния и скрытие справочников: строка диалога на операцию из её
// заголовка (page.head): «Изменить атрибут «A»» → «изменить: атрибут «A»»,
// «Слить модель «A» в «B»» → «слить: модель «A» — переедут 12 устройств, …»,
// «Скрыть атрибут «A» (не используется)» → «скрыть: атрибут «A»»,
// «Удалить пустую группу «A»» → «удалить: группу «A»».
const CATALOG_EDITS = new Set([
  "updateVendor",
  "updateSupplier",
  "updateModel",
  "updateDeviceType",
  "updateGroup",
  "updateAttribute",
  "updateTypeAttribute",
  "unlinkAttribute",
  "updateConfiguration",
  "updateBuild",
]);
const isMerge = (kind) => /^merge[A-Z]/.test(kind);
const isRetire = (kind) => /^retire[A-Z]/.test(kind) || kind === "deleteGroup";

// Живые ссылки слияния по видам: «12 устройств, 3 конфигурации, 1 сборка» — из
// строк чисел страницы (page.fields слияния: { label: countLabel, value: «12 и 1
// удалённое» }). Там уже учтено, что не переезжает (skip правил catalogMerge), —
// своих правил здесь нет. Совместимость (особая строка) не переезжает; одинаковые
// виды складываются
function movingOf(op) {
  const table = REF_TABLE[op.refs?.entity];
  if (!table) return [];
  const counts = new Map();
  for (const field of pageOf(op).fields ?? []) {
    const meta = table.find((t) => t.countLabel === field?.label);
    if (!meta || meta.line) continue;
    const n = Number.parseInt(String(field.value), 10);
    if (!(n > 0)) continue;
    const was = counts.get(meta.countLabel);
    counts.set(meta.countLabel, { noun: meta.noun, n: (was?.n ?? 0) + n });
  }
  return [...counts.values()].map(({ noun, n }) => ({ n, text: `${n} ${plural(n, ...noun)}` }));
}

function catalogLine(op) {
  const head = flat(pageOf(op).head);
  const at = head.indexOf(" ");
  if (at < 0) return null;
  const verb = head.slice(0, at).toLowerCase();
  let what = head.slice(at + 1);
  if (isMerge(op.kind)) {
    // Цель не называем: «Слить модель «A» в «B»» → «модель «A»» (до первого «» в «»)
    const cut = what.indexOf("» в «");
    if (cut >= 0) what = what.slice(0, cut + 1);
    const moving = movingOf(op);
    if (!moving.length) return `${verb}: ${what}`;
    // «переедет 1 сборка», «переедут 12 устройств, 3 конфигурации»
    const one = moving.length === 1 && plural(moving[0].n, "one", "few", "many") === "one";
    return `${verb}: ${what} — ${one ? "переедет" : "переедут"} ${moving.map((m) => m.text).join(", ")}`;
  }
  if (op.kind === "deleteGroup") what = what.replace(/^пустую /, "");
  else if (isRetire(op.kind)) what = what.replace(/ \(не используется\)$/, "");
  return `${verb}: ${what}`;
}

function summaryOf(operations) {
  const create = { type: 0, attribute: 0, group: 0, vendor: 0, supplier: 0, model: 0, configuration: 0, build: 0, device: 0 };
  const changed = new Map();
  const catalog = [];
  for (const op of operations) {
    if (CATALOG_EDITS.has(op.kind) || isMerge(op.kind) || isRetire(op.kind)) {
      const line = catalogLine(op);
      if (line) catalog.push(line);
      continue;
    }
    if (op.kind === "catalog") {
      // Новое каталога — по строкам проверки: «уже есть» не считается
      for (const line of linesOf(op)) {
        const hit = CATALOG_NEW.find(([, prefix]) => line.startsWith(prefix));
        if (hit) create[hit[0]] += 1;
      }
      continue;
    }
    if (op.kind === "createDevice") {
      // Детали своей сборки — тоже новые устройства
      create.device += 1 + (Array.isArray(op.params?.parts) ? op.params.parts.length : 0);
      continue;
    }
    if (CREATE_KINDS[op.kind]) {
      create[CREATE_KINDS[op.kind]] += 1;
      continue;
    }
    const labels = new Map(
      pageOf(op).links.filter((l) => l?.model === "ClientDevice").map((l) => [String(l.id).toLowerCase(), l.label]),
    );
    for (const t of op.targets || []) {
      if (t?.model !== "ClientDevice" || t.id == null) continue;
      const id = String(t.id).toLowerCase();
      // Подпись — из первой операции, где устройство есть среди ссылок
      if (!changed.get(id)) changed.set(id, labels.get(id) ?? null);
    }
  }
  const count = changed.size;
  const names = [...changed.values()];
  // Имена — когда устройств немного и подпись есть у каждого (у старых предложений ссылок нет)
  const withNames = count > 0 && count <= NAMES_MAX && names.every((n) => typeof n === "string" && n);
  return { create, change: withNames ? { count, names } : { count }, ...(catalog.length ? { catalog } : {}) };
}

// Закрыто: отклонённое — по решению; итоговые статусы — по последней записи хроники; открытое и применяемое — null
function closedAt(change) {
  if (change.status === STATUS.rejected) return change.decision?.at ?? null;
  if (!isFinal(change.status)) return null;
  const last = (change.timeline || []).at(-1);
  return last?.at ?? null;
}

const isStuck = (change) => change.stuck === true && change.status === STATUS.failed;

// Смотреть: заявитель или сотрудник с правом менять технику или справочники (Global Constraints)
function canView(change, viewer) {
  return idOf(change.requestedBy) === String(viewer.userId) || Boolean(viewer.canManageDevices) || Boolean(viewer.canManageCatalog);
}

function toView(change, viewer, now = new Date(), { created } = {}) {
  const me = String(viewer.userId);
  const operations = change.operations || [];
  // Без срока или с битой датой — истёкшее, как в сервисе решений
  const open = isOpen(change.status) && now.getTime() < time(change.expiresAt);
  const d = change.decision;

  return {
    _id: idOf(change),
    title: change.title,
    reason: change.reason,
    status: change.status,
    statusLabel: STATUS_LABELS[change.status] || change.status,
    stuck: isStuck(change),
    createdAt: change.createdAt,
    expiresAt: change.expiresAt,
    closedAt: closedAt(change),
    requestedBy: person(change.requestedBy),
    agentName: change.requestedVia?.keyName || "",
    decision: d?.decision ? { decision: d.decision, channel: d.channel, comment: d.comment, at: d.at } : null,
    operations: operations.map((op, index) => {
      const { head, subs, fields, links, deferred } = pageOf(op);
      return {
        index,
        head,
        subs,
        fields,
        links,
        deferred,
        result: {
          state: op.result?.state || "pending",
          error: op.result?.error,
          created: resolveRefs(refsOf(op), created),
        },
      };
    }),
    created: resolveRefs(createdRefs(change), created).map((item) => {
      const { to, ...rest } = item;
      return { ...rest, kindLabel: KIND_LABELS[item.model], ...(to ? { to } : {}) };
    }),
    summary: summaryOf(operations),
    timeline: (change.timeline || []).map((t) => ({ at: t.at, text: t.text })),
    my: { canDecide: open && idOf(change.requestedBy) === me },
  };
}

module.exports = { toView, canView, createdRefs, isStuck, KIND_LABELS };
