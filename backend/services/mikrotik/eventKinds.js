// Каталог событий журнала устройства Mikrotik: вид → группа фильтра и тон по умолчанию.
// Вид хранится в документе явно (models/mikrotikEvent.js) — по тексту события ничего не определяется.
// Зеркало с подписями и значками для портала — frontend/src/util/mikrotik-events.js,
// английские подписи для агента — services/mcp/mikrotikEventTools.js.
const GROUPS = ["link", "power", "config", "record", "agent", "router"];
const SEVERITIES = ["info", "ok", "warning", "danger"];

const kind = (group, severity = "info") => ({ group, severity });

const KINDS = {
  // Связь
  offline: kind("link", "danger"),
  recovered: kind("link", "ok"),
  // Питание и прошивка
  reboot: kind("power"),
  firmwareChanged: kind("power"),
  identityChanged: kind("power"),
  serialChanged: kind("power", "warning"),
  upgradeStarted: kind("power"),
  upgradeFinished: kind("power", "ok"),
  upgradeFailed: kind("power", "danger"),
  upgradeCancelled: kind("power", "warning"),
  // Конфигурация
  configChanged: kind("config"),
  exportCreated: kind("config"),
  exportDeleted: kind("config"),
  exportDownloaded: kind("config"),
  scheduleChanged: kind("config"),
  // Запись в HD
  recordCreated: kind("record"),
  parametersChanged: kind("record"),
  monitoringOn: kind("record"),
  monitoringOff: kind("record"),
  plannedOfflineChanged: kind("record"),
  inventoryLinked: kind("record"),
  pinned: kind("record"),
  // ИИ-агенты
  changeProposed: kind("agent"),
  changeRefused: kind("agent", "warning"),
  changeConfirmed: kind("agent"),
  changeApproved: kind("agent"),
  changeRejected: kind("agent", "warning"),
  changeCancelled: kind("agent"),
  changeApplied: kind("agent", "ok"),
  changeRolledBack: kind("agent", "warning"),
  changeNotApplied: kind("agent", "warning"),
  changeNeedsAttention: kind("agent", "danger"),
  changeExpired: kind("agent"),
  agentAccess: kind("agent"),
  // Лог роутера
  routerConfig: kind("router"),
  routerLogin: kind("router"),
  routerLoginFailed: kind("router", "warning"),
  routerSystem: kind("router"),
  routerCritical: kind("router", "danger"),
  routerMore: kind("router"),
};

const KIND_NAMES = Object.keys(KINDS);

module.exports = { GROUPS, SEVERITIES, KINDS, KIND_NAMES };
