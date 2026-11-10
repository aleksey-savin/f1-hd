const { fail } = require("./policy");
const AGENTS = ["disabled", "restartRequired", "responding", "notResponding", "notInstalled", "unknown", "notApplicable"];
const monitoringState = (resource, now = new Date()) => {
  if (resource.monitoringEnabled === false || resource.connectionId?.monitoringEnabled === false) return "disabled";
  if (resource.lastError || !resource.lastCheckedAt || +now - new Date(resource.lastCheckedAt) >= 180000) return "unknown";
  if (resource.template) return "template";
  if (["running", "online", "available"].includes(resource.status)) return "up";
  if (resource.status === "stopped") return "stopped";
  if (["offline", "unavailable"].includes(resource.status)) return "down";
  return "unknown";
};
const and = (filter, condition) => { (filter.$and ||= []).push(condition); };
const applyMonitoringFilters = (filter, query, kind, now = new Date(), disabledConnectionIds = []) => {
  if (kind === "guests" && query.agent) {
    if (!AGENTS.includes(query.agent)) fail("Неизвестное состояние агента");
    if (query.agent === "unknown") and(filter, { $or: [{ "guestAgent.state": "unknown" }, { "guestAgent.state": null }] });
    else filter["guestAgent.state"] = query.agent;
  }
  if (kind === "guests" && query.os) {
    if (String(query.os).length > 300) fail("Некорректный фильтр гостевой ОС");
    if (query.os === "unknown") and(filter, { $or: [{ "guestOs.name": null }, { "guestOs.name": "" }] });
    else filter["guestOs.name"] = String(query.os);
  }
  if (!["guests", "nodes"].includes(kind) || !query.state) return;
  const state = String(query.state);
  if (!["disabled", "unknown", "up", "down", "stopped", "template"].includes(state)) fail("Неизвестное состояние мониторинга");
  if (state === "disabled") {
    and(filter, { $or: [{ monitoringEnabled: false }, { connectionId: { $in: disabledConnectionIds } }] });
    return;
  }
  if (disabledConnectionIds.length) and(filter, { connectionId: { $nin: disabledConnectionIds } });
  filter.monitoringEnabled = { $ne: false };
  if (state === "unknown") {
    and(filter, { $or: [{ lastError: { $nin: [null, ""] } }, { lastCheckedAt: null }, { lastCheckedAt: { $lte: new Date(+now - 180000) } }, { template: { $ne: true }, status: { $nin: ["running", "online", "available", "stopped", "offline", "unavailable"] } }] });
    return;
  }
  filter.lastCheckedAt = { $gt: new Date(+now - 180000) };
  filter.lastError = { $in: [null, ""] };
  filter.template = state === "template" ? true : { $ne: true };
  if (state === "up") filter.status = kind === "guests" ? "running" : "online";
  if (state === "stopped") filter.status = "stopped";
  if (state === "down") filter.status = { $in: ["offline", "unavailable"] };
};
module.exports = { applyMonitoringFilters, monitoringState };
