const { maskText } = require("./maskText");
const { oneLine } = require("./ticketFormat");
const { iso } = require("./text");
const { deviceTypeId } = require("./inventorySource");
const { formatSpecValue, liveAssembly, keySpecsLine } = require("../inventory/assemblyKeySpecs");

/**
 * Текст инвентаря для ИИ-агента: чистые функции над плоскими lean-объектами
 * inventorySource.js (id «как хранятся», без populate). Сюда не попадают
 * контакты людей, licenseKey и сырые free-text поля: заметки идут через maskText.
 */

const OTHER = "Прочее";
const MAX_LOCATION_DEPTH = 6;
const DAY = 24 * 60 * 60 * 1000;

const idStr = (v) => (v === undefined || v === null ? "" : String(v._id ?? v));
const day = (value) => (value ? iso(value).slice(0, 10) : "—");
const safe = (text) => oneLine(maskText(String(text ?? "")));
const collator = new Intl.Collator("ru");

// Свободный текст карточки: потолок как у комментариев заявок (MAX_COMMENT = 4000),
// каждая строка с «> » — чужой текст не должен выглядеть разделом ответа.
const MAX_NOTE = 4_000;
const MAX_SOFTWARE = 50;
const quoted = (text) => {
  const masked = maskText(String(text ?? "")).trim();
  const cut = masked.length <= MAX_NOTE ? masked : `${masked.slice(0, MAX_NOTE)}\n[…truncated: ${masked.length - MAX_NOTE} more characters — open the link]`;
  return cut.split("\n").map((line) => `> ${line}`).join("\n");
};

// ─── Индекс каталога ─────────────────────────────────────────────────────

/**
 * Карты для быстрых склеек. `builds` — необязательный 4-й аргумент
 * (шаблоны сборок из loadBuilds); без него имя шаблона неизвестно.
 */
const buildCatalogIndex = (catalog, models = [], configs = [], builds = []) => {
  const byId = (items) => new Map(items.map((i) => [idStr(i), i]));
  const attributes = byId(catalog.attributes ?? []);
  const attrsByType = new Map();
  (catalog.links ?? []).forEach((link, position) => {
    const attr = attributes.get(idStr(link.attributeId));
    if (!attr) return;
    const typeId = idStr(link.deviceTypeId);
    if (!attrsByType.has(typeId)) attrsByType.set(typeId, []);
    attrsByType.get(typeId).push({
      attr,
      required: Boolean(link.required),
      order: link.order ?? 0,
      groupId: link.groupId ? idStr(link.groupId) : null,
      position,
    });
  });
  for (const list of attrsByType.values()) list.sort((a, b) => a.order - b.order || a.position - b.position);

  const configsByModel = new Map();
  for (const c of configs) {
    const key = idStr(c.deviceModelId);
    if (!configsByModel.has(key)) configsByModel.set(key, []);
    configsByModel.get(key).push(c);
  }
  return {
    types: byId(catalog.types ?? []),
    attributes,
    vendors: byId(catalog.vendors ?? []),
    suppliers: byId(catalog.suppliers ?? []),
    groups: byId(catalog.groups ?? []),
    models: byId(models),
    configs: byId(configs),
    configsByModel,
    builds: byId(builds),
    attrsByType,
  };
};

// ─── Ссылки и названия ───────────────────────────────────────────────────

const deviceLink = (baseUrl, id) => `${String(baseUrl || "").replace(/\/+$/, "")}/inventory/client-devices/${id}`;
const deviceLinkPattern = (baseUrl) => `device link: ${deviceLink(baseUrl, "<id>")}`;

const typeName = (typeId, idx) => idx.types.get(String(typeId ?? ""))?.name;

const deviceTitle = (device, idx) => {
  const model = device.deviceModelId ? idx.models.get(idStr(device.deviceModelId)) : null;
  if (model) return [idx.vendors.get(idStr(model.vendorId))?.name, model.name].filter(Boolean).join(" ");
  const type = typeName(deviceTypeId(device, idx.models), idx);
  return type ? `${type} (no model)` : "unknown device";
};

// ─── Характеристики ──────────────────────────────────────────────────────

/**
 * Группы характеристик по значениям конфигурации.
 * Зеркало spec-sheet.ts#buildSpecGroups, держать в ногу: группы по
 * AttributeGroup.order (затем по имени), строки по order связки; связка без
 * группы и значения атрибутов, снятых с типа, — в «Прочее»; пустое пропускаем.
 * Да/Нет без значения — «нет», если характеристики вообще заполнены: форма
 * показывает невключённый тумблер как «Нет» и ничего не сохраняет.
 */
const buildSpecGroups = (typeId, values, idx) => {
  const valueOf = new Map(values.map((v) => [idStr(v.attributeId), v.value]));
  const filled = values.some((v) => formatSpecValue(idx.attributes.get(idStr(v.attributeId)), v.value) !== "");
  const links = idx.attrsByType.get(typeId) ?? [];
  const linked = new Set(links.map((l) => idStr(l.attr)));
  const buckets = new Map(); // groupKey -> {name, order, lines}
  const put = (key, name, order, line) => {
    if (!buckets.has(key)) buckets.set(key, { name, order, lines: [] });
    buckets.get(key).lines.push(line);
  };
  for (const link of links) {
    const raw = formatSpecValue(link.attr, valueOf.get(idStr(link.attr)));
    const text = raw || (filled && link.attr?.valueType === "boolean" ? "нет" : "");
    if (!text) continue;
    const line = `${link.attr.name} (${link.attr.code}): ${text}`;
    const group = link.groupId ? idx.groups.get(link.groupId) : null;
    if (group) put(idStr(group), group.name, group.order ?? 0, line);
    else put("other", OTHER, Infinity, line);
  }
  for (const [attrId, raw] of valueOf) {
    if (linked.has(attrId)) continue;
    const attr = idx.attributes.get(attrId);
    const text = formatSpecValue(attr, raw);
    if (!text) continue;
    put("other", OTHER, Infinity, attr ? `${attr.name} (${attr.code}): ${text}` : `${attrId}: ${text}`);
  }
  return [...buckets.values()]
    .sort((a, b) => (a.order === b.order ? collator.compare(a.name, b.name) : a.order - b.order))
    .map(({ name, lines }) => ({ name, lines }));
};

/** Характеристики устройства: своя конфигурация, единственная у модели, иначе нет/неоднозначно. */
const specsOf = (device, idx) => {
  const typeId = deviceTypeId(device, idx.models);
  const none = { source: "none", groups: [] };
  if (!typeId) return none;
  if (device.configurationId) {
    const config = idx.configs.get(idStr(device.configurationId));
    return config
      ? { source: "configuration", groups: buildSpecGroups(typeId, config.values ?? [], idx) }
      : { source: "configuration-deleted", groups: [] };
  }
  const modelId = idStr(device.deviceModelId);
  if (!modelId) return none;
  const own = idx.configsByModel.get(modelId) ?? [];
  if (own.length === 1) return { source: "model-only-configuration", groups: buildSpecGroups(typeId, own[0].values ?? [], idx) };
  if (own.length > 1) {
    return { source: "ambiguous", groups: [], configurations: own.map((c) => ({ _id: idStr(c), name: c.name })) };
  }
  return none;
};

// ─── Сборка ──────────────────────────────────────────────────────────────

// Деталь в форме, которую ждёт assemblyKeySpecs (как toAssemblyPart после populate).
const toPart = (component, idx) => {
  const typeId = deviceTypeId(component, idx.models);
  const type = typeId ? idx.types.get(typeId) : null;
  const model = component.deviceModelId ? idx.models.get(idStr(component.deviceModelId)) : null;
  const config = component.configurationId ? idx.configs.get(idStr(component.configurationId)) : null;
  return {
    typeId: type ? { _id: idStr(type), name: type.name } : null,
    deviceModelId: model ? { ...model, vendorId: idx.vendors.get(idStr(model.vendorId)) ?? null } : null,
    configurationId: config
      ? { values: (config.values ?? []).map((v) => ({ ...v, attributeId: idx.attributes.get(idStr(v.attributeId)) ?? v.attributeId })) }
      : null,
    quantity: component.quantity,
  };
};

const quantityOf = (c) => (c.quantity > 1 ? ` ×${c.quantity}` : "");

/** Своя сборка (без модели, тип с assembly.enabled); иначе null. */
const assemblyOf = (device, components, idx) => {
  if (device.deviceModelId || !device.deviceTypeId) return null;
  const type = idx.types.get(idStr(device.deviceTypeId));
  if (!type?.assembly?.enabled) return null;

  const assembly = liveAssembly(type.assembly);
  const named = (typeId) => {
    const t = idx.types.get(idStr(typeId));
    return t ? { _id: idStr(t), name: t.name } : null;
  };
  // Типы, которых уже нет в каталоге, выпадают так же, как удалённые (typeId: null)
  const slots = assembly.slots.filter((s) => named(s.typeId));
  const keySpecs = assembly.keySpecs
    .filter((s) => named(s.typeId))
    .map((s) => ({ ...s, typeId: named(s.typeId), attributeId: s.attributeId ? (idx.attributes.get(idStr(s.attributeId)) ?? null) : null }));

  const live = components.filter((c) => !c.deletedAt);
  const parts = live.map((c) => toPart(c, idx));
  const buildId = device.buildId ? idStr(device.buildId) : null;
  return {
    keySpecs: keySpecsLine({ keySpecs, slots }, parts),
    build: buildId ? { _id: buildId, name: idx.builds.get(buildId)?.name ?? null } : null,
    slots: slots.map((slot) => {
      const mine = live.filter((c) => deviceTypeId(c, idx.models) === idStr(slot.typeId));
      return {
        type: typeName(idStr(slot.typeId), idx),
        required: Boolean(slot.required),
        multiple: Boolean(slot.multiple),
        parts: mine.map((c) => `${deviceTitle(c, idx)}${quantityOf(c)}`),
        missing: Boolean(slot.required) && mine.length === 0,
      };
    }),
  };
};

// ─── Справочник (компании, люди, места) ──────────────────────────────────

const dirMaps = new WeakMap();
const lookups = (dir) => {
  if (!dirMaps.has(dir)) {
    const byId = (items) => new Map((items ?? []).map((i) => [idStr(i), i]));
    dirMaps.set(dir, { companies: byId(dir.companies), users: byId(dir.users), locations: byId(dir.locations) });
  }
  return dirMaps.get(dir);
};

const companyName = (id, dir) => (id ? (lookups(dir).companies.get(idStr(id))?.alias ?? "unknown company") : "—");
// Только имя: ни контактов, ни должности
const personName = (id, dir) => {
  if (!id) return "—";
  const user = lookups(dir).users.get(idStr(id));
  return user ? ([user.lastName, user.firstName].filter(Boolean).join(" ") || "—") : "unknown person";
};
const locationPath = (id, dir) => {
  const { locations } = lookups(dir);
  const names = [];
  for (let key = id ? idStr(id) : "", depth = 0; key && depth < MAX_LOCATION_DEPTH; depth += 1) {
    const loc = locations.get(key);
    if (!loc) break;
    names.unshift(loc.name);
    key = loc.parent ? idStr(loc.parent) : "";
  }
  return names.join(" › ");
};
const locationName = (id, dir) => (id ? (lookups(dir).locations.get(idStr(id))?.name ?? "unknown location") : "—");

// ─── Строка и карточка ───────────────────────────────────────────────────

const formatDeviceRow = (device, idx, dir) =>
  [
    deviceTitle(device, idx),
    `inv ${device.inventoryNumber || "—"}`,
    `S/N ${device.serialNumber || "—"}`,
    ...(device.hostname ? [`host ${device.hostname}`] : []),
    device.status || "—",
    companyName(device.companyId, dir),
    personName(device.userId, dir),
    locationName(device.locationId, dir),
    `id: ${device._id}`,
  ]
    .map(oneLine)
    .join(" · ");

const specLines = (specs, indent = "") => {
  if (specs.source === "ambiguous") {
    return [
      `${indent}no configuration chosen; the model has ${specs.configurations.length}: ${specs.configurations.map((c) => c.name).join(", ")}`,
    ];
  }
  if (specs.source === "configuration-deleted") return [`${indent}(none: the configuration chosen for this device was deleted)`];
  if (!specs.groups.length) return [`${indent}(none)`];
  return specs.groups.flatMap((g) => [`${indent}${g.name}:`, ...g.lines.map((l) => `${indent}- ${l}`)]);
};

const warrantyLine = (date, now) => {
  if (!date) return null;
  const diff = Math.round((new Date(date).getTime() - new Date(now).getTime()) / DAY);
  const state = diff >= 0 ? `${diff} days left` : `expired ${-diff} days ago`;
  return `warranty until ${day(date)} (${state})`;
};

/** Конец срока службы: срок считается от покупки, без неё — от ввода в эксплуатацию. Null без даты или срока. */
const lifespanEnd = (d) => {
  const start = d.purchasedAt ?? d.deploymentDate;
  const months = Number(d.expectedLifespan);
  if (!start || Number.isNaN(new Date(start).getTime()) || !(months > 0)) return null;
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + months);
  return end;
};

// Оценка связи заявок с устройством — одна формулировка на карточку и находки
const TICKET_ESTIMATE = "estimate: by the person the device is assigned to";

const lifecycleLines = (d, idx, now) => {
  const lines = [];
  if (d.purchasedAt || d.price !== undefined) {
    lines.push(`purchase: ${day(d.purchasedAt)}${d.price !== undefined && d.price !== null ? `, price ${d.price}` : ""}`);
  }
  if (d.supplierId) lines.push(`supplier: ${idx.suppliers.get(idStr(d.supplierId))?.name ?? "unknown supplier"}`);
  const warranty = warrantyLine(d.warrantyExpirationDate, now);
  if (warranty) lines.push(warranty);
  if (d.deploymentDate) lines.push(`deployed: ${day(d.deploymentDate)}`);
  const end = lifespanEnd(d);
  if (end) lines.push(`lifespan ends: ${day(end)} (${d.expectedLifespan} months)`);
  if (d.retirementDate) lines.push(`retired: ${day(d.retirementDate)}`);
  if (d.lastMaintenanceDate || d.nextMaintenanceDate) {
    const interval = d.maintenanceInterval ? `, every ${d.maintenanceInterval} days` : "";
    lines.push(`maintenance: last ${day(d.lastMaintenanceDate)}, next ${day(d.nextMaintenanceDate)}${interval}`);
  }
  return lines;
};

const headerLines = (d, idx, dir, ctx) => [
  `# ${oneLine(deviceTitle(d, idx))}`,
  `type: ${typeName(deviceTypeId(d, idx.models), idx) ?? "—"}; status: ${d.status || "—"}; inv: ${d.inventoryNumber || "—"}; S/N: ${d.serialNumber || "—"}`,
  `company: ${companyName(d.companyId, dir)}; person: ${personName(d.userId, dir)}`,
  ...(d.hostname || d.ipAddress || d.operatingSystem
    ? [[d.hostname && `host: ${d.hostname}`, d.ipAddress && `IP: ${d.ipAddress}`, d.operatingSystem && `OS: ${d.operatingSystem}`].filter(Boolean).map(safe).join(" · ")]
    : []),
  `link: ${deviceLink(ctx.baseUrl, d._id)}`,
];

const componentLines = (components, idx) =>
  components.flatMap((c) => [
    `- ${oneLine(deviceTitle(c, idx))}${quantityOf(c)} (${typeName(deviceTypeId(c, idx.models), idx) ?? "unknown type"}); inv ${c.inventoryNumber || "—"}; S/N ${c.serialNumber || "—"}; ${c.status || "—"}`,
    ...specLines(specsOf(c, idx), "    "),
  ]);

const ticketLines = (tickets, total, ctx) => {
  const lines = tickets.map(
    (t) => `- #${t.num} · ${safe(t.title)} · ${t.isClosed ? "closed" : "open"} · ${day(t.createdAt)} · ${String(ctx.baseUrl || "").replace(/\/+$/, "")}/tickets/${t.num}`,
  );
  if (total > tickets.length) lines.push(`Showing ${tickets.length} of ${total}.`);
  return lines.length ? lines : ["(none)"];
};

const formatDeviceDetail = ({ device, components = [], parent = null, tickets = [], ticketsTotal = 0 }, idx, dir, ctx) => {
  const liveComponents = components.filter((c) => !c.deletedAt);
  const out = [...headerLines(device, idx, dir, ctx), "", "## Specs", ...specLines(specsOf(device, idx))];

  const assembly = assemblyOf(device, liveComponents, idx);
  if (assembly) {
    out.push("", "## Assembly", `key specs: ${assembly.keySpecs || "—"}`);
    if (assembly.build) out.push(`build template: ${assembly.build.name ?? "unknown template"}`);
    for (const slot of assembly.slots) {
      const flags = `${slot.required ? "required" : "optional"}${slot.multiple ? ", multiple" : ""}`;
      out.push(`- ${slot.type} (${flags}): ${slot.parts.length ? slot.parts.join("; ") : `— empty${slot.required ? " (required)" : ""}`}`);
    }
  }

  if (liveComponents.length) out.push("", "## Components", ...componentLines(liveComponents, idx));

  if (parent) {
    out.push("", "## Part of", `${oneLine(deviceTitle(parent, idx))}; inv ${parent.inventoryNumber || "—"}; ${deviceLink(ctx.baseUrl, parent._id)}`);
  }

  const where = locationPath(device.locationId ?? parent?.locationId, dir);
  out.push("", "## Where", where || "—");

  const lifecycle = lifecycleLines(device, idx, ctx.now);
  out.push("", "## Lifecycle", ...(lifecycle.length ? lifecycle : ["—"]));

  if (device.installedSoftware?.length) {
    const software = device.installedSoftware;
    out.push("", "## Software", ...software.slice(0, MAX_SOFTWARE).map((s) => `- ${safe([s.name, s.version].filter(Boolean).join(" "))}`));
    if (software.length > MAX_SOFTWARE) out.push(`Showing ${MAX_SOFTWARE} of ${software.length}.`);
  }

  const notes = [
    ["comment", device.comment],
    ["notes", device.notes],
    ["purchase document", device.purchaseDocument],
  ].filter(([, text]) => text);
  if (notes.length) out.push("", "## Notes", ...notes.flatMap(([label, text]) => [`${label}:`, quoted(text)]));

  out.push("", `## Tickets (${TICKET_ESTIMATE})`, ...ticketLines(tickets, ticketsTotal, ctx));
  return out.join("\n");
};

module.exports = {
  buildCatalogIndex,
  lifespanEnd,
  TICKET_ESTIMATE,
  deviceLink,
  deviceLinkPattern,
  deviceTitle,
  specsOf,
  assemblyOf,
  formatDeviceRow,
  formatDeviceDetail,
};
