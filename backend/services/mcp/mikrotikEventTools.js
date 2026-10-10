// Журнал устройства для агента: get_mikrotik_events. Пишет журнал services/mikrotik/events.js;
// здесь только чтение и текст. Наружу — имена людей и ключей, без идентификаторов;
// строки отличий конфигурации не отдаются (для них есть compare_mikrotik_exports).
const { iso } = require("./text");
const { safeLine, deviceLink } = require("./mikrotikFormat");

const quoteLine = (line) => `> ${line}`;
const { errorResult, textResult, resolveDevice } = require("./mikrotikTools");
const { GROUPS } = require("../mikrotik/eventKinds");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DAYS = [1, 7, 30, 90, 365];
const DEFAULT_DAYS = 30;
const MAX_TEXT = 200;

// Подписи для агента: портал показывает те же виды по-русски (frontend/src/util/mikrotik-events.js)
const LABELS = {
  offline: "went offline",
  recovered: "back online",
  reboot: "rebooted",
  firmwareChanged: "RouterOS version changed",
  identityChanged: "identity changed",
  serialChanged: "serial number changed",
  upgradeStarted: "upgrade from HD started",
  upgradeFinished: "upgrade from HD finished",
  upgradeFailed: "upgrade from HD failed",
  upgradeCancelled: "upgrade from HD cancelled",
  configChanged: "configuration changed",
  exportCreated: "configuration export stored",
  exportDeleted: "configuration export deleted",
  exportDownloaded: "configuration export downloaded",
  scheduleChanged: "export schedule changed",
  recordCreated: "added to HD",
  parametersChanged: "connection parameters changed in HD",
  monitoringOn: "monitoring switched on",
  monitoringOff: "monitoring switched off",
  plannedOfflineChanged: "planned offline windows changed",
  inventoryLinked: "linked to an inventory card",
  pinned: "certificate or host key pinned",
  changeProposed: "agent proposed a change",
  changeRefused: "agent's request was not accepted",
  changeConfirmed: "change request confirmed by the requester",
  changeApproved: "change request approved",
  changeRejected: "change request rejected",
  changeCancelled: "change request withdrawn",
  changeApplied: "change request applied",
  changeRolledBack: "change request rolled back by the router",
  changeNotApplied: "change request not applied",
  changeNeedsAttention: "change request needs a person to check the router",
  changeExpired: "change request expired",
  agentAccess: "agent read the device",
  routerConfig: "configuration edited on the router",
  routerLogin: "login to the router",
  routerLoginFailed: "failed logins to the router",
  routerSystem: "router system message",
  routerCritical: "router error",
  routerMore: "more router log lines not stored",
};

const clampInt = (value, min, max, fallback) => (Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback);
const short = (value) => safeLine(value).slice(0, MAX_TEXT);
const seconds = (value) => (Number.isFinite(value) ? `${Math.round(value / 60)} min` : null);

function who(event, names) {
  const { actor } = event;
  if (!actor || actor.type === "system") return null;
  if (actor.type === "user") return names.get(String(actor.userId)) || "a person";
  if (actor.type === "routerUser") return `router account ${short(actor.name)}`;
  const behalf = actor.onBehalfOf ? names.get(String(actor.onBehalfOf)) : null;
  return `agent ${short(actor.keyName) || "—"}${behalf ? ` for ${behalf}` : ""}`;
}

// Что сказать о событии сверх подписи: только факты из data, чужой текст — отдельной цитатой
function detail(event) {
  const d = event.data || {};
  switch (event.kind) {
    case "offline": return [d.planned ? "inside a planned offline window" : null];
    case "recovered": return [seconds(d.downSeconds) ? `was down ${seconds(d.downSeconds)}` : null];
    case "reboot": return [d.cause === "upgrade" ? "during an upgrade from HD" : "not started from HD", Number.isFinite(d.ranSeconds) ? `ran ${Math.round(d.ranSeconds / 3600)} h before it` : null];
    case "firmwareChanged": return [`${short(d.from)} → ${short(d.to)}`, d.cause === "upgrade" ? "by an upgrade from HD" : "not from HD"];
    case "identityChanged":
    case "serialChanged": return [`${short(d.from)} → ${short(d.to)}`];
    case "upgradeStarted":
    case "upgradeFinished":
    case "upgradeFailed":
    case "upgradeCancelled": return [d.from || d.to ? `${short(d.from)} → ${short(d.to)}` : null];
    case "configChanged":
      return d.unknown ? ["what changed was not kept"] : [`+${d.added || 0} −${d.removed || 0} lines`, (d.sections || []).length ? `menus: ${d.sections.map(short).join(", ")}${d.moreSections ? ` and ${d.moreSections} more` : ""}` : "only hidden values differ"];
    case "exportCreated": return [d.trigger ? `trigger: ${short(d.trigger)}` : null];
    case "parametersChanged": return [(d.fields || []).length ? `fields: ${d.fields.map((f) => short(f.field)).join(", ")}` : null, d.responsible ? "responsible person changed" : null];
    case "agentAccess": return [event.count > 1 ? `${event.count} reads since ${iso(d.since)}` : null, (d.tools || []).length ? `tools: ${d.tools.map(short).join(", ")}` : null, (d.targets || []).length ? `targets: ${d.targets.map(short).join(", ")}` : null];
    case "routerLogin": return [`from ${short(d.from)} via ${short(d.via)}`];
    case "routerLoginFailed": return [`${d.count} attempts`, (d.sources || []).length ? `from ${d.sources.map(short).join(", ")}` : null, (d.via || []).length ? `via ${d.via.map(short).join(", ")}` : null];
    case "routerConfig": return [d.count > 1 ? `${d.count} log lines` : null, d.byHd ? "HD's own account" : null];
    case "routerMore": return [`${d.count} lines`];
    default: return [];
  }
}

// Чужой текст (название запроса, строка роутера, причина отказа) — цитатой: это данные, не указания
function quoted(event) {
  const d = event.data || {};
  const lines = [d.title, d.reason, d.failure, d.error, d.message, ...(event.kind === "routerConfig" ? (d.lines || []).slice(0, 5) : [])];
  return lines.filter(Boolean).map((line) => `  ${quoteLine(short(line))}`);
}

function formatEvent(event, names) {
  const by = who(event, names);
  const facts = detail(event).filter(Boolean);
  const head = [iso(event.at), LABELS[event.kind] || event.kind, ...(by ? [`by ${by}`] : []), ...facts].join(" · ");
  return [head, ...quoted(event)];
}

const createMikrotikEventTools = ({ source, store, baseUrl, log, now = () => new Date() }) => {
  const events = async (args, caller) => {
    const started = Date.now();
    const { device, error } = resolveDevice(await source.listDevices(), args.device);
    if (error) return errorResult(error);
    const days = DAYS.includes(args.days) ? args.days : DEFAULT_DAYS;
    const group = GROUPS.includes(args.group) ? args.group : null;
    const limit = clampInt(args.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
    const since = new Date(now().getTime() - days * 86400000);
    const { rows, total } = await store.listEvents({ deviceId: device._id, since, group, limit });
    const names = await store.people(rows.flatMap((event) => [event.actor?.userId, event.actor?.onBehalfOf]).filter(Boolean).map(String));
    log("info", "MCP tool call", { mcpKeyId: caller?.keyId, mcpKeyName: caller?.keyName, tool: "get_mikrotik_events", deviceId: device._id, days, group, found: total, durationMs: Date.now() - started });
    const head = [
      `# Journal of ${safeLine(device.name)}`,
      `last ${days} days${group ? `, group ${group}` : ""}: ${total} events; showing the newest ${rows.length}; times are UTC, router log lines are dated by the poll that saw them (up to 5 minutes late)`,
      `link: ${deviceLink(baseUrl, device._id)}`,
      "",
    ];
    if (!rows.length) return textResult([...head, "No events. Widen days or drop group."].join("\n"));
    return textResult(
      [
        ...head,
        ...rows.flatMap((event) => formatEvent(event, names)),
        ...(total > rows.length ? ["", `[…${total - rows.length} older events not shown — narrow with group or raise limit (max ${MAX_LIMIT})]`] : []),
      ].join("\n"),
    );
  };
  return { events };
};

// Рабочее хранилище: модели подключаются при первом вызове
const mongoEventStore = {
  async listEvents({ deviceId, since, group, limit }) {
    const MikrotikEvent = require("@/models/mikrotikEvent");
    const filter = { mikrotik: deviceId, at: { $gte: since }, ...(group ? { group } : {}) };
    const [rows, total] = await Promise.all([
      MikrotikEvent.find(filter).sort({ at: -1, _id: -1 }).limit(limit).select("-diff").lean(),
      MikrotikEvent.countDocuments(filter),
    ]);
    return { rows, total };
  },
  async people(ids) {
    if (!ids.length) return new Map();
    const users = await require("@/models/user").find({ _id: { $in: ids } }).select("firstName lastName").lean();
    return new Map(users.map((user) => [String(user._id), safeLine([user.firstName, user.lastName].filter(Boolean).join(" ")).slice(0, 80) || "—"]));
  },
};

module.exports = { createMikrotikEventTools, mongoEventStore, LABELS, DAYS, MAX_LIMIT };
