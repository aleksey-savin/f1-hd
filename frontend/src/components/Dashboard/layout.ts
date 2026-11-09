import type {
  DashboardAudience,
  DashboardLayout,
  DashboardWidget,
  DashboardWidgetId,
  DashboardZone,
} from "../../types/dashboard.ts";
import type { Can } from "../../lib/access.ts";

// Stable IDs also validated by backend/services/dashboardLayout.js.
export const WIDGET_LABELS: Record<DashboardWidgetId, string> = {
  team: "Команда сейчас",
  today: "Сегодня в плане",
  agentChanges: "Запросы ИИ-агентов",
  userReview: "Пользователи ждут проверки",
  templates: "Шаблоны заявок",
  tickets: "Заявки",
  expiry: "Сроки на исходе",
  knowledge: "База знаний ждёт внимания",
  monitoring: "Мониторинг",
  upcoming: "Дальше в плане",
  report: "Отчёт за месяц",
  workplace: "Моё рабочее место",
  support: "Кто ведёт вашу компанию",
};
export const ZONE_LABELS: Record<DashboardZone, string> = {
  top: "Вверху страницы",
  main: "Основная колонка",
  aside: "Правая колонка",
};
export const ZONES: readonly DashboardZone[] = ["top", "main", "aside"];
const STAFF: readonly (readonly [DashboardWidgetId, DashboardZone])[] = [
  ["team", "top"],
  ["today", "top"],
  ["agentChanges", "main"],
  ["templates", "main"],
  ["userReview", "main"],
  ["tickets", "main"],
  ["expiry", "main"],
  ["knowledge", "main"],
  ["monitoring", "main"],
  ["upcoming", "aside"],
  ["report", "aside"],
];
const CLIENT: readonly (readonly [DashboardWidgetId, DashboardZone])[] = [
  ["templates", "top"],
  ["tickets", "main"],
  ["workplace", "main"],
  ["support", "aside"],
  ["expiry", "aside"],
];
const COMPACT = new Set<DashboardWidgetId>([
  "expiry",
  "knowledge",
  "monitoring",
]);

export function defaultLayout(audience: DashboardAudience): DashboardLayout {
  return {
    customOrder: false,
    widgets: (audience === "staff" ? STAFF : CLIENT).map(([id, zone]) => ({
      id,
      zone,
      visible: true,
    })),
  };
}

/** Keep choices even while permissions/modules hide a widget; append new widgets. */
export function reconcileLayout(
  saved: DashboardLayout | null | undefined,
  audience: DashboardAudience,
): DashboardLayout {
  const defaults = defaultLayout(audience);
  if (!saved) return defaults;
  const allowed = new Set(defaults.widgets.map((widget) => widget.id));
  const seen = new Set<DashboardWidgetId>();
  const widgets = saved.widgets
    .filter((widget) => {
      if (!allowed.has(widget.id) || seen.has(widget.id)) return false;
      seen.add(widget.id);
      return true;
    })
    .map((widget) => ({ ...widget }));
  return {
    customOrder: saved.customOrder,
    widgets: [
      ...widgets,
      ...defaults.widgets.filter((widget) => !seen.has(widget.id)),
    ],
  };
}

function viewportOrder(
  layout: DashboardLayout,
  mobile: boolean,
): DashboardWidget[] {
  const widgets = [...layout.widgets];
  if (mobile && !layout.customOrder) {
    const templates = widgets.findIndex(
      (widget) => widget.id === "templates" && widget.zone === "main",
    );
    const tickets = widgets.findIndex(
      (widget) => widget.id === "tickets" && widget.zone === "main",
    );
    if (templates >= 0 && tickets > templates) {
      const [widget] = widgets.splice(templates, 1);
      widgets.splice(tickets, 0, widget);
    }
  }
  return widgets;
}

export function visibleWidgets(
  layout: DashboardLayout,
  available: ReadonlySet<DashboardWidgetId>,
  mobile: boolean,
): DashboardWidget[] {
  return viewportOrder(layout, mobile).filter(
    (widget) =>
      widget.visible &&
      available.has(widget.id) &&
      (widget.id !== "team" || mobile),
  );
}

export function moveWidget(
  layout: DashboardLayout,
  id: DashboardWidgetId,
  zone: DashboardZone,
  beforeId: DashboardWidgetId | null = null,
  mobile = false,
): DashboardLayout {
  if (beforeId === id) return layout;
  const ordered = viewportOrder(layout, mobile);
  const current = ordered.find((widget) => widget.id === id)!;
  const widgets = ordered.filter((widget) => widget.id !== id);
  let index = beforeId
    ? widgets.findIndex(
        (widget) => widget.id === beforeId && widget.zone === zone,
      )
    : -1;
  if (index < 0) {
    let last = -1;
    widgets.forEach((widget, position) => {
      if (widget.zone === zone) last = position;
    });
    index = last < 0 ? widgets.length : last + 1;
  }
  widgets.splice(index, 0, { ...current, zone });
  return { customOrder: true, widgets };
}

export function stepWidget(
  layout: DashboardLayout,
  id: DashboardWidgetId,
  direction: -1 | 1,
  available: ReadonlySet<DashboardWidgetId>,
  mobile: boolean,
): DashboardLayout {
  const current = layout.widgets.find((widget) => widget.id === id)!;
  const peers = visibleWidgets(layout, available, mobile).filter(
    (widget) => widget.zone === current.zone,
  );
  const target =
    peers[peers.findIndex((widget) => widget.id === id) + direction];
  if (!target) return layout;
  const widgets = viewportOrder(layout, mobile);
  const a = widgets.findIndex((widget) => widget.id === id);
  const b = widgets.findIndex((widget) => widget.id === target.id);
  [widgets[a], widgets[b]] = [widgets[b], widgets[a]];
  return { customOrder: true, widgets };
}

export function toggleWidget(
  layout: DashboardLayout,
  id: DashboardWidgetId,
): DashboardLayout {
  return {
    ...layout,
    widgets: layout.widgets.map((widget) =>
      widget.id === id ? { ...widget, visible: !widget.visible } : widget,
    ),
  };
}

/** Only adjacent compact widgets share a grid; moving a widget splits the group. */
export function groupWidgets(widgets: DashboardWidget[]): DashboardWidget[][] {
  const groups: DashboardWidget[][] = [];
  for (const widget of widgets) {
    const last = groups.at(-1);
    if (
      COMPACT.has(widget.id) &&
      last &&
      last.every((item) => COMPACT.has(item.id))
    )
      last.push(widget);
    else groups.push([widget]);
  }
  return groups;
}

/** Internal reordering must not remount the group or its focused controls. */
export function widgetGroupKey(widgets: DashboardWidget[]): string {
  return widgets
    .map((widget) => widget.id)
    .sort()
    .join(":");
}

export function dataRequirements(
  layout: DashboardLayout,
  available: ReadonlySet<DashboardWidgetId>,
) {
  const active = new Set(
    layout.widgets
      .filter((widget) => widget.visible && available.has(widget.id))
      .map((widget) => widget.id),
  );
  return {
    tickets: active.has("tickets"),
    templates: active.has("templates"),
    plan: active.has("today") || active.has("upcoming"),
  };
}

export function availableWidgets({
  audience,
  modules,
  can,
  hideWorkStatus = false,
}: {
  audience: DashboardAudience;
  modules: Partial<
    Record<
      "inventory" | "finances" | "timeTracking" | "mikrotik",
      { isActive?: boolean }
    >
  >;
  can: Can;
  hideWorkStatus?: boolean;
}): Set<DashboardWidgetId> {
  if (audience === "client")
    return new Set<DashboardWidgetId>([
      "templates",
      "tickets",
      "support",
      "expiry",
      ...(modules.inventory?.isActive ? ["workplace" as const] : []),
    ]);
  const ids = new Set<DashboardWidgetId>(["tickets", "expiry"]);
  if (can({ userReview: ["read"] })) ids.add("userReview");
  if (!hideWorkStatus) ids.add("team");
  if (modules.timeTracking?.isActive && can({ work: ["read"] })) {
    ids.add("today");
    ids.add("upcoming");
  }
  if (modules.mikrotik?.isActive || modules.inventory?.isActive)
    ids.add("agentChanges");
  if (can({ ticket: ["createForOthers"] })) ids.add("templates");
  if (can({ knowledge: ["moderate"] })) ids.add("knowledge");
  if (modules.mikrotik?.isActive && can({ mikrotik: ["read"] }))
    ids.add("monitoring");
  if (
    modules.finances?.isActive &&
    (can({ report: ["own"] }) || can({ report: ["employees"] }))
  )
    ids.add("report");
  return ids;
}
