const { STATUS, currentStep, isOpen } = require("../mikrotik/changeSteps");
const { iso } = require("./text");
const { safeLine } = require("./mikrotikFormat");
const { errorResult, textResult, resolveDevice } = require("./mikrotikTools");

/**
 * Инструменты запросов на изменение Mikrotik для ИИ-агента: предложить, узнать
 * статус, перечислить. Применить агент ничего не может — только предложить;
 * проверка предложения целиком в services/mikrotik/changeProposals.js.
 * Наружу не уходят id пользователей, Telegram-id, id ключа и ключи WireGuard.
 * Доступ к данным (store) приходит аргументом; mongoChangeStore — единственное
 * место с моделями, они подключаются лениво.
 */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const NUMBER = /^\d{1,9}$/;

const STATUS_TEXT = {
  [STATUS.awaitingRequester]: "waiting for the requester to confirm",
  [STATUS.awaitingResponsible]: "waiting for the responsible person to approve",
  [STATUS.queued]: "approved, queued to be applied",
  [STATUS.applying]: "being applied",
  [STATUS.applied]: "applied",
  [STATUS.rolledBack]: "rolled back",
  [STATUS.notApplied]: "not applied",
  [STATUS.rejected]: "rejected",
  [STATUS.expired]: "expired",
  [STATUS.cancelled]: "cancelled",
  [STATUS.needsAttention]: "needs checking by a person",
};
const CHANNELS = { portal: "the HD portal", telegram: "Telegram" };
const COMMANDS_LABEL = "commands (as proposed by the agent, validated by HD):";
const RISK_HIGH = "high — may cut the device off";

const oneLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const quoted = (value) =>
  String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `> ${safeLine(line)}`);
const statusText = (status) => STATUS_TEXT[status] || oneLine(status) || "unknown";
const changeLink = (baseUrl, id) => `${String(baseUrl || "").replace(/\/+$/, "")}/devices/mikrotik/changes/${id}`;
// Telegram-id в лог — только последние три цифры
const tail = (value) => `***${String(value ?? "").replace(/\D/g, "").slice(-3)}`;

const createMikrotikChangeTools = ({ proposals, store, notifier, baseUrl, log }) => {
  const logCall = (caller, tool, meta, started) =>
    log("info", "MCP tool call", { mcpKeyId: caller?.keyId, mcpKeyName: caller?.keyName, tool, ...meta, durationMs: Date.now() - started });

  const waitingFor = (change, names) => {
    const step = isOpen(change.status) ? currentStep(change) : null;
    return step ? names.get(String(step.user)) || "—" : null;
  };
  // Имена вводят люди: одна строка, без «секретов», не длиннее 80
  const peopleOf = async (changes) => {
    const raw = await store.people(changes.flatMap((c) => [c.requestedBy, ...(c.steps || []).map((s) => s.user)].filter(Boolean).map(String)));
    return new Map([...raw].map(([id, name]) => [String(id), safeLine(name).slice(0, 80) || "—"]));
  };
  // Чужой текст в причине отказа: одна строка, маска, не длиннее 300
  const quotedReason = (value) => `  > ${safeLine(value).slice(0, 300)}`;
  const deviceName = (devices, id) => {
    const device = devices.find((d) => String(d._id) === String(id));
    return device ? safeLine(device.name || device.label || device.host) : null;
  };

  const commandLines = (change, withResults) =>
    (change.commands || []).flatMap((c, i) => {
      // Строка собрана HD из проверенной структуры: секретов в ней нет, maskText испортил бы interface=wg1
      const head = `${i + 1}. ${oneLine(c.text || `${c.path} ${c.action}`)}`;
      if (!withResults) return [head];
      const state = c.result?.state;
      const lines = [head];
      if (c.risk === "high") lines.push(`   risk: high${c.riskReason ? ` (${oneLine(c.riskReason)})` : ""}`);
      const label = { done: "done", failed: "failed", rolled_back: "rolled back" }[state] || "not run";
      // Ответ роутера — только при его отказе; иначе текст ниже — слова HD (таймаут, не подтверждена)
      const source = state === "failed" && c.result?.error ? (c.result.refused === true ? " (refused by the router)" : " (not confirmed; HD's own note follows)") : "";
      lines.push(`   result: ${label}${source}`);
      if (c.result?.error) lines.push(...quoted(c.result.error).map((line) => `   ${line}`));
      return lines;
    });

  const propose = async (args, caller) => {
    const started = Date.now();
    const result = await proposals.propose(args, caller);
    const meta = { device: oneLine(args?.device).slice(0, 200), commands: Array.isArray(args?.commands) ? args.commands.length : 0, requester: tail(args?.requester) };
    if (!result.ok) {
      logCall(caller, "propose_mikrotik_change", { ...meta, outcome: "refused" }, started);
      const reasons = Array.isArray(result.reasons) && result.reasons.length ? result.reasons : [{ text: result.error || "unknown reason" }];
      const lines = reasons.flatMap((r) => [`- ${oneLine(r.text)}`, ...(r.quoted ? [quotedReason(r.quoted)] : [])]);
      return errorResult(["The request was not created:", ...lines].join("\n"));
    }
    const { change } = result;
    logCall(caller, "propose_mikrotik_change", { ...meta, outcome: `created #${change.number}` }, started);
    // Человек первого шага узнаёт о запросе сразу. Запрос уже создан: сбой уведомления его не отменяет;
    // в журнал — только номер и текст ошибки, без содержимого запроса
    try {
      await notifier?.step?.(change);
    } catch (error) {
      log("warn", "MCP: Mikrotik change notification failed", { change: change.number, error: String(error?.message || error).slice(0, 200) });
    }
    const [names, devices] = await Promise.all([peopleOf([change]), store.listDevices()]);
    return textResult(
      [
        `Request created: ${safeLine(change.title)}`,
        `id: ${change._id}`,
        `status: ${statusText(change.status)}`,
        `waiting for: ${waitingFor(change, names) || "—"}`,
        `device: ${deviceName(devices, change.mikrotik) || safeLine(meta.device)}`,
        `risk: ${change.risk === "high" ? RISK_HIGH : "normal"}`,
        COMMANDS_LABEL,
        ...commandLines(change, false),
        `link: ${changeLink(baseUrl, change._id)}`,
        `expires: ${iso(change.expiresAt)}`,
        "",
        "Nothing is applied until people approve it in HD. Give the link to the person who asked.",
      ].join("\n"),
    );
  };

  // Запрос виден, только если его устройство видят и читающие инструменты
  const load = async (ref) => {
    const query = String(ref ?? "").trim();
    if (!NUMBER.test(query) && !OBJECT_ID.test(query)) return { error: `"${oneLine(query).slice(0, 60)}" is not a request id. Use list_mikrotik_changes.` };
    const found = await store.findChange(NUMBER.test(query) ? query : query.toLowerCase());
    const devices = await store.listDevices();
    if (!found || !deviceName(devices, found.mikrotik)) return { error: `No change request matches "${query}". Use list_mikrotik_changes.` };
    return { change: found, devices };
  };

  const get = async (args, caller) => {
    const started = Date.now();
    const loaded = await load(args?.change);
    if (loaded.error) {
      logCall(caller, "get_mikrotik_change", { change: oneLine(args?.change).slice(0, 40), outcome: "not found" }, started);
      return errorResult(loaded.error);
    }
    const { change, devices } = loaded;
    logCall(caller, "get_mikrotik_change", { change: change.number, device: deviceName(devices, change.mikrotik), commands: (change.commands || []).length, outcome: change.status }, started);
    const names = await peopleOf([change]);
    const waiting = waitingFor(change, names);
    const open = isOpen(change.status);
    const firstOpen = (change.steps || []).findIndex((s) => !s.decision);
    const steps = (change.steps || []).map((s, i) => {
      const who = `${s.role} ${names.get(String(s.user)) || "—"}`;
      if (s.decision) return `- ${who}: ${s.decision === "approve" ? "approved" : "rejected"} at ${iso(s.decidedAt)} via ${CHANNELS[s.channel] || oneLine(s.channel) || "unknown channel"}`;
      return `- ${who}: ${open && i === firstOpen ? "waiting" : "not reached"}`;
    });
    const lines = [
      `Request: ${safeLine(change.title)}`,
      `id: ${change._id}`,
      `status: ${statusText(change.status)}`,
      `device: ${deviceName(devices, change.mikrotik)}`,
      `requester: ${names.get(String(change.requestedBy)) || "—"}`,
      `created: ${iso(change.createdAt)}; expires: ${iso(change.expiresAt)}`,
      `risk: ${change.risk === "high" ? RISK_HIGH : "normal"}`,
      ...(waiting ? [`waiting for: ${waiting}`] : []),
      "reason (written by the agent):",
      ...quoted(change.reason),
      "steps:",
      ...steps,
      COMMANDS_LABEL,
      ...commandLines(change, true),
    ];
    if (change.backupArtifact) {
      const at = await store.artifactTime(change.backupArtifact);
      lines.push(`backup: ${at ? iso(at) : "taken"}`);
    }
    // Заметку пишет HD, но в ней бывает текст роутера или соединения: цитатой, одной строкой
    if (change.failure) lines.push("Note from HD (may quote the device):", `> ${safeLine(change.failure)}`);
    if (change.status === STATUS.needsAttention) {
      lines.push("HD cannot vouch for what is on the device — a person must check it. Do not propose the same change again until they have.");
    }
    if (change.status === STATUS.applied && change.wireguard?.client?.address) {
      const until = change.wireguard.keysExpireAt;
      lines.push(
        until && new Date(until).getTime() > Date.now()
          ? `WireGuard configuration: ${changeLink(baseUrl, change._id)} (sign-in required, available until ${iso(until)})`
          : "WireGuard configuration: no longer available (the keys were erased 24 hours after applying)",
      );
    }
    return textResult(lines.join("\n"));
  };

  const list = async (args, caller) => {
    const started = Date.now();
    if (args?.status && !Object.values(STATUS).includes(args.status)) {
      return errorResult(`Unknown status "${oneLine(args.status).slice(0, 40)}". Use one of: ${Object.values(STATUS).join(", ")}.`);
    }
    const devices = await store.listDevices();
    let deviceId = null;
    if (args?.device) {
      const resolved = resolveDevice(devices, args.device);
      if (resolved.error) return errorResult(resolved.error);
      deviceId = String(resolved.device._id);
    }
    const limit = Number.isInteger(args?.limit) ? Math.min(Math.max(args.limit, 1), MAX_LIMIT) : DEFAULT_LIMIT;
    // Запросы устройств, которых читающие инструменты не покажут, отсеиваем
    const found = (await store.listChanges({ deviceId, status: args?.status || null, limit: MAX_LIMIT * 5 }))
      .filter((c) => deviceName(devices, c.mikrotik))
      .slice(0, limit);
    logCall(caller, "list_mikrotik_changes", { device: deviceId ? deviceName(devices, deviceId) : null, found: found.length, outcome: "listed" }, started);
    if (!found.length) return textResult("No change requests match.");
    const names = await peopleOf(found);
    return textResult(
      [
        `Found ${found.length} change requests, newest first:`,
        "",
        ...found.map((c) =>
          [`id ${c._id}`, safeLine(c.title), statusText(c.status), deviceName(devices, c.mikrotik), iso(c.createdAt), waitingFor(c, names) ? `waiting for: ${waitingFor(c, names)}` : null]
            .filter(Boolean)
            .join(" · "),
        ),
      ].join("\n"),
    );
  };

  return { propose, get, list };
};

// --- Единственное место с моделями; подключаются лениво, чтобы модуль грузился без базы ---

const mongoChangeStore = {
  // Список устройств — тот же, что видят читающие инструменты
  listDevices: () => require("./mikrotikSource").listDevices(),
  async findChange(ref) {
    const MikrotikChange = require("@/models/mikrotikChange");
    const filter = NUMBER.test(ref) ? { number: Number(ref) } : { _id: ref };
    // Запросы приходят только от ключей MCP; секреты WireGuard (select: false) не читаются
    return MikrotikChange.findOne({ ...filter, "requestedVia.keyId": { $exists: true } }).select("-timeline").lean();
  },
  async listChanges({ deviceId, status, limit }) {
    const MikrotikChange = require("@/models/mikrotikChange");
    const filter = { "requestedVia.keyId": { $exists: true }, ...(deviceId ? { mikrotik: deviceId } : {}), ...(status ? { status } : {}) };
    return MikrotikChange.find(filter).select("-timeline").sort({ createdAt: -1 }).limit(limit).lean();
  },
  async people(ids) {
    const User = require("@/models/user");
    const users = await User.find({ _id: { $in: [...new Set(ids)] } }).select("firstName lastName").lean();
    return new Map(users.map((u) => [String(u._id), [u.firstName, u.lastName].filter(Boolean).join(" ") || "—"]));
  },
  async artifactTime(id) {
    const artifact = await require("@/models/mikrotikArtifact").findById(id).select("createdAt").lean();
    return artifact?.createdAt || null;
  },
};

module.exports = { createMikrotikChangeTools, mongoChangeStore, STATUS_TEXT };
