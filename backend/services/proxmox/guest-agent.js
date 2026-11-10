const { Resource, Connection } = require("../../models/proxmox");
const { request } = require("./transport");
const { fail, publicError } = require("./policy");
const settingsKeys = ["enabled", "trimClonedDisks", "freezeFilesystem", "type"];
const parts = (value) => String(value ?? "").split(",").filter(Boolean);
const parseSettings = (value) => {
  const entries = Object.fromEntries(parts(value).map((part) => part.includes("=") ? part.split("=") : ["enabled", part]));
  return {
    enabled: entries.enabled === "1",
    trimClonedDisks: entries.fstrim_cloned_disks === "1",
    freezeFilesystem: (entries["freeze-fs"] ?? entries["freeze-fs-on-backup"] ?? "1") === "1",
    type: entries.type === "isa" ? "isa" : "virtio",
  };
};
const validateSettings = (body) => {
  if (!body || Object.keys(body).some((key) => !settingsKeys.includes(key)) ||
    settingsKeys.slice(0, 3).some((key) => typeof body[key] !== "boolean") || !["virtio", "isa"].includes(body.type))
    fail("Укажите полные параметры QEMU Guest Agent");
  return Object.fromEntries(settingsKeys.map((key) => [key, body[key]]));
};
// The older spelling is supported by PVE 8 and is an explicit alias in PVE 9.
// Preserve options introduced by a newer host when replacing the agent property.
const encodeSettings = (value, settings) => [
  ...parts(value).filter((part) => !/^(?:[01]$|enabled=|fstrim_cloned_disks=|freeze-fs=|freeze-fs-on-backup=|type=)/.test(part)),
  `enabled=${Number(settings.enabled)}`,
  `fstrim_cloned_disks=${Number(settings.trimClonedDisks)}`,
  `freeze-fs-on-backup=${Number(settings.freezeFilesystem)}`,
  `type=${settings.type}`,
].join(",");
const uuidOf = (config) => String(config?.smbios1 || "").match(/(?:^|,)uuid=([^,]+)/)?.[1];
const baseOf = (resource) => `/nodes/${encodeURIComponent(resource.nodeName)}/qemu/${resource.vmid}`;
const osView = (value) => ({
  id: typeof value.id === "string" ? value.id.slice(0, 100) : null,
  name: String(value["pretty-name"] || value.name || "").slice(0, 300) || null,
  version: String(value["version-id"] || value.version || "").slice(0, 100) || null,
  kernel: String(value["kernel-release"] || "").slice(0, 200) || null,
  arch: String(value.machine || "").slice(0, 100) || null,
});
const initial = (resource, now) => ({
  state: resource.guestType === "lxc" ? "notApplicable" : "unknown",
  enabled: null, installed: null, responding: null, requiresRestart: false,
  version: null, settings: null, checkedAt: now, lastError: null,
});
const inspect = async (resource, connection, deps = {}) => {
  const now = deps.now || new Date(), call = deps.request || request;
  const guestAgent = initial(resource, now), result = { guestAgent };
  if (resource.guestType !== "qemu" || resource.archived || resource.template || (resource.monitoringEnabled === false && !deps.desired) || !connection || connection.archived || (connection.monitoringEnabled === false && !deps.desired))
    return result;
  try {
    const base = baseOf(resource);
    const desired = deps.desired || await call(connection, `${base}/config`, { timeout: 5000 });
    const identity = uuidOf(desired);
    // A VMID is reusable. Keep installation/OS evidence only when its UUID is
    // known and still matches the configuration just fetched from the host.
    const sameGuest = Boolean(identity && identity === resource.guestIdentity);
    if (sameGuest) {
      guestAgent.installed = resource.guestAgent?.installed ?? null;
      guestAgent.version = resource.guestAgent?.version ?? null;
    } else result.guestOs = null;
    const configuredOs = {
      l26: "Linux", l24: "Linux 2.4", win11: "Windows 11 / Server 2022+",
      win10: "Windows 10 / Server 2016 / Server 2019", win8: "Windows 8 / Server 2012",
      win7: "Windows 7 / Server 2008 R2", wvista: "Windows Vista / Server 2008",
      wxp: "Windows XP", w2k: "Windows 2000", w2k3: "Windows Server 2003",
      solaris: "Solaris", other: "Другая ОС",
    }[desired.ostype];
    if (sameGuest && resource.guestOs?.name) result.guestOs = resource.guestOs;
    else if (configuredOs) result.guestOs = { id: null, name: configuredOs, version: null, kernel: null, arch: null };
    const settings = parseSettings(desired.agent);
    Object.assign(guestAgent, { enabled: settings.enabled, settings });
    if (resource.status === "running") {
      const current = deps.current || await call(connection, `${base}/config?current=1`, { timeout: 5000 });
      const applied = parseSettings(current.agent);
      guestAgent.requiresRestart = settings.enabled !== applied.enabled || (settings.enabled && settings.type !== applied.type);
    }
    if (!settings.enabled) { guestAgent.state = "disabled"; return result; }
    if (guestAgent.requiresRestart) { guestAgent.state = "restartRequired"; return result; }
    if (resource.status !== "running" || resource.monitoringEnabled === false || connection.monitoringEnabled === false) return result;
    // Try each read independently: an older agent may support OS info even
    // when the info endpoint is denied; any valid reply proves installation.
    let replied = false, lastError;
    try {
      const response = await call(connection, `${base}/agent/info`, { timeout: 5000 });
      const info = response?.result || response;
      if (info && typeof info.version === "string") { guestAgent.version = info.version.slice(0, 100); replied = true; }
    } catch (error) { lastError = error; }
    try {
      const response = await call(connection, `${base}/agent/get-osinfo`, { timeout: 5000 });
      const os = response?.result || response;
      if (os && typeof os.id === "string") { result.guestOs = osView(os); replied = true; }
    } catch (error) { lastError = error; }
    guestAgent.responding = replied;
    guestAgent.state = replied ? "responding" : guestAgent.installed === true ? "notResponding" : "unknown";
    if (replied) guestAgent.installed = true;
    else guestAgent.lastError = lastError ? publicError(lastError) : "Агент не вернул сведения";
  } catch (error) { guestAgent.lastError = publicError(error); }
  return result;
};
const updateSettings = async (resource, connection, body, deps = {}) => {
  const settings = validateSettings(body);
  if (resource.kind !== "guest" || resource.guestType !== "qemu" || resource.template || resource.archived)
    fail("Параметры Guest Agent доступны для ВМ QEMU", 422);
  if (!connection || connection.archived) fail("Подключение недоступно", 409);
  const call = deps.request || request, base = baseOf(resource);
  const config = await call(connection, `${base}/config`, { timeout: 8000 });
  const identity = uuidOf(config);
  if (resource.guestIdentity && identity !== resource.guestIdentity) fail("UUID виртуальной машины изменился. Обновите карточку", 409);
  if (!config.digest || typeof config.digest !== "string") fail("API не вернул версию конфигурации. Повторите загрузку", 409);
  const current = resource.status === "running" ? await call(connection, `${base}/config?current=1`, { timeout: 8000 }) : config;
  const agent = encodeSettings(config.agent, settings);
  await call(connection, `${base}/config`, { method: "PUT", body: { agent, digest: config.digest }, timeout: 10000 });
  return inspect(resource, connection, { ...deps, desired: { ...config, agent }, current });
};
let running = false;
const tick = async () => {
  if (running) return;
  running = true;
  try {
    if (!(await require("./core").enabled())) return;
    const connections = await Connection.find({ archived: false, monitoringEnabled: true }).select("+tokenSecret").lean();
    const byId = new Map(connections.map((item) => [String(item._id), item]));
    const resources = await Resource.find({
      connectionId: { $in: connections.map((item) => item._id) }, kind: "guest", archived: false,
      monitoringEnabled: { $ne: false }, template: { $ne: true },
      $or: [{ "guestAgent.checkedAt": null }, { "guestAgent.checkedAt": { $lt: new Date(Date.now() - 120000) } }],
    }).sort({ "guestAgent.checkedAt": 1, _id: 1 }).limit(6).lean();
    await Promise.allSettled(resources.map(async (resource) => {
      const patch = await inspect(resource, byId.get(String(resource.connectionId)));
      // Avoid persisting a late scan after the operator disables monitoring.
      await Resource.updateOne({ _id: resource._id, monitoringEnabled: { $ne: false }, guestIdentity: resource.guestIdentity ?? null }, { $set: patch });
    }));
    if (resources.length) require("./core").bump();
  } finally { running = false; }
};
module.exports = { parseSettings, encodeSettings, validateSettings, inspect, updateSettings, tick };
