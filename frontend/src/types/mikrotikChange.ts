// Запрос ИИ-агента на изменение Mikrotik, как его отдаёт портал
// (backend/services/mikrotik/changeView.js, toView). Полный вид — заявителю,
// ответственному, решавшим и держателям прав; остальным — сокращённый
// (номер, название, статус, дата, устройство): полей, помеченных «полный вид»,
// у него нет.

export type ChangeStatus =
  | "awaiting_requester"
  | "awaiting_responsible"
  | "queued"
  | "applying"
  | "applied"
  | "rolled_back"
  | "not_applied"
  | "rejected"
  | "expired"
  | "cancelled"
  | "needs_attention";

export type ChangeRisk = "normal" | "high";

export type ChangePerson = { _id: string; name: string };

export type ChangeDiffRow = { field: string; from: string; to: string };

export type ChangeResultState =
  | "pending"
  | "done"
  | "failed"
  | "rolled_back"
  | "skipped";

export type ChangeCommand = {
  path: string;
  action: string;
  text: string;
  risk?: ChangeRisk | string;
  riskReason?: string | null;
  // Строка до изменения: поля без секретов (сервер их вырезает)
  before?: Record<string, unknown> | null;
  diff: ChangeDiffRow[];
  // refused — команде отказал сам роутер (error — его ответ); иначе error — слова HD
  result?: {
    state: ChangeResultState;
    error?: string;
    refused?: boolean;
    at?: string;
  };
};

export type ChangeStep = {
  role: "requester" | "responsible" | string;
  user: ChangePerson | null;
  decision: "approve" | "reject" | null;
  channel?: string;
  comment?: string;
  decidedAt?: string;
};

export type ChangeTimelineEntry = {
  at: string;
  kind?: string;
  user: ChangePerson | null;
  text: string;
};

export type ChangeWireguard = {
  fileName: string;
  publicKey?: string;
  serverPublicKey?: string;
  endpoint?: string;
  keysExpireAt?: string;
  client: {
    interface?: string;
    address?: string;
    allowedIps: string[];
    dns: string[];
    endpoint?: string;
  } | null;
};

export type ChangeMy = {
  step: boolean;
  action: "confirm" | "approve" | null;
  canCancel: boolean;
  canDownload: boolean;
};

export type ChangeView = {
  _id: string;
  number: number;
  title: string;
  status: ChangeStatus;
  statusLabel: string;
  createdAt: string;
  device: { _id: string; name: string; company?: string } | null;
  // Только полный вид
  reason?: string;
  risk?: ChangeRisk;
  executor?: "safe-mode" | "api";
  // Есть ли автоматический откат в действующем режиме исполнителя
  rollback?: boolean;
  expiresAt?: string;
  updatedAt?: string;
  // Время события, закрывшего запрос (результат, отклонение, срок, отзыв); null, пока открыт
  closedAt?: string | null;
  requestedBy?: ChangePerson | null;
  requestedVia?: { keyName: string } | null;
  responsible?: ChangePerson | null;
  steps?: ChangeStep[];
  commands?: ChangeCommand[];
  failure?: string;
  timeline?: ChangeTimelineEntry[];
  backup?: { artifactId: string; createdAt: string | null } | null;
  wireguard?: ChangeWireguard | null;
  my?: ChangeMy;
};
