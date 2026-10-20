// Предложение ИИ-агента по инвентарю, как его отдаёт портал
// (backend/services/inventory/changeView.js, toView).

export type InventoryChangeStatus =
  | "awaiting_requester"
  | "applying"
  | "done"
  | "partial"
  | "failed"
  | "rejected"
  | "expired";

export type InventoryChangePerson = { _id: string; name: string };

/** Ссылка внутри текста операции: подпись и документ, на который она указывает. */
export type InventoryChangeLink = { model: string; id: string; label: string };

/** Созданное операцией; `to` бэкенд уже разрешил (нет — документ удалён или ссылки нет). */
export type InventoryChangeCreated = InventoryChangeLink & { to?: string };

export type InventoryChangeCreatedItem = InventoryChangeCreated & {
  kindLabel?: string;
};

export type InventoryChangeResultState =
  | "pending"
  | "done"
  | "failed"
  | "skipped";

export type InventoryChangeOperation = {
  index: number;
  head: string;
  subs: string[];
  // Таблица полей; у старых предложений пусто. before — «было» (проверка изменения)
  fields: { label: string; value: string; before?: string }[];
  links: InventoryChangeLink[];
  deferred: boolean;
  result: {
    state: InventoryChangeResultState;
    error?: string;
    created: InventoryChangeCreated[];
  };
};

export type InventoryChangeCreateCounts = {
  type: number;
  attribute: number;
  group: number;
  vendor: number;
  supplier: number;
  model: number;
  configuration: number;
  build: number;
  device: number;
};

export type InventoryChangeSummary = {
  create: InventoryChangeCreateCounts;
  // names — только когда устройств немного и подпись есть у каждого
  change: { count: number; names?: string[] };
};

export type InventoryChangeView = {
  _id: string;
  title: string;
  reason: string;
  status: InventoryChangeStatus;
  statusLabel: string;
  // Применение прервано: итог неизвестен
  stuck: boolean;
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
  requestedBy: InventoryChangePerson | null;
  agentName: string;
  decision: {
    decision: "approve" | "reject";
    channel?: string;
    comment?: string;
    at?: string;
  } | null;
  operations: InventoryChangeOperation[];
  created: InventoryChangeCreatedItem[];
  summary: InventoryChangeSummary;
  timeline: { at: string; text: string }[];
  my: { canDecide: boolean };
};
