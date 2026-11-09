// Идентификаторы соответствуют frontend/components/Dashboard/layout.ts.
// Настройка меняет только показ: доступ к данным проверяют API самих блоков.
const WIDGETS = {
  staff: [
    "team",
    "today",
    "agentChanges",
    "templates",
    "userReview",
    "tickets",
    "expiry",
    "knowledge",
    "monitoring",
    "upcoming",
    "report",
  ],
  client: ["templates", "tickets", "workplace", "support", "expiry"],
};
const ZONES = ["top", "main", "aside"];
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hasOnly = (value, keys) =>
  Object.keys(value).every((key) => keys.includes(key));

/** Parse an untrusted update-account field before any profile mutation. */
const parseDashboardLayout = (value, audience) => {
  if (value === null) return null;
  const allowed = WIDGETS[audience];
  if (
    !isRecord(value) ||
    !hasOnly(value, ["customOrder", "widgets"]) ||
    typeof value.customOrder !== "boolean" ||
    !Array.isArray(value.widgets) ||
    value.widgets.length > allowed.length
  ) {
    throw new Error("Некорректная настройка Главной");
  }
  const seen = new Set();
  const widgets = value.widgets.map((widget) => {
    if (
      !isRecord(widget) ||
      !hasOnly(widget, ["id", "zone", "visible"]) ||
      !allowed.includes(widget.id) ||
      seen.has(widget.id) ||
      !ZONES.includes(widget.zone) ||
      typeof widget.visible !== "boolean"
    ) {
      throw new Error("Некорректная настройка виджета Главной");
    }
    seen.add(widget.id);
    return { id: widget.id, zone: widget.zone, visible: widget.visible };
  });
  return { customOrder: value.customOrder, widgets };
};

const currentDashboardLayout = (user) => {
  const layout =
    user.dashboardLayout?.[user.isEndUser !== false ? "client" : "staff"];
  return layout
    ? {
        customOrder: layout.customOrder,
        widgets: layout.widgets.map(({ id, zone, visible }) => ({
          id,
          zone,
          visible,
        })),
      }
    : null;
};

const DASHBOARD_WIDGET_IDS = [...new Set(Object.values(WIDGETS).flat())];

module.exports = {
  parseDashboardLayout,
  currentDashboardLayout,
  DASHBOARD_WIDGET_IDS,
};
