export type DashboardAudience = "staff" | "client";
export type DashboardZone = "top" | "main" | "aside";
export type DashboardWidgetId =
  | "team"
  | "today"
  | "agentChanges"
  | "userReview"
  | "templates"
  | "tickets"
  | "expiry"
  | "knowledge"
  | "monitoring"
  | "upcoming"
  | "report"
  | "workplace"
  | "support";

export type DashboardWidget = {
  id: DashboardWidgetId;
  zone: DashboardZone;
  visible: boolean;
};

/** Current audience's layout. null means the role-specific defaults. */
export type DashboardLayout = {
  customOrder: boolean;
  widgets: DashboardWidget[];
};
