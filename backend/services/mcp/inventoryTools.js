const { resolveByName } = require("./ticketQuery");
const { normalize } = require("./text");
const { oneLine } = require("./ticketFormat");
const {
  buildCatalogIndex,
  specsOf,
  assemblyOf,
  deviceTitle,
  deviceLinkPattern,
  formatDeviceRow,
  formatDeviceDetail,
} = require("./inventoryFormat");
const { aggregateInventoryStats, formatInventoryStats } = require("./inventoryStats");
const { FINDING_KINDS } = require("./inventoryFindings");
const { deviceTypeId } = require("./inventorySource");
const { isAttachableType, filterAttachable } = require("../inventory/attachRules");
const { liveAssembly } = require("../inventory/assemblyKeySpecs");

/**
 * Инструменты инвентаря для ИИ-агента (spec 2026-10-16-mcp-inventory-design.md).
 * Доступ к данным приходит аргументом (inventorySource.js), поэтому модуль
 * проверяется на заготовках без базы. Секции файла: общие помощники,
 * справочники (catalog, searchModels).
 */

// ─── Общие помощники ─────────────────────────────────────────────────────

// Имена, под которыми инструменты регистрируются (Task 8) и пишутся в лог
const TOOL_NAMES = {
  catalog: "get_inventory_catalog",
  searchModels: "search_device_models",
  searchDevices: "search_devices",
  getDevice: "get_device",
  listAttachable: "list_attachable_components",
  stats: "inventory_stats",
  findings: "inventory_findings",
};

const errorResult = (text) => ({ isError: true, content: [{ type: "text", text }] });
const textResult = (text) => ({ content: [{ type: "text", text }] });
const clampInt = (value, min, max, fallback) =>
  Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback;
const idStr = (v) => (v === undefined || v === null ? "" : String(v._id ?? v));
const cleanString = (value, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const collator = new Intl.Collator("ru");
const byName = (a, b) => collator.compare(a.name, b.name);

// Все слова запроса должны встретиться в тексте (как resolveByName)
const matchesQuery = (query, ...texts) => {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = normalize(texts.filter(Boolean).join(" "));
  return words.every((word) => haystack.includes(word));
};

// Имя из аргумента → одна запись. Ноль или несколько совпадений — ошибка
// инструмента с подсказкой (никогда не выбираем молча).
const resolveOne = (items, name, kind, rule) => {
  const matches = resolveByName(items, name, rule);
  if (!matches.length) return { error: `No ${kind} matches "${name}". ${rule.hint ?? "Check the name with get_inventory_catalog or omit the filter."}` };
  if (matches.length > 1) {
    const options = matches.slice(0, 10).map(rule.name ?? ((item) => item.name)).join("; ");
    const plural = rule.plural ?? (kind.endsWith("y") ? `${kind.slice(0, -1)}ies` : `${kind}s`);
    return { error: `Several ${plural} match "${name}": ${options}. ${rule.ambiguousHint ?? "Repeat with a more specific name."}` };
  }
  return { item: matches[0] };
};
const NAME_RULE = { label: (item) => item.name, exact: (item) => [item.name] };

const COMPANY_RULE = {
  hint: "List companies with list_companies or omit the filter.",
  name: (c) => c.alias,
  label: (c) => `${c.alias ?? ""} ${c.fullTitle ?? ""}`,
  exact: (c) => [c.alias, c.fullTitle].filter(Boolean),
};
// Виды, которым нужны дорогие данные; остальное грузится всегда или не нужно вовсе
const KINDS_WITH_BUILDS = ["brokenBuilds"];
const KINDS_WITH_TICKETS = ["ticketHeavy"];
const KINDS_WITH_COMPONENTS = ["incompleteAssemblies"];
const TICKET_DAYS = 180;
const STAT_GROUPS = ["status", "type", "model", "vendor", "company", "location"];

const truncationLine = (shown, total, hint) =>
  shown < total ? `Showing ${shown} of ${total}. ${hint}` : null;

const optionsText = (attr) =>
  (attr.options ?? []).length ? `options(${attr.options.map((o) => o.value).join(", ")})` : null;

// Строка атрибута: code · name · valueType · unit · options(values)
const attributeCells = (attr) =>
  [attr.code, attr.name, attr.valueType, attr.unit || null, optionsText(attr)].filter(Boolean);

// ─── Устройства: чистые помощники ────────────────────────────────────────

const STATUSES = ["readyForDeployment", "deployed", "inRepair", "decommissioned", "inReserve", "disposed"];
const FREE_STATUSES = ["readyForDeployment", "inReserve"];
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HEX_ID = /^[0-9a-f]{24}$/i;
const DEVICE_PATH = /^\/inventory\/client-devices\/([0-9a-f]{24})\/?$/i;

/**
 * Что отсканировали или набрали → {id} (id или ссылка на устройство с любого
 * хоста: QR строится от адреса браузера) либо {text} (номер, серийник, имя узла).
 * Чистая; её же берёт фаза аудита помещения.
 */
const parseDeviceRef = (value) => {
  const text = String(value ?? "").trim();
  if (HEX_ID.test(text)) return { id: text.toLowerCase() };
  let path = null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      path = new URL(text).pathname;
    } catch {
      path = null;
    }
  } else if (text.startsWith("/")) path = text.split(/[?#]/)[0];
  const match = path && DEVICE_PATH.exec(path);
  return match ? { id: match[1].toLowerCase() } : { text };
};

/**
 * Mongo-фильтр устройств. `ids` — уже найденные по именам значения:
 * companyId, userId, locationIds, modelId, typeId + modelIdsOfType (тип
 * устройства бывает в двух формах: свой deviceTypeId или через модель),
 * queryModelIds (модели, чьё имя подошло под query). Чистая: sift в тестах
 * считает тот же фильтр.
 */
const buildDeviceFilter = (args = {}, ids = {}) => {
  const and = [];
  if (ids.companyId) and.push({ companyId: ids.companyId });
  if (ids.userId) and.push({ userId: ids.userId });
  if (ids.locationIds) and.push({ locationId: { $in: ids.locationIds } });
  if (ids.modelId) and.push({ deviceModelId: ids.modelId });
  if (ids.typeId) {
    and.push({ $or: [{ deviceModelId: null, deviceTypeId: { $in: [ids.typeId] } }, { deviceModelId: { $in: ids.modelIdsOfType ?? [] } }] });
  }
  if (args.query) {
    const re = new RegExp(escapeRegex(args.query), "i");
    and.push({ $or: [{ serialNumber: re }, { inventoryNumber: re }, { hostname: re }, { deviceModelId: { $in: ids.queryModelIds ?? [] } }] });
  }
  if (args.status === "free" || args.free) {
    and.push({ status: { $in: FREE_STATUSES } }, { parentDeviceId: null });
  }
  if (args.status && args.status !== "free") and.push({ status: args.status });
  if (args.rootOnly) and.push({ parentDeviceId: null });
  if (args.warrantyBefore) and.push({ warrantyExpirationDate: { $ne: null, $lt: args.warrantyBefore } });
  if (args.purchasedBefore) and.push({ purchasedAt: { $ne: null, $lt: args.purchasedBefore } });
  return and.length ? { $and: and } : {};
};

const parseDay = (value, name) => {
  if (value === undefined || value === null || value === "") return { date: null };
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { error: `${name} must be a calendar day as YYYY-MM-DD, got "${value}"` };
  }
  return { date };
};

const createInventoryTools = ({ source, baseUrl, log, now = () => new Date() }) => {
  const logCall = (caller, tool, meta, started) =>
    log("info", "MCP tool call", { mcpKeyId: caller?.keyId, mcpKeyName: caller?.keyName, tool, ...meta, durationMs: Date.now() - started });

  const loadIndex = async ({ builds = false } = {}) => {
    const [catalog, models, configs, buildRows] = await Promise.all([
      source.loadCatalog(),
      source.loadModels(),
      source.loadConfigurations(),
      builds ? source.loadBuilds() : [],
    ]);
    return { catalog, models, configs, builds: buildRows, idx: buildCatalogIndex(catalog, models, configs, buildRows) };
  };

  // Что угодно, что отсканировали или набрали → одно устройство. Ноль или
  // несколько — ошибка с подсказкой (error — функция: строки требуют индекса и справочника).
  const resolveDevice = async (ref) => {
    const parsed = parseDeviceRef(ref);
    if (parsed.id) {
      const device = await source.loadDevice(parsed.id);
      if (device) return { device };
      // 24 hex-символа могут оказаться серийником или номером: ссылка — только id
      if (parsed.id !== ref.toLowerCase()) return { kind: "not-found", error: () => `No device matches "${ref}". Find it with search_devices.` };
      parsed.text = ref;
    }
    if (!parsed.text) return { kind: "empty", error: () => "Give an id, a device link, an inventory number, a serial number or a hostname." };
    const exact = new RegExp(`^${escapeRegex(parsed.text)}$`, "i");
    const matches = await source.findDevices({ $or: [{ inventoryNumber: exact }, { serialNumber: exact }, { hostname: exact }] }, { limit: 10 });
    if (!matches.length) return { kind: "not-found", error: () => `No device matches "${ref}". Find it with search_devices.` };
    if (matches.length > 1) {
      return {
        kind: "ambiguous",
        error: (idx, dir) =>
          `Several devices match "${ref}":\n${matches.map((d) => `- ${formatDeviceRow(d, idx, dir)}`).join("\n")}\nRepeat with the id of one of them.`,
      };
    }
    return { device: matches[0] };
  };

  // ─── Справочники ───────────────────────────────────────────────────────

  // Группы атрибутов типа — как в «Характеристиках» карточки: зеркало
  // spec-sheet.ts#buildSpecGroups (см. buildSpecGroups в inventoryFormat.js), держать в ногу.
  const typeLines = (type, idx) => {
    const flags = [
      type.isActive === false && "inactive",
      type.isComponent && "component",
      type.isConsumable && "consumable",
      type.isPeripheral && "peripheral",
    ].filter(Boolean);
    const attachable = (type.attachableToTypeIds ?? []).map((id) => idx.types.get(idStr(id))?.name).filter(Boolean);
    const lines = [`## ${type.name}`];
    lines.push(`flags: ${flags.join(", ") || "—"}${attachable.length ? `; attachable to: ${attachable.join(", ")}` : ""}`);

    // Атрибуты как в «Характеристиках»: группы по order, внутри — по order связки, без группы — «Прочее»
    const buckets = new Map();
    for (const link of idx.attrsByType.get(idStr(type)) ?? []) {
      const group = link.groupId ? idx.groups.get(link.groupId) : null;
      const key = group ? idStr(group) : "other";
      if (!buckets.has(key)) buckets.set(key, { name: group?.name ?? "Прочее", order: group ? group.order ?? 0 : Infinity, rows: [] });
      buckets.get(key).rows.push([...attributeCells(link.attr), link.required ? "required" : null].filter(Boolean).join(" · "));
    }
    const groups = [...buckets.values()].sort((a, b) => (a.order === b.order ? collator.compare(a.name, b.name) : a.order - b.order));
    if (groups.length) {
      lines.push("attributes (code · name · valueType · unit · options · required):");
      for (const group of groups) lines.push(`- ${group.name}`, ...group.rows.map((row) => `  - ${row}`));
    } else lines.push("attributes: none");

    if (type.assembly?.enabled) {
      const slots = (type.assembly.slots ?? [])
        .filter((s) => idx.types.get(idStr(s.typeId)))
        .map((s) => `${idx.types.get(idStr(s.typeId)).name}${s.required ? " · required" : ""}${s.multiple ? " · multiple" : ""}`);
      lines.push(`assembly slots (type · required · multiple): ${slots.length ? "" : "none"}`.trimEnd(), ...slots.map((s) => `  - ${s}`));
      const keys = (type.assembly.keySpecs ?? [])
        .filter((k) => idx.types.get(idStr(k.typeId)))
        .map((k) => {
          const what = k.source === "attribute" ? idx.attributes.get(idStr(k.attributeId))?.name ?? "attribute" : "model";
          return `${idx.types.get(idStr(k.typeId)).name} · ${what} · ${k.aggregate || "first"}`;
        });
      if (keys.length) lines.push("key characteristics (type · model|attribute · aggregate):", ...keys.map((k) => `  - ${k}`));
    }
    return lines.join("\n");
  };

  const partText = (part, idx) => {
    const model = idx.models.get(idStr(part.deviceModelId));
    const vendor = model ? idx.vendors.get(idStr(model.vendorId))?.name : null;
    const title = model ? [vendor, model.name].filter(Boolean).join(" ") : "model deleted";
    const config = part.configurationId ? idx.configs.get(idStr(part.configurationId)) : null;
    let configText = "";
    if (config) {
      const lines = specsOf({ deviceModelId: part.deviceModelId, configurationId: config._id }, idx).groups.flatMap((g) => g.lines);
      configText = `, configuration «${config.name || "unnamed"}»${lines.length ? ` (${lines.join("; ")})` : ""}`;
    }
    return `${title}${configText}${part.quantity > 1 ? ` × ${part.quantity}` : ""}`;
  };

  const buildLines = (build, idx, counts) => {
    const type = idx.types.get(idStr(build.deviceTypeId));
    const slotOrder = (type?.assembly?.slots ?? []).map((s) => idStr(s.typeId));
    const rank = (part) => {
      const at = slotOrder.indexOf(idStr(part.typeId));
      return at < 0 ? slotOrder.length : at;
    };
    const parts = [...(build.parts ?? [])].sort((a, b) => rank(a) - rank(b));
    const devices = counts.get(idStr(build)) ?? 0;
    return [
      `## ${build.name} (${type?.name ?? "unknown type"}; ${devices} devices made from it)`,
      ...(parts.length
        ? parts.map((p) => `- ${idx.types.get(idStr(p.typeId))?.name ?? "unknown type"}: ${partText(p, idx)}`)
        : ["- no parts"]),
    ];
  };

  const sectionEntries = {
    types: async ({ query, includeInactive }) => {
      const { catalog, idx } = await loadIndex();
      const rows = catalog.types
        .filter((t) => (includeInactive || t.isActive !== false) && matchesQuery(query, t.name))
        .sort(byName);
      return { rows, render: (type) => typeLines(type, idx), noun: "device types", sep: "\n\n" };
    },
    groups: async ({ query }) => {
      const { catalog } = await loadIndex();
      const usage = new Map();
      for (const link of catalog.links ?? []) if (link.groupId) usage.set(idStr(link.groupId), (usage.get(idStr(link.groupId)) ?? 0) + 1);
      const rows = [...catalog.groups]
        .filter((g) => matchesQuery(query, g.name))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || collator.compare(a.name, b.name));
      return { rows, render: (g, i) => `${i + 1}. ${g.name} · used by ${usage.get(idStr(g)) ?? 0} attribute links`, noun: "attribute groups" };
    },
    attributes: async ({ query, valueType, includeInactive }) => {
      const { catalog, configs } = await loadIndex();
      const types = new Map();
      for (const link of catalog.links ?? []) {
        const key = idStr(link.attributeId);
        if (!types.has(key)) types.set(key, new Set());
        types.get(key).add(idStr(link.deviceTypeId));
      }
      const inConfigs = new Map();
      for (const config of configs) {
        for (const id of new Set((config.values ?? []).map((v) => idStr(v.attributeId)))) inConfigs.set(id, (inConfigs.get(id) ?? 0) + 1);
      }
      const rows = catalog.attributes
        .filter((a) => (includeInactive || a.isActive !== false) && (!valueType || a.valueType === valueType) && matchesQuery(query, a.name, a.code))
        .sort(byName);
      return {
        rows,
        noun: "attributes",
        render: (a) =>
          `- ${[...attributeCells(a), a.isActive === false ? "inactive" : null].filter(Boolean).join(" · ")} · used by ${types.get(idStr(a))?.size ?? 0} types, ${inConfigs.get(idStr(a)) ?? 0} configurations`,
      };
    },
    builds: async ({ query, type }) => {
      const { builds, idx } = await loadIndex({ builds: true });
      let typeRow = null;
      if (type) {
        const resolved = resolveOne([...idx.types.values()], type, "device type", NAME_RULE);
        if (resolved.error) return { error: resolved.error };
        typeRow = resolved.item;
      }
      const counts = new Map();
      for (const row of await source.deviceRows({ buildId: { $ne: null } })) counts.set(idStr(row.buildId), (counts.get(idStr(row.buildId)) ?? 0) + 1);
      const rows = builds
        .filter((b) => (!typeRow || idStr(b.deviceTypeId) === idStr(typeRow)) && matchesQuery(query, b.name))
        .sort(byName);
      return { rows, noun: "builds", render: (b) => buildLines(b, idx, counts).join("\n"), sep: "\n\n" };
    },
    vendors: async ({ query, includeInactive }) => {
      const { catalog } = await loadIndex();
      const rows = catalog.vendors.filter((v) => (includeInactive || v.isActive !== false) && matchesQuery(query, v.name)).sort(byName);
      return { rows, noun: "vendors", render: (v) => `- ${v.name}${v.isActive === false ? " · inactive" : ""}` };
    },
    suppliers: async ({ query, includeInactive }) => {
      const { catalog } = await loadIndex();
      // Только названия: контакты и ИНН поставщиков агенту не нужны; скрытые — по includeInactive, как у вендоров
      const rows = catalog.suppliers.filter((s) => (includeInactive || s.isActive !== false) && matchesQuery(query, s.name)).sort(byName);
      return { rows, noun: "suppliers", render: (s) => `- ${s.name}${s.isActive === false ? " · inactive" : ""}` };
    },
  };

  const searchHint = "Narrow with query or type, or raise limit.";

  return {
    catalog: async (args = {}, caller) => {
      const started = Date.now();
      const section = cleanString(args.section, 30);
      if (!Object.hasOwn(sectionEntries, section)) {
        logCall(caller, TOOL_NAMES.catalog, { error: "section" }, started);
        return errorResult(`Unknown section "${section}". Use one of: ${Object.keys(sectionEntries).join(", ")}.`);
      }
      const limit = clampInt(args.limit, 1, 200, 50);
      const result = await sectionEntries[section]({
        query: cleanString(args.query, 300),
        type: cleanString(args.type),
        valueType: cleanString(args.valueType, 30),
        includeInactive: args.includeInactive === true,
      });
      if (result.error) {
        logCall(caller, TOOL_NAMES.catalog, { section, error: "name" }, started);
        return errorResult(result.error);
      }
      logCall(caller, TOOL_NAMES.catalog, { section, query: cleanString(args.query, 100), results: result.rows.length }, started);
      if (!result.rows.length) return textResult(`No ${result.noun} found in ${section}. Try another query or includeInactive.`);
      const shown = result.rows.slice(0, limit);
      const header = `${result.rows.length} ${result.noun} (${section}).`;
      const body = shown.map(result.render).join(result.sep ?? "\n");
      const cut = truncationLine(shown.length, result.rows.length, section === "builds" ? searchHint : "Narrow with query, or raise limit.");
      return textResult([header, body, cut].filter(Boolean).join("\n\n"));
    },

    searchModels: async (args = {}, caller) => {
      const started = Date.now();
      const { catalog, models, idx } = await loadIndex();
      let typeRow = null;
      let vendorRow = null;
      const type = cleanString(args.type);
      const vendor = cleanString(args.vendor);
      if (type) {
        const resolved = resolveOne(catalog.types, type, "device type", NAME_RULE);
        if (resolved.error) {
          logCall(caller, TOOL_NAMES.searchModels, { error: "type" }, started);
          return errorResult(resolved.error);
        }
        typeRow = resolved.item;
      }
      if (vendor) {
        const resolved = resolveOne(catalog.vendors, vendor, "vendor", NAME_RULE);
        if (resolved.error) {
          logCall(caller, TOOL_NAMES.searchModels, { error: "vendor" }, started);
          return errorResult(resolved.error);
        }
        vendorRow = resolved.item;
      }
      const query = cleanString(args.query, 300);
      const limit = clampInt(args.limit, 1, 50, 20);
      const page = clampInt(args.page, 1, 1000, 1);
      const [modelCounts, configCounts] = await Promise.all([source.countDevicesByModel(), source.countDevicesByConfiguration()]);

      const rows = models
        .filter((m) => !typeRow || idStr(m.deviceTypeId) === idStr(typeRow))
        .filter((m) => !vendorRow || idStr(m.vendorId) === idStr(vendorRow))
        .filter((m) => matchesQuery(query, idx.vendors.get(idStr(m.vendorId))?.name, m.name))
        .sort((a, b) => collator.compare(`${idx.vendors.get(idStr(a.vendorId))?.name ?? ""} ${a.name}`, `${idx.vendors.get(idStr(b.vendorId))?.name ?? ""} ${b.name}`));
      logCall(caller, TOOL_NAMES.searchModels, { query: query.slice(0, 100), results: rows.length }, started);
      if (!rows.length) return textResult("No models match. Try other words or fewer filters; list types and vendors with get_inventory_catalog.");

      const from = (page - 1) * limit;
      const shown = rows.slice(from, from + limit);
      if (!shown.length) return textResult(`No models on page ${page} (${rows.length} found). Ask for an earlier page.`);

      const render = (model) => {
        const vendorName = idx.vendors.get(idStr(model.vendorId))?.name;
        const compat = (model.compatibleWithModelIds ?? [])
          .map((id) => idx.models.get(idStr(id)))
          .filter(Boolean)
          .map((m) => [idx.vendors.get(idStr(m.vendorId))?.name, m.name].filter(Boolean).join(" "));
        const lines = [
          `## ${[vendorName, model.name].filter(Boolean).join(" ")}`,
          `id: ${idStr(model)} · type: ${idx.types.get(idStr(model.deviceTypeId))?.name ?? "unknown"} · devices: ${modelCounts.get(idStr(model)) ?? 0}`,
        ];
        if (compat.length) lines.push(`compatible with: ${compat.join("; ")}`);
        const own = idx.configsByModel.get(idStr(model)) ?? [];
        for (const config of own) {
          const values = specsOf({ deviceModelId: model._id, configurationId: config._id }, idx).groups.flatMap((g) => g.lines);
          lines.push(`- configuration «${config.name || "unnamed"}» (${configCounts.get(idStr(config)) ?? 0} devices)${values.length ? `: ${values.join("; ")}` : ""}`);
        }
        return lines.join("\n");
      };

      const last = from + shown.length;
      const header = `Found ${rows.length} models; showing ${from + 1}–${last}.`;
      const cut = last < rows.length ? `Showing ${last} of ${rows.length}. Narrow with type, vendor or query, or ask for page ${page + 1}.` : null;
      return textResult([header, shown.map(render).join("\n\n"), cut].filter(Boolean).join("\n\n"));
    },

    // ─── Устройства ──────────────────────────────────────────────────────

    searchDevices: async (args = {}, caller) => {
      const started = Date.now();
      const fail = (kind, error) => {
        logCall(caller, TOOL_NAMES.searchDevices, { error: kind }, started);
        return errorResult(error);
      };
      const status = cleanString(args.status, 30);
      if (status && status !== "free" && !STATUSES.includes(status)) {
        return fail("status", `Unknown status "${status}". Use one of: ${[...STATUSES, "free"].join(", ")}.`);
      }
      const warranty = parseDay(args.warrantyBefore, "warrantyBefore");
      const purchased = parseDay(args.purchasedBefore, "purchasedBefore");
      if (warranty.error || purchased.error) return fail("date", warranty.error || purchased.error);

      const [{ catalog, models, idx }, dir] = await Promise.all([loadIndex(), source.loadDirectory()]);
      const ids = {};
      const company = cleanString(args.company);
      if (company) {
        const r = resolveOne(dir.companies, company, "company", COMPANY_RULE);
        if (r.error) return fail("company", r.error);
        ids.companyId = idStr(r.item);
      }
      const type = cleanString(args.type);
      if (type) {
        const r = resolveOne(catalog.types, type, "device type", NAME_RULE);
        if (r.error) return fail("type", r.error);
        ids.typeId = idStr(r.item);
        ids.modelIdsOfType = models.filter((m) => idStr(m.deviceTypeId) === ids.typeId).map(idStr);
      }
      const model = cleanString(args.model);
      if (model) {
        const modelName = (m) => [idx.vendors.get(idStr(m.vendorId))?.name, m.name].filter(Boolean).join(" ");
        const r = resolveOne(models, model, "model", { name: modelName, label: modelName, exact: (m) => [modelName(m), m.name] });
        if (r.error) return fail("model", r.error);
        ids.modelId = idStr(r.item);
      }
      const location = cleanString(args.location);
      if (location) {
        const companyOf = (l) => (l.company ? idStr(l.company) : "");
        const inScope = dir.locations.filter((l) => !ids.companyId || !companyOf(l) || companyOf(l) === ids.companyId);
        const byLocId = new Map(dir.locations.map((l) => [idStr(l), l]));
        const pathOf = (l) => {
          const names = [];
          for (let cur = l, depth = 0; cur && depth < 6; depth += 1) {
            names.unshift(cur.name);
            cur = cur.parent ? byLocId.get(idStr(cur.parent)) : null;
          }
          return names.join(" › ");
        };
        const r = resolveOne(inScope, location, "location", {
          ...NAME_RULE,
          plural: "locations",
          ambiguousHint: ids.companyId ? "Repeat with a more specific name." : "Repeat with a more specific name, or add company to narrow.",
          hint: ids.companyId ? "Check the name or omit the filter." : "Add company to narrow, or omit the filter.",
          name: (l) => `${pathOf(l)}${companyOf(l) ? ` (${dir.companies.find((c) => idStr(c) === companyOf(l))?.alias ?? "unknown company"})` : ""}`,
        });
        if (r.error) return fail("location", r.error);
        // Место вместе с вложенными (кабинет в здании)
        const found = new Set([idStr(r.item)]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const loc of dir.locations) {
            if (loc.parent && found.has(idStr(loc.parent)) && !found.has(idStr(loc))) {
              found.add(idStr(loc));
              grew = true;
            }
          }
        }
        ids.locationIds = [...found];
      }
      const user = cleanString(args.user);
      if (user) {
        const full = (u) => [u.lastName, u.firstName].filter(Boolean).join(" ");
        const userCompany = (u) => (u.company?._id ? idStr(u.company._id) : "");
        const inScope = dir.users.filter((u) => !ids.companyId || userCompany(u) === ids.companyId);
        const r = resolveOne(inScope, user, "person", {
          plural: "people",
          hint: "Find the person with list_users or omit the filter.",
          name: (u) => `${full(u)}${userCompany(u) ? ` (${dir.companies.find((c) => idStr(c) === userCompany(u))?.alias ?? "—"})` : ""}`,
          label: full,
          exact: (u) => [full(u), [u.firstName, u.lastName].filter(Boolean).join(" ")],
        });
        if (r.error) return fail("user", r.error);
        ids.userId = idStr(r.item);
      }
      const query = cleanString(args.query, 300);
      if (query) {
        ids.queryModelIds = models
          .filter((m) => matchesQuery(query, idx.vendors.get(idStr(m.vendorId))?.name, m.name))
          .map(idStr);
      }

      const filter = buildDeviceFilter(
        { query, status, free: args.free === true, rootOnly: args.rootOnly === true, warrantyBefore: warranty.date, purchasedBefore: purchased.date },
        ids,
      );
      const limit = clampInt(args.limit, 1, 100, 20);
      const page = clampInt(args.page, 1, 1000, 1);
      const from = (page - 1) * limit;
      const [total, rows] = await Promise.all([
        source.countDevices(filter),
        source.findDevices(filter, { sort: { updatedAt: -1, _id: -1 }, skip: from, limit }),
      ]);
      logCall(caller, TOOL_NAMES.searchDevices, { query: query.slice(0, 100), results: total }, started);

      const header = [`Devices: ${total}`, deviceLinkPattern(baseUrl)].join("\n");
      if (!total) return textResult(`${header}\nNo devices match. Try other words or fewer filters.`);
      if (!rows.length) return textResult(`${header}\nNo devices on page ${page}. Ask for an earlier page.`);

      const keySpecs = await source.loadKeySpecsFor(rows).catch(() => new Map());
      const lines = rows.map((row) => {
        const key = keySpecs.get(idStr(row));
        return `- ${formatDeviceRow(row, idx, dir)}${key ? ` · ${key}` : ""}`;
      });
      const cut = truncationLine(from + rows.length, total, `Narrow with company, type or status, or ask for page ${page + 1}.`);
      return textResult([header, lines.join("\n"), cut].filter(Boolean).join("\n\n"));
    },

    getDevice: async (args = {}, caller, context = {}) => {
      const started = Date.now();
      const ref = cleanString(args.device, 500);
      const [{ idx }, dir] = await Promise.all([loadIndex({ builds: true }), source.loadDirectory()]);
      const found = await resolveDevice(ref);
      if (found.error) {
        logCall(caller, TOOL_NAMES.getDevice, { error: found.kind }, started);
        return errorResult(found.error(idx, dir));
      }
      const device = found.device;
      const systemUserIds = [context.systemAccounts?.unidentifiedId, ...(context.systemAccounts?.robotIds || [])].filter(Boolean);
      const [components, parent, [ticketsTotal, tickets]] = await Promise.all([
        source.loadComponents([device._id]),
        device.parentDeviceId ? source.loadDevice(idStr(device.parentDeviceId)) : null,
        // Всех заявок активного заявителя не грузим: сумма — счётом, строки — 5 новейших
        Promise.all([source.countTicketsForDevices([device], { systemUserIds }), source.loadTicketsForDevices([device], { systemUserIds, limit: 5 })]),
      ]);
      logCall(caller, TOOL_NAMES.getDevice, { results: 1 }, started);
      return textResult(
        formatDeviceDetail(
          { device, components, parent, tickets, ticketsTotal },
          idx,
          dir,
          { baseUrl, now: now() },
        ),
      );
    },

    listAttachable: async (args = {}, caller) => {
      const started = Date.now();
      const [{ idx, models }, dir] = await Promise.all([loadIndex({ builds: true }), source.loadDirectory()]);
      const found = await resolveDevice(cleanString(args.host, 500));
      if (found.error) {
        logCall(caller, TOOL_NAMES.listAttachable, { error: found.kind }, started);
        return errorResult(found.error(idx, dir));
      }
      const host = found.device;
      const fail = (kind, error) => {
        logCall(caller, TOOL_NAMES.listAttachable, { error: kind }, started);
        return errorResult(error);
      };
      if (!host.companyId) return fail("company", "The host has no company, so there is no stock to look through.");
      if (host.parentDeviceId) return fail("host", "The host is itself a component of another device. Use the device it is installed in.");
      const onlyFree = args.onlyFree !== false;
      const hostTypeId = deviceTypeId(host, idx.models);
      const hostTypeName = idx.types.get(hostTypeId)?.name ?? "unknown type";
      const noHostType = !host.deviceModelId && !host.deviceTypeId;

      let types = [...idx.types.values()].filter((t) => isAttachableType(t, hostTypeId));
      const typeArg = cleanString(args.type);
      if (typeArg) {
        const r = resolveOne(types, typeArg, "component type", NAME_RULE);
        if (r.error) return fail("type", r.error);
        types = [r.item];
      }
      const typeIds = types.map(idStr);
      const modelIds = models.filter((m) => typeIds.includes(idStr(m.deviceTypeId))).map(idStr);
      const filter = {
        $and: [
          { companyId: idStr(host.companyId) },
          { parentDeviceId: null },
          { _id: { $ne: idStr(host) } },
          { $or: [{ deviceTypeId: { $in: typeIds } }, { deviceModelId: { $in: modelIds } }] },
          ...(onlyFree ? [{ status: { $in: FREE_STATUSES } }] : []),
        ],
      };

      const [rows, assemblyIds, components] = await Promise.all([
        source.findDevices(filter, { sort: { updatedAt: -1, _id: -1 }, limit: 2000 }),
        source.loadAssemblyIds(),
        source.loadComponents([host._id]),
      ]);
      const candidates = filterAttachable({
        candidates: rows,
        typeOf: (d) => deviceTypeId(d, idx.models),
        typeById: idx.types,
        assemblyIds,
        hostTypeId,
      }).sort((a, b) => collator.compare(deviceTitle(a, idx), deviceTitle(b, idx)));
      logCall(caller, TOOL_NAMES.listAttachable, { results: candidates.length }, started);

      const live = components.filter((c) => !c.deletedAt);
      const hostModel = host.deviceModelId ? idx.models.get(idStr(host.deviceModelId)) : null;
      const specText = (device) => {
        const specs = specsOf(device, idx);
        if (specs.source === "ambiguous") return [`no configuration chosen; the model has ${specs.configurations.length}: ${specs.configurations.map((c) => c.name).join(", ")}`];
        return specs.groups.flatMap((g) => g.lines);
      };
      const compatible = (device) => {
        if (!hostModel || !device.deviceModelId) return false;
        const model = idx.models.get(idStr(device.deviceModelId));
        const has = (m, id) => (m?.compatibleWithModelIds ?? []).some((x) => idStr(x) === id);
        return has(model, idStr(hostModel)) || has(hostModel, idStr(model));
      };
      const rowLines = (device) => {
        const free = FREE_STATUSES.includes(device.status);
        const mark = !onlyFree && !free ? ` (in use: ${device.status || "—"})` : "";
        const lines = [`- ${formatDeviceRow(device, idx, dir)}${mark}`];
        const specs = specText(device);
        if (specs.length) lines.push(...specs.map((l) => `    ${l}`));
        if (compatible(device)) lines.push("    compatible with this host's model: yes");
        return lines;
      };

      const out = [
        `Host: ${oneLine(deviceTitle(host, idx))} (${hostTypeName}); id: ${idStr(host)}`,
        deviceLinkPattern(baseUrl),
        ...(noHostType ? ["The host has no type or model, so type restrictions are not applied; fix the device record first."] : []),
        live.length
          ? ["Installed now:", ...live.map((c) => {
              const specs = specText(c).join("; ");
              return `- ${oneLine(deviceTitle(c, idx))} (${idx.types.get(deviceTypeId(c, idx.models))?.name ?? "unknown type"})${specs ? `: ${specs}` : ""}`;
            })].join("\n")
          : "Installed now: nothing",
      ];
      if (!candidates.length) {
        out.push(`No ${onlyFree ? "free " : ""}components attachable to this host in its company. ${onlyFree ? "Try onlyFree false to see parts in use." : ""}`.trim());
        return textResult(out.join("\n\n"));
      }

      const limit = clampInt(args.limit, 1, 100, 30);
      const shown = candidates.slice(0, limit);
      const assembly = assemblyOf(host, live, idx);
      if (assembly) {
        // Слоты — те же, что видит assemblyOf (типы вне каталога выпадают одинаково)
        const defs = liveAssembly(idx.types.get(idStr(host.deviceTypeId)).assembly).slots.filter((s) => idx.types.get(idStr(s.typeId)));
        const placed = new Set();
        defs.forEach((slot, i) => {
          const rowsOfSlot = shown.filter((d) => deviceTypeId(d, idx.models) === idStr(slot.typeId) && !placed.has(idStr(d)));
          if (!rowsOfSlot.length) return;
          rowsOfSlot.forEach((d) => placed.add(idStr(d)));
          const taken = !slot.multiple && assembly.slots[i].parts.length > 0;
          out.push([`## ${idx.types.get(idStr(slot.typeId)).name}${taken ? " (slot taken — detach the current part first)" : ""}`, ...rowsOfSlot.flatMap(rowLines)].join("\n"));
        });
        const rest = shown.filter((d) => !placed.has(idStr(d)));
        if (rest.length) out.push(["## Not in the build's slots", ...rest.flatMap(rowLines)].join("\n"));
      } else {
        out.push(`${candidates.length} candidates:\n${shown.flatMap(rowLines).join("\n")}`);
      }
      const cut = truncationLine(shown.length, candidates.length, "Narrow with type, or raise limit.");
      if (cut) out.push(cut);
      return textResult(out.join("\n\n"));
    },
    stats: async (args = {}, caller) => {
      const started = Date.now();
      const fail = (kind, error) => {
        logCall(caller, TOOL_NAMES.stats, { error: kind }, started);
        return errorResult(error);
      };
      const groupBy = cleanString(args.groupBy, 30) || "type";
      if (!STAT_GROUPS.includes(groupBy)) return fail("groupBy", `Unknown groupBy "${groupBy}". Use one of: ${STAT_GROUPS.join(", ")}.`);
      const status = cleanString(args.status, 30);
      if (status && status !== "free" && !STATUSES.includes(status)) {
        return fail("status", `Unknown status "${status}". Use one of: ${[...STATUSES, "free"].join(", ")}.`);
      }
      const rootOnly = args.rootOnly !== false;

      const [{ catalog, models, idx }, dir] = await Promise.all([loadIndex(), source.loadDirectory()]);
      const ids = {};
      let companyRow = null;
      let typeRow = null;
      const company = cleanString(args.company);
      if (company) {
        const r = resolveOne(dir.companies, company, "company", COMPANY_RULE);
        if (r.error) return fail("company", r.error);
        companyRow = r.item;
        ids.companyId = idStr(r.item);
      }
      const type = cleanString(args.type);
      if (type) {
        const r = resolveOne(catalog.types, type, "device type", NAME_RULE);
        if (r.error) return fail("type", r.error);
        typeRow = r.item;
        ids.typeId = idStr(r.item);
        ids.modelIdsOfType = models.filter((m) => idStr(m.deviceTypeId) === ids.typeId).map(idStr);
      }
      const rows = await source.deviceRows(buildDeviceFilter({ status, rootOnly }, ids));
      logCall(caller, TOOL_NAMES.stats, { groupBy, results: rows.length }, started);

      const companyById = new Map(dir.companies.map((c) => [idStr(c), c]));
      // Одинаковые подписи у разных записей различаем: компании — полным названием,
      // места — компанией, а внутри одной компании — родителем
      const aliasCount = new Map();
      for (const c of dir.companies) aliasCount.set(c.alias, (aliasCount.get(c.alias) ?? 0) + 1);
      const companyLabel = (c) => (aliasCount.get(c.alias) > 1 && c.fullTitle ? c.fullTitle : c.alias || c.fullTitle);
      const placeById = new Map(dir.locations.map((l) => [idStr(l), l]));
      const nameCount = new Map();
      for (const l of dir.locations) nameCount.set(l.name, (nameCount.get(l.name) ?? 0) + 1);
      const placeLabel = (l) => {
        if (nameCount.get(l.name) < 2) return l.name;
        const owner = l.company ? companyById.get(idStr(l.company)) : null;
        const sameCompany = dir.locations.filter((o) => o.name === l.name && idStr(o.company ?? "") === idStr(l.company ?? "")).length > 1;
        const parent = l.parent ? placeById.get(idStr(l.parent))?.name : null;
        const extra = [owner && companyLabel(owner), sameCompany && parent].filter(Boolean).join(", ");
        return extra ? `${l.name} (${extra})` : l.name;
      };
      const none = { key: "(none)", label: "(none)" };
      const noModel = { key: "(no model)", label: "(no model)" };
      const modelOf = (row) => (row.deviceModelId ? idx.models.get(idStr(row.deviceModelId)) : null);
      const labelers = {
        status: (row) => row.status || "(none)",
        type: (row) => {
          const id = deviceTypeId(row, idx.models);
          const name = idx.types.get(id)?.name;
          return name ? { key: id, label: name } : none;
        },
        model: (row) => {
          const model = modelOf(row);
          return model ? { key: idStr(model), label: [idx.vendors.get(idStr(model.vendorId))?.name, model.name].filter(Boolean).join(" ") } : noModel;
        },
        vendor: (row) => {
          const model = modelOf(row);
          if (!model) return noModel;
          const vendor = idx.vendors.get(idStr(model.vendorId));
          return vendor ? { key: idStr(vendor), label: vendor.name } : none;
        },
        company: (row) => {
          const c = row.companyId && companyById.get(idStr(row.companyId));
          return c ? { key: idStr(c), label: companyLabel(c) } : none;
        },
        location: (row) => {
          const l = row.locationId && placeById.get(idStr(row.locationId));
          return l ? { key: idStr(l), label: placeLabel(l) } : none;
        },
      };
      const stats = aggregateInventoryStats(rows, { groupBy, label: labelers[groupBy] });
      const summary = [
        companyRow && `company: ${companyRow.alias || companyRow.fullTitle}`,
        typeRow && `type: ${typeRow.name}`,
        status && `status: ${status}`,
        rootOnly ? "root devices only" : "components included",
      ].filter(Boolean).join(", ");
      return textResult(formatInventoryStats(stats, { groupBy, summary }));
    },

    findings: async (args = {}, caller, context = {}) => {
      const started = Date.now();
      const fail = (kind, error) => {
        logCall(caller, TOOL_NAMES.findings, { error: kind }, started);
        return errorResult(error);
      };
      const kind = cleanString(args.kind, 40) || "summary";
      const names = FINDING_KINDS.map((k) => k.kind);
      if (kind !== "summary" && !names.includes(kind)) return fail("kind", `Unknown kind "${kind}". Use one of: summary, ${names.join(", ")}.`);
      const days = Number.isInteger(args.days) ? clampInt(args.days, 1, 3650) : undefined;
      const limit = clampInt(args.limit, 1, 100, 20);
      const wanted = FINDING_KINDS.filter((k) => kind === "summary" || k.kind === kind);
      const wants = (list) => wanted.some((k) => list.includes(k.kind));

      const filter = {};
      const company = cleanString(args.company);
      let companyLabel = "";
      if (company) {
        const dir = await source.loadDirectory();
        const r = resolveOne(dir.companies, company, "company", COMPANY_RULE);
        if (r.error) return fail("company", r.error);
        filter.companyId = idStr(r.item);
        companyLabel = r.item.alias || r.item.fullTitle;
      }
      const [{ catalog, models, configs, builds, idx }, rows] = await Promise.all([
        loadIndex({ builds: wants([...KINDS_WITH_BUILDS, ...KINDS_WITH_COMPONENTS]) }),
        source.deviceRows(filter),
      ]);
      const asOf = now();
      const systemUserIds = [context.systemAccounts?.unidentifiedId, ...(context.systemAccounts?.robotIds || [])].filter(Boolean);
      const selfBuilt = rows.filter((r) => !r.deviceModelId && !r.parentDeviceId).map((r) => r._id);
      const ticketDays = days ?? TICKET_DAYS;
      const [components, tickets] = await Promise.all([
        wants(KINDS_WITH_COMPONENTS) && selfBuilt.length ? source.loadComponents(selfBuilt) : [],
        wants(KINDS_WITH_TICKETS) && rows.length
          ? source.loadTicketsForDevices(rows, { from: new Date(asOf.getTime() - ticketDays * 86400000), systemUserIds })
          : [],
      ]);
      const data = { rows, catalogIdx: idx, models, configs, links: catalog.links ?? [], builds, components, tickets, systemUserIds };

      const results = wanted.map((k) => ({ kind: k.kind, ...k.check(data, { now: asOf, days, limit: kind === "summary" ? 0 : limit }) }));
      logCall(caller, TOOL_NAMES.findings, { kind, results: results.reduce((sum, r) => sum + r.count, 0) }, started);

      const lineOf = (r) => {
        const spec = wanted.find((k) => k.kind === r.kind);
        const window = spec.window ? ` (${spec.window(days)})` : "";
        if (r.kind === "ticketHeavy") return `- ticketHeavy${window}: top list — ask for this kind`;
        return `- ${r.kind}${window}: ${r.count}${r.note ? ` (${r.note})` : ""}`;
      };
      const scopeOf = (r) => wanted.find((k) => k.kind === r.kind).scope;
      if (kind === "summary") {
        const devicesPart = results.filter((r) => scopeOf(r) === "devices").map(lineOf);
        const catalogPart = results.filter((r) => scopeOf(r) === "catalog").map(lineOf);
        const catalogHeader = company ? "Catalog (whole helpdesk, the company filter does not apply)" : "Catalog";
        return textResult(
          [
            `Fleet findings: ${rows.length} devices checked. Ask for one kind to see the items.`,
            `${company ? `Devices of ${companyLabel}` : "Devices"}:`,
            ...devicesPart,
            `${catalogHeader}:`,
            ...catalogPart,
          ].join("\n"),
        );
      }
      const [only] = results;
      if (!only.count) return textResult(`${kind}: 0. Nothing found.${company && scopeOf(only) === "catalog" ? " The company filter does not apply to catalog findings." : ""}`);
      const cut = truncationLine(only.items.length, only.count, "Narrow with company, or raise limit.");
      const scopeNote = company && scopeOf(only) === "catalog" ? " The company filter does not apply to catalog findings." : "";
      const head = kind === "ticketHeavy" ? `Top devices and models by tickets${only.note ? ` (${only.note})` : ""}.${scopeNote}` : `${kind}: ${only.count} found${only.note ? ` (${only.note})` : ""}.${scopeNote}`;
      return textResult([head, only.items.map((i) => `- ${i.line}`).join("\n"), cut].filter(Boolean).join("\n\n"));
    },
  };
};

module.exports = { createInventoryTools, TOOL_NAMES, parseDeviceRef, buildDeviceFilter };
