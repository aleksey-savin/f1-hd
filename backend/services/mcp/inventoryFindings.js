const { isValidValue } = require("../inventory/attributeValue");
const { parseMultiValue } = require("../inventory/assemblyKeySpecs");
const { assemblyOf, deviceTitle, lifespanEnd: lifespanEndDate, TICKET_ESTIMATE } = require("./inventoryFormat");

/**
 * Находки по парку для ИИ-агента: чистые проверки над уже загруженными данными
 * (inventoryTools#findings грузит их и выбирает нужные виды).
 * check(data, {now, days, limit}) -> {count, items: [{id, kind, line}], note?}:
 * count — сколько найдено всего, items — первые `limit`. Строка называет предмет
 * (устройство, модель, тип, атрибут, вендор, поставщик, группа, конфигурация)
 * и несёт id в конце для следующих запросов.
 * data: {rows, catalogIdx, models, configs, links, builds, components, tickets, systemUserIds}.
 */

const DAY = 86400000;
const FREE_STATUSES = ["readyForDeployment", "inReserve"];
const RETIRED_STATUSES = ["decommissioned", "disposed"];

const idStr = (v) => (v === undefined || v === null ? "" : String(v._id ?? v));
const isRetired = (row) => RETIRED_STATUSES.includes(row.status);
const asTime = (value) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(time) ? null : time;
};
const dateText = (value) => new Date(value).toISOString().slice(0, 10);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const collator = new Intl.Collator("ru");

// ─── Нормализация значений (проверка значения — inventory/attributeValue) ────────────────────────────────────

const LOOKALIKES = { a: "а", e: "е", o: "о", p: "р", c: "с", x: "х", y: "у", k: "к", m: "м", t: "т", h: "н", b: "в" };

/** Ключ для поиска дублей: регистр, ё, латинские двойники кириллицы, без знаков и пробелов. */
const dupKey = (name) =>
  String(name ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[aeopcxykmthb]/g, (ch) => LOOKALIKES[ch])
    .replace(/[^\p{L}\p{N}]/gu, "");

// ─── Помощники строк ─────────────────────────────────────────────────────

const deviceName = (row, idx) => {
  const inv = row.inventoryNumber ? ` (inv ${row.inventoryNumber})` : "";
  return `${deviceTitle(row, idx)}${inv}`;
};
const modelName = (model, idx) =>
  model ? [idx.vendors.get(idStr(model.vendorId))?.name, model.name].filter(Boolean).join(" ") : "(deleted model)";
const attrName = (attr) => `${attr.name} (${attr.code})`;
const typeNameOf = (id, idx) => idx.types.get(idStr(id))?.name ?? "(deleted type)";

const result = (all, { limit = 20 }, note) => {
  const out = { count: all.length, items: all.slice(0, limit) };
  if (note) out.note = note;
  return out;
};

// Устройство + что с ним не так; сортируем по ключу (дата — старое первым)
const deviceFindings = (rows, data, test, describe, sortKey) =>
  rows
    .filter(test)
    .map((row) => ({ row, key: sortKey ? sortKey(row) : 0 }))
    .sort((a, b) => a.key - b.key)
    .map(({ row }) => ({ id: idStr(row), kind: "device", line: `${deviceName(row, data.catalogIdx)}: ${describe(row)} · ${idStr(row)}` }));

// ─── Проверки устройств ──────────────────────────────────────────────────

const warrantyExpiring = (data, { now, days = 60, limit }) => {
  const from = now.getTime();
  const to = from + days * DAY;
  const time = (r) => asTime(r.warrantyExpirationDate);
  return result(
    deviceFindings(data.rows, data, (r) => time(r) !== null && time(r) >= from && time(r) <= to && !isRetired(r), (r) => `warranty ends ${dateText(r.warrantyExpirationDate)}`, time),
    { limit },
  );
};

const warrantyExpired = (data, { now, limit }) => {
  const time = (r) => asTime(r.warrantyExpirationDate);
  return result(
    deviceFindings(data.rows, data, (r) => time(r) !== null && time(r) < now.getTime() && !isRetired(r), (r) => `warranty ended ${dateText(r.warrantyExpirationDate)}`, time),
    { limit },
  );
};

const lifespanEnd = (row) => lifespanEndDate(row)?.getTime() ?? null;

const lifespanExceeded = (data, { now, limit }) =>
  result(
    deviceFindings(
      data.rows,
      data,
      (r) => !isRetired(r) && lifespanEnd(r) !== null && lifespanEnd(r) < now.getTime(),
      (r) => `expected lifespan of ${r.expectedLifespan} months ended ${dateText(lifespanEnd(r))}`,
      lifespanEnd,
    ),
    { limit },
  );

const maintenanceOverdue = (data, { now, limit }) => {
  const time = (r) => asTime(r.nextMaintenanceDate);
  return result(
    deviceFindings(data.rows, data, (r) => !isRetired(r) && time(r) !== null && time(r) < now.getTime(), (r) => `maintenance was due ${dateText(r.nextMaintenanceDate)}`, time),
    { limit },
  );
};

const longInRepair = (data, { now, days = 30, limit }) => {
  const edited = (r) => asTime(r.updatedAt);
  const border = now.getTime() - days * DAY;
  return result(
    deviceFindings(data.rows, data, (r) => r.status === "inRepair" && edited(r) !== null && edited(r) < border, (r) => `in repair, last edit ${dateText(r.updatedAt)}`, edited),
    { limit },
    "approximate: by last edit, the status change date is not stored",
  );
};

const idleStock = (data, { now, days = 90, limit }) => {
  const edited = (r) => asTime(r.updatedAt);
  const border = now.getTime() - days * DAY;
  return result(
    deviceFindings(
      data.rows,
      data,
      (r) => FREE_STATUSES.includes(r.status) && !r.parentDeviceId && edited(r) !== null && edited(r) < border,
      (r) => `free (${r.status}), last edit ${dateText(r.updatedAt)}`,
      edited,
    ),
    { limit },
  );
};

const missingParts = (row, idx) => {
  // Самосборка по замыслу без модели
  const type = row.deviceTypeId ? idx.types.get(idStr(row.deviceTypeId)) : null;
  const selfBuilt = !row.deviceModelId && type?.assembly?.enabled;
  return [
    !String(row.serialNumber ?? "").trim() && "no serial number",
    !row.locationId && "no location",
    !row.deviceModelId && !selfBuilt && "no model",
  ].filter(Boolean);
};

const missingData = (data, { limit }) =>
  result(
    deviceFindings(data.rows, data, (r) => !r.parentDeviceId && !isRetired(r) && missingParts(r, data.catalogIdx).length > 0, (r) => missingParts(r, data.catalogIdx).join(", ")),
    { limit },
  );

const duplicateSerials = (data, { limit }) => {
  const groups = new Map();
  for (const row of data.rows) {
    const key = String(row.serialNumber ?? "").trim().toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const items = [...groups.values()]
    .filter((list) => list.length > 1)
    .map((list) => ({
      id: list.map(idStr).join(", "),
      kind: "device",
      line: `serial "${String(list[0].serialNumber).trim()}" on ${list.length} devices: ${list.map((r) => `${deviceName(r, data.catalogIdx)} · ${idStr(r)}`).join("; ")}`,
    }));
  return result(items, { limit }, "repeated serials are allowed, check them");
};

// ─── Проверки справочника ────────────────────────────────────────────────

const collisions = (entries, keyOf) => {
  const groups = new Map();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (!dupKey(entry.name)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()].filter((list) => list.length > 1);
};

// Значения конфигурации как множество: пустые не в счёт, multiselect — без порядка
const BLANK_VALUES = new Set(["", "[]"]);
const valueSetKey = (config, idx) => {
  const pairs = (config.values ?? [])
    .filter((v) => !BLANK_VALUES.has(String(v.value ?? "").trim()))
    .map((v) => {
      const raw = String(v.value).trim();
      const multi = idx.attributes.get(idStr(v.attributeId))?.valueType === "multiselect" || raw.startsWith("[");
      return [idStr(v.attributeId), multi ? JSON.stringify([...new Set(parseMultiValue(raw))].sort()) : raw];
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.length ? JSON.stringify(pairs) : null;
};

// Скрытую запись слить нельзя (ни источником, ни целью): в находку она не идёт
const live = (entries) => entries.filter((e) => e.isActive !== false);

const catalogDuplicates = (data, { limit }) => {
  const idx = data.catalogIdx;
  const quoted = (list, label) => list.map((e) => `«${label(e)}»`).join(", ");
  const found = (kind, noun, list, label, what = "name") => ({
    id: list.map(idStr).join(", "),
    kind,
    line: `${noun} with the same ${what}: ${quoted(list, label)} · ${list.map(idStr).join(", ")}`,
  });
  const byName = (e) => e.name;
  // Конфигурации — только внутри одной модели: по имени и отдельно по значениям
  const configItems = [];
  const byModel = new Map();
  for (const config of data.configs ?? []) {
    const key = idStr(config.deviceModelId);
    // Модель удалена (её нет в живом индексе) — слить её конфигурации нельзя
    if (!idx.models.has(key)) continue;
    if (!byModel.has(key)) byModel.set(key, []);
    byModel.get(key).push(config);
  }
  for (const [modelId, list] of byModel) {
    const noun = `Configurations of «${modelName(idx.models.get(modelId), idx)}»`;
    const label = (c) => c.name || "(no name)";
    const named = collisions(list, (c) => dupKey(c.name));
    const seen = new Set(named.map((group) => group.map(idStr).join(",")));
    configItems.push(...named.map((group) => found("configuration", noun, group, label)));
    const sameValues = new Map();
    for (const config of list) {
      const key = valueSetKey(config, idx);
      if (!key) continue;
      if (!sameValues.has(key)) sameValues.set(key, []);
      sameValues.get(key).push(config);
    }
    for (const group of sameValues.values()) {
      if (group.length < 2 || seen.has(group.map(idStr).join(","))) continue;
      configItems.push(found("configuration", noun, group, label, "values"));
    }
  }
  const items = [
    ...collisions(live([...idx.types.values()]), (e) => dupKey(e.name)).map((l) => found("type", "Types", l, byName)),
    ...collisions(data.models, (e) => `${idStr(e.vendorId)}|${dupKey(e.name)}`).map((l) => found("model", "Models", l, (e) => modelName(e, idx))),
    ...collisions(live([...idx.attributes.values()]), (e) => dupKey(e.name)).map((l) => found("attribute", "Attributes", l, attrName)),
    ...collisions(live([...idx.vendors.values()]), (e) => dupKey(e.name)).map((l) => found("vendor", "Vendors", l, byName)),
    ...collisions(live([...idx.suppliers.values()]), (e) => dupKey(e.name)).map((l) => found("supplier", "Suppliers", l, byName)),
    ...collisions([...idx.groups.values()], (e) => dupKey(e.name)).map((l) => found("group", "Groups", l, byName)),
    ...configItems,
  ];
  return result(items, { limit });
};

const unusedAttributes = (data, { limit }) => {
  const used = new Set(data.links.map((l) => idStr(l.attributeId)));
  for (const config of data.configs) for (const v of config.values ?? []) used.add(idStr(v.attributeId));
  const items = [...data.catalogIdx.attributes.values()]
    .filter((a) => !used.has(idStr(a)))
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((a) => ({ id: idStr(a), kind: "attribute", line: `${attrName(a)}: no type uses it and no configuration has a value · ${idStr(a)}` }));
  return result(items, { limit });
};

const modelsWithoutConfiguration = (data, { limit }) => {
  const idx = data.catalogIdx;
  const withConfig = new Set(data.configs.map((c) => idStr(c.deviceModelId)));
  const items = data.models
    .filter((m) => !withConfig.has(idStr(m)))
    .map((m) => ({ id: idStr(m), kind: "model", line: `${modelName(m, idx)} (${typeNameOf(m.deviceTypeId, idx)}): no configurations · ${idStr(m)}` }))
    .sort((a, b) => collator.compare(a.line, b.line));
  return result(items, { limit });
};

const invalidAttributeValues = (data, { limit }) => {
  const idx = data.catalogIdx;
  const items = [];
  for (const config of data.configs) {
    for (const v of config.values ?? []) {
      const attr = idx.attributes.get(idStr(v.attributeId));
      if (!attr || isValidValue(attr, v.value)) continue;
      const options = (attr.options ?? []).length ? `, options: ${attr.options.map((o) => o.value).join(", ")}` : "";
      items.push({
        id: idStr(config.deviceModelId),
        kind: "model",
        line: `${modelName(idx.models.get(idStr(config.deviceModelId)), idx)}, configuration «${config.name}»: ${attrName(attr)} = "${v.value}" is not a valid ${attr.valueType}${options} · ${idStr(config.deviceModelId)}`,
      });
    }
  }
  return result(items, { limit });
};

const orphanRefs = (data, { limit }) => {
  const idx = data.catalogIdx;
  const items = [];
  for (const link of data.links) {
    if (idx.attributes.has(idStr(link.attributeId))) continue;
    items.push({
      id: idStr(link.deviceTypeId),
      kind: "type",
      line: `Type «${typeNameOf(link.deviceTypeId, idx)}» links attribute ${idStr(link.attributeId)}, which is not in the catalog · ${idStr(link.deviceTypeId)}`,
    });
  }
  for (const config of data.configs) {
    for (const v of config.values ?? []) {
      if (idx.attributes.has(idStr(v.attributeId))) continue;
      items.push({
        id: idStr(config.deviceModelId),
        kind: "model",
        line: `${modelName(idx.models.get(idStr(config.deviceModelId)), idx)}, configuration «${config.name}»: value for attribute ${idStr(v.attributeId)}, which is not in the catalog · ${idStr(config.deviceModelId)}`,
      });
    }
  }
  return result(items, { limit });
};

// ─── Заявки и сборки ─────────────────────────────────────────────────────

const ticketHeavy = (data, { now, days = 180, limit }) => {
  const idx = data.catalogIdx;
  const border = now.getTime() - days * DAY;
  const system = new Set((data.systemUserIds ?? []).map(String));
  const fresh = (data.tickets ?? []).filter((t) => (asTime(t.createdAt) ?? 0) >= border);
  const byDevice = new Map();
  const byApplicant = new Map();
  for (const t of fresh) {
    if (t.relatedClientDeviceId) {
      const key = idStr(t.relatedClientDeviceId);
      if (!byDevice.has(key)) byDevice.set(key, new Set());
      byDevice.get(key).add(idStr(t));
    }
    if (t.applicantId && !system.has(idStr(t.applicantId))) {
      const key = idStr(t.applicantId);
      if (!byApplicant.has(key)) byApplicant.set(key, new Set());
      byApplicant.get(key).add(idStr(t));
    }
  }
  const perDevice = [];
  const perModel = new Map();
  for (const row of data.rows) {
    const set = new Set(byDevice.get(idStr(row)));
    if (row.userId && !row.parentDeviceId && !system.has(idStr(row.userId))) for (const t of byApplicant.get(idStr(row.userId)) ?? []) set.add(t);
    if (!set.size) continue;
    perDevice.push({ row, n: set.size });
    if (row.deviceModelId) {
      const key = idStr(row.deviceModelId);
      if (!perModel.has(key)) perModel.set(key, new Set());
      for (const t of set) perModel.get(key).add(t);
    }
  }
  const noun = (n) => plural(n, "ticket", "tickets");
  const devices = perDevice
    .sort((a, b) => b.n - a.n)
    .map(({ row, n }) => ({ id: idStr(row), kind: "device", line: `${deviceName(row, idx)}: ${noun(n)} in ${days} days · ${idStr(row)}` }));
  const modelItems = [...perModel.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .map(([id, set]) => ({ id, kind: "model", line: `${modelName(idx.models.get(id), idx)}: ${noun(set.size)} across its devices in ${days} days · ${id}` }));
  const out = result([...devices.slice(0, limit), ...modelItems.slice(0, limit)], { limit: Infinity }, TICKET_ESTIMATE);
  out.count = devices.length + modelItems.length;
  return out;
};

const incompleteAssemblies = (data, { limit }) => {
  const idx = data.catalogIdx;
  const items = [];
  for (const row of data.rows) {
    if (row.parentDeviceId || isRetired(row)) continue;
    const parts = (data.components ?? []).filter((c) => idStr(c.parentDeviceId) === idStr(row));
    const assembly = assemblyOf(row, parts, idx);
    const missing = assembly?.slots.filter((s) => s.missing).map((s) => s.type) ?? [];
    if (missing.length) items.push({ id: idStr(row), kind: "device", line: `${deviceName(row, idx)}: missing: ${missing.join(", ")} · ${idStr(row)}` });
  }
  return result(items, { limit });
};

const brokenBuilds = (data, { limit }) => {
  const idx = data.catalogIdx;
  const items = [];
  for (const build of data.builds ?? []) {
    const buildType = idx.types.get(idStr(build.deviceTypeId));
    const slotTypes = new Set((buildType?.assembly?.slots ?? []).map((s) => idStr(s.typeId)));
    const problems = [];
    for (const part of build.parts ?? []) {
      const reasons = [
        !idx.models.has(idStr(part.deviceModelId)) && "model deleted",
        part.configurationId && !idx.configs.has(idStr(part.configurationId)) && "configuration deleted",
        buildType && !slotTypes.has(idStr(part.typeId)) && `not a slot of ${buildType.name}`,
      ].filter(Boolean);
      if (reasons.length) problems.push(`${typeNameOf(part.typeId, idx)}: ${reasons.join(", ")}`);
    }
    if (problems.length) {
      items.push({ id: idStr(build), kind: "type", line: `Build «${build.name}» (${buildType?.name ?? "(deleted type)"}): ${problems.join("; ")} · ${idStr(build)}` });
    }
  }
  return result(items, { limit });
};

const CATALOG_KINDS = ["catalogDuplicates", "unusedAttributes", "modelsWithoutConfiguration", "invalidAttributeValues", "orphanRefs", "brokenBuilds"];
// Окно времени вида для сводки; days — переопределение вызывающего
const WINDOWS = {
  warrantyExpiring: (days = 60) => `next ${days} days`,
  longInRepair: (days = 30) => `no edit for ${days} days`,
  idleStock: (days = 90) => `no edit for ${days} days`,
  ticketHeavy: (days = 180) => `last ${days} days`,
};

/** Виды находок в порядке сводки. Дефолтные пороги (days) живут в самих проверках. */
const FINDING_KINDS = Object.freeze(
  [
    ["warrantyExpiring", warrantyExpiring],
    ["warrantyExpired", warrantyExpired],
    ["lifespanExceeded", lifespanExceeded],
    ["maintenanceOverdue", maintenanceOverdue],
    ["longInRepair", longInRepair],
    ["idleStock", idleStock],
    ["missingData", missingData],
    ["duplicateSerials", duplicateSerials],
    ["catalogDuplicates", catalogDuplicates],
    ["unusedAttributes", unusedAttributes],
    ["modelsWithoutConfiguration", modelsWithoutConfiguration],
    ["invalidAttributeValues", invalidAttributeValues],
    ["orphanRefs", orphanRefs],
    ["ticketHeavy", ticketHeavy],
    ["incompleteAssemblies", incompleteAssemblies],
    ["brokenBuilds", brokenBuilds],
  ].map(([kind, check]) =>
    Object.freeze({ kind, check, scope: CATALOG_KINDS.includes(kind) ? "catalog" : "devices", window: WINDOWS[kind] }),
  ),
);

module.exports = { FINDING_KINDS, dupKey, isValidValue };
