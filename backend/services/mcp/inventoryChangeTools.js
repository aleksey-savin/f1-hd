const { STATUS } = require("../inventory/changeSteps");
const { present } = require("../inventory/changeRender");
const { iso } = require("./text");
const { safeLine } = require("./mikrotikFormat");

/**
 * Инструменты предложений по инвентарю для ИИ-агента: предложить пакет
 * операций, узнать статус, перечислить. Применить агент ничего не может —
 * только предложить; проверка пакета целиком в services/inventory/changeProposals.js,
 * утверждает заявитель. Наружу не уходят id пользователей, Telegram-id и id ключа.
 * Доступ к данным (store) приходит аргументом; mongoChangeStore — единственное
 * место с моделями, они подключаются лениво.
 */

const MAX_LIMIT = 20;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const NUMBER = /^\d{1,9}$/;
const FAILED = "The helpdesk could not create the proposal because of an internal error. Try again later.";

// Виды операций (зеркало реестра services/inventory/changeOps.js; сверяется тестом)
const KIND_NAMES = Object.freeze([
  "catalog",
  "createVendor",
  "createSupplier",
  "createModel",
  "createConfiguration",
  "createBuild",
  "createDevice",
  "updateDevice",
  "assignDevice",
  "moveDevice",
  "setDeviceStatus",
  "attachComponent",
  "detachComponent",
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
  "mergeVendors",
  "mergeSuppliers",
  "mergeGroups",
  "mergeModels",
  "mergeAttributes",
  "mergeConfigurations",
  "mergeDeviceTypes",
  "retireVendor",
  "retireSupplier",
  "retireModel",
  "retireAttribute",
  "retireDeviceType",
  "deleteGroup",
]);

// По строке на вид (одинаковые параметры — общей строкой «kindA, kindB: …»): агент платит этим текстом на каждом ходу
const PROPOSE_DESCRIPTION = [
  "Propose a package of inventory operations (at most 40, applied in order). Nothing changes until the requester approves it in Telegram. An operation using a ref, or a device changed by an earlier operation, is fully checked only at approval. Params per kind (* required); an entity param is a 24-hex id or {\"ref\":\"<ref>\"} of an earlier operation, or {\"ref\":\"<catalog ref>\",\"key\":\"<key>\"} for a type/attribute of a catalog operation. Statuses: readyForDeployment, deployed, inReserve, inRepair, decommissioned, disposed.",
  "catalog: groups[{key,name,order}], types[{key,name,flags,attributes[{attr,group,required}],assembly}], attributes[{key,code,name,valueType,unit,options}]; add-only. flags is {isComponent,isConsumable,isPeripheral}, assembly is {slots,keySpecs}. attr/group/type inside a catalog are keys of its own lists; to use an existing type or attribute, list it with the same name or code - it is reused, not duplicated",
  "createVendor: name*",
  "createSupplier: name*, inn, kpp, website, notes",
  "createModel: type*, vendor*, name*, notes",
  "createConfiguration: model*, name*, description, values[{attribute*, value}]; attribute is the attribute code",
  "createBuild: type*, name*, parts[{type*, model*, configuration, quantity}], notes",
  "createDevice: deviceModelId, configurationId, deviceTypeId, companyId, locationId, userId, parentDeviceId, buildId, supplierId, status, inventoryNumber, serialNumber, hostname, ipAddress, macAddress, operatingSystem, quantity, purchasedAt, price, purchaseDocument, warrantyExpirationDate, lastMaintenanceDate, notes, parts[{typeId*, deviceModelId*, configurationId, serialNumber, purchasedAt, warrantyExpirationDate, supplierId}]; companyId (or parentDeviceId) and deviceModelId or deviceTypeId are needed; a part (parentDeviceId) takes the host's company, location, user and status; parts is for a self-built PC",
  "updateDevice: device*, serialNumber, inventoryNumber, hostname, ipAddress, operatingSystem, purchasedAt, price, supplierId, purchaseDocument, warrantyExpirationDate, deploymentDate, nextMaintenanceDate, comment, configurationId",
  "assignDevice: device*, user*, withComponents, exceptComponentIds; user null clears",
  "moveDevice: device*, location*, withComponents, exceptComponentIds; location null clears",
  "setDeviceStatus: device*, status*, withComponents, exceptComponentIds",
  "attachComponent: host*, component*",
  "detachComponent: host*, component*",
  "Catalog edits: id is an existing record (no ref); give only what changes; isActive false hides, true restores.",
  "updateVendor: id*, name, isActive",
  "updateSupplier: id*, name, isActive, website, inn, kpp, notes",
  "updateModel: id*, name, vendorId, notes, compatibleWithModelIds; the id list replaces the old one",
  "updateDeviceType: id*, name, isActive, isComponent, isConsumable, isPeripheral, inventoryPrefix, attachableToTypeIds",
  "updateGroup: id*, name, order",
  "updateAttribute: id*, name, unit, isActive, addOptions, renameOptions[{from*, to*}]",
  "updateTypeAttribute: type*, attribute*, required, order, groupId",
  "unlinkAttribute: type*, attribute*; refused while configurations hold a value",
  "updateConfiguration: id*, name, description, setValues[{attribute*, value*}], clearValues; attribute and clearValues are attribute codes (ids in the two lines above)",
  "updateBuild: id*, name, notes, parts[{type*, model*, configuration, quantity}]; parts replaces the list",
  "mergeVendors, mergeSuppliers, mergeGroups, mergeModels, mergeConfigurations, mergeDeviceTypes: source*, target*",
  "mergeAttributes: source*, target*, optionMap; optionMap is {source option: target option}, an unmapped option is added to the target",
  "retireVendor, retireSupplier, retireModel, retireAttribute, retireDeviceType, deleteGroup: id*",
  "A merge moves all references to target, then hides source (deletes a group); retire hides an unused record, deleteGroup an empty group. Live existing ids only, in a package with no other operation on the same records. Different values refuse a merge: fix them by updateConfiguration in a separate proposal first.",
  "Returns the proposal id, status, link, what the requester must do and the reference counts of merges; a refusal lists the reasons.",
].join("\n");

const STATUS_TEXT = {
  [STATUS.awaitingRequester]: "waiting for the requester to approve",
  [STATUS.applying]: "being applied",
  [STATUS.done]: "applied",
  [STATUS.partial]: "applied partially",
  [STATUS.failed]: "not applied",
  [STATUS.rejected]: "rejected",
  [STATUS.expired]: "expired",
};
const CHANNELS = { telegram: "Telegram", portal: "the helpdesk portal" };
const RESULT_TEXT = { done: "done", failed: "failed", skipped: "not run", pending: "not run" };

const oneLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const quoted = (value) =>
  String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `> ${safeLine(line)}`);
const statusText = (status) => (STATUS_TEXT[status] ? `${STATUS_TEXT[status]} (${status})` : oneLine(status) || "unknown");
const changeLink = (baseUrl, id) => `${String(baseUrl || "").replace(/\/+$/, "")}/inventory/changes/${id}`;
// Telegram-id в лог — только последние три цифры
const tail = (value) => `***${String(value ?? "").replace(/\D/g, "").slice(-3)}`;
const errorResult = (text) => ({ isError: true, content: [{ type: "text", text }] });
const textResult = (text) => ({ content: [{ type: "text", text }] });

const createInventoryChangeTools = ({ proposals, store, notifier, baseUrl, log }) => {
  const logCall = (caller, tool, meta, started) =>
    log("info", "MCP tool call", { mcpKeyId: caller?.keyId, mcpKeyName: caller?.keyName, tool, ...meta, durationMs: Date.now() - started });

  // Текст операции собран HD по проверенной структуре (имена сущностей в «»): первая строка —
  // заголовок, остальные (записи каталога, детали) — подстроки с отступом
  const opLines = (change, withResults) =>
    (change.operations || []).flatMap((op, i) => {
      const [head, ...subs] = String(op.text ?? "").split("\n").map(oneLine).filter(Boolean);
      const lines = [`${i + 1}. ${head || oneLine(op.kind)}`, ...subs.map((sub) => `   - ${sub}`)];
      if (!withResults) return lines;
      lines.push(`   result: ${RESULT_TEXT[op.result?.state] || "not run"}`);
      if (op.result?.error) lines.push(...quoted(op.result.error).map((line) => `   ${line}`));
      if (op.result?.state === "done" && op.result.created) lines.push(`   created: ${oneLine(JSON.stringify(op.result.created)).slice(0, 300)}`);
      // Слияние: перенесённые ссылки по видам (у сбоя — что успело перенестись; остаток доносит новое предложение)
      const moved = Object.entries(op.result?.moved || {}).filter(([, n]) => Number(n) > 0);
      if (moved.length) lines.push(`   moved: ${moved.map(([label, n]) => `${oneLine(label)} ${Number(n)}`).join(", ").slice(0, 300)}`);
      return lines;
    });

  const propose = async (args, caller) => {
    const started = Date.now();
    const meta = { operations: Array.isArray(args?.operations) ? args.operations.length : 0, requester: tail(args?.requester) };
    let result;
    try {
      result = await proposals.propose(args, caller);
    } catch (error) {
      log("error", "MCP: inventory proposal failed", { mcpKeyId: caller?.keyId, error: String(error?.message || error).slice(0, 200) });
      return errorResult(FAILED);
    }
    if (!result.ok) {
      logCall(caller, "propose_inventory_change", { ...meta, outcome: "refused" }, started);
      const reasons = Array.isArray(result.reasons) && result.reasons.length ? result.reasons : [{ text: result.error || "unknown reason" }];
      // Причина HD может быть многострочной (конфликты слияния — перечень конфигураций): подстроки с отступом
      const reasonLines = (value) => {
        const [head, ...subs] = String(value ?? "").split(/\r?\n/).map(oneLine).filter(Boolean);
        return [`- ${head ?? ""}`, ...subs.map((sub) => `  ${sub}`)];
      };
      const lines = reasons.flatMap((r) => [...reasonLines(r.text), ...(r.quoted ? quoted(r.quoted).map((line) => `  ${line}`) : [])]);
      return errorResult(["The proposal was not created:", ...lines].join("\n"));
    }
    const { change } = result;
    logCall(caller, "propose_inventory_change", { ...meta, outcome: `created ${change._id}` }, started);
    // Предложение уже создано: сбой уведомления его не отменяет, в журнал — только текст ошибки.
    // proposed отдаёт число Telegram-сообщений в очереди: 0 — кнопок у человека не будет
    let queued = 0;
    try {
      queued = Number(await notifier?.proposed?.(change)) || 0;
    } catch (error) {
      log("warn", "MCP: inventory proposal notification failed", { change: String(change._id), error: String(error?.message || error).slice(0, 200) });
    }
    // Предложение уже сохранено: сбой текста Telegram не должен превратиться в ответ «внутренняя ошибка»
    let fits = false;
    try {
      fits = present(change).fits;
    } catch (error) {
      log("warn", "MCP: inventory proposal message not measured", { change: String(change._id), error: String(error?.message || error).slice(0, 200) });
    }
    const next = !queued
      ? `next: no Telegram message could be sent — the person has no linked Telegram bot (or Telegram notifications are off in the helpdesk); they can approve it in the portal: ${changeLink(baseUrl, change._id)}`
      : fits
        ? "next: the requester must approve in Telegram (buttons on the message sent to them) or reject."
        : "next: the package is too big for Telegram — the requester can approve it in the portal.";
    return textResult(
      [
        `Proposal created: ${safeLine(change.title)}`,
        `id: ${change._id}`,
        `status: ${statusText(change.status)}`,
        next,
        "operations (as validated by the helpdesk):",
        ...opLines(change, false),
        // Ссылка на страницу предложения в портале: человек утверждает и там
        `link: ${changeLink(baseUrl, change._id)}`,
        `expires: ${iso(change.expiresAt)}`,
        "",
        "Nothing is changed until the requester approves. Follow the status with get_inventory_change.",
      ].join("\n"),
    );
  };

  const get = async (args, caller) => {
    const started = Date.now();
    const query = String(args?.change ?? "").trim();
    const found = NUMBER.test(query) || OBJECT_ID.test(query) ? await store.findChange(NUMBER.test(query) ? query : query.toLowerCase()) : null;
    if (!found) {
      logCall(caller, "get_inventory_change", { change: oneLine(query).slice(0, 40), outcome: "not found" }, started);
      return errorResult(`No proposal matches "${oneLine(query).slice(0, 60)}". Use list_inventory_changes.`);
    }
    logCall(caller, "get_inventory_change", { change: String(found._id), operations: (found.operations || []).length, outcome: found.status }, started);
    const decision = found.decision?.decision
      ? `decision: ${found.decision.decision === "approve" ? "approved" : "rejected"} at ${iso(found.decision.at)} via ${CHANNELS[found.decision.channel] || oneLine(found.decision.channel) || "unknown channel"}`
      : "decision: none yet";
    return textResult(
      [
        `Proposal: ${safeLine(found.title)}`,
        `id: ${found._id}`,
        `status: ${statusText(found.status)}`,
        `created: ${iso(found.createdAt)}; expires: ${iso(found.expiresAt)}`,
        decision,
        "reason (written by the agent):",
        ...quoted(found.reason),
        "operations:",
        ...opLines(found, true),
        `link: ${changeLink(baseUrl, found._id)}`,
      ].join("\n"),
    );
  };

  const list = async (args, caller) => {
    const started = Date.now();
    if (args?.status && !Object.values(STATUS).includes(args.status)) {
      return errorResult(`Unknown status "${oneLine(args.status).slice(0, 40)}". Use one of: ${Object.values(STATUS).join(", ")}.`);
    }
    const limit = Number.isInteger(args?.limit) ? Math.min(Math.max(args.limit, 1), MAX_LIMIT) : MAX_LIMIT;
    const found = await store.listChanges({ status: args?.status || null, limit });
    logCall(caller, "list_inventory_changes", { found: found.length, outcome: "listed" }, started);
    if (!found.length) return textResult("No proposals match.");
    return textResult(
      [
        `Found ${found.length} proposals, newest first:`,
        "",
        ...found.map((c) => [`id ${c._id}`, safeLine(c.title), statusText(c.status), iso(c.createdAt)].join(" · ")),
      ].join("\n"),
    );
  };

  return { propose, get, list };
};

// --- Единственное место с моделями; подключаются лениво, чтобы модуль грузился без базы ---

const mongoChangeStore = {
  async findChange(ref) {
    const InventoryChange = require("@/models/inventory/inventoryChange");
    const filter = NUMBER.test(ref) ? { number: Number(ref) } : { _id: ref };
    // Только предложения агентов (пришли с ключа MCP)
    return InventoryChange.findOne({ ...filter, "requestedVia.keyId": { $exists: true } }).select("-timeline").lean();
  },
  async listChanges({ status, limit }) {
    const InventoryChange = require("@/models/inventory/inventoryChange");
    const filter = { "requestedVia.keyId": { $exists: true }, ...(status ? { status } : {}) };
    return InventoryChange.find(filter).select("-timeline").sort({ createdAt: -1 }).limit(limit).lean();
  },
};

module.exports = { createInventoryChangeTools, mongoChangeStore, KIND_NAMES, PROPOSE_DESCRIPTION, STATUS_TEXT };
