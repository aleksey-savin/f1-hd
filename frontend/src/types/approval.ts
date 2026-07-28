// Согласование работ: типы конвейера и карточки отчёта.
// Стадии и их подписи те же, что были в фильтре прежнего экрана — раздел
// переехал на новый стек, но словарь пользователя не менялся.

export type PipelineStageKey =
  | "preview"
  | "pendingApproval"
  | "approved"
  | "awaitingPayment"
  | "paid";

/**
 * `waiting` — очередь до части ещё не дошла: согласование идёт снизу вверх, и
 * вышестоящее подразделение открывается только когда подписаны все его нижние.
 */
export type PartStatus = "waiting" | "pending" | "approved" | "declined";

export type ReportStatus =
  | "pendingApproval"
  | "approved"
  | "awaitingPayment"
  | "paid"
  | "archived"
  | "declined";

export type Actor = {
  _id: string;
  firstName?: string;
  lastName?: string;
};

export type CompanyRef = {
  _id: string;
  alias: string;
  fullTitle?: string;
};

export type ServicePlanRef = {
  _id: string;
  title: string;
  type?: "hourPackage" | "fixedPrice" | "hourly";
  tariffingPeriod?: number;
  pricePerHour?: number;
  pricePerHourNonWorking?: number;
  hourPackages?: { hours: number; pricePerHour: number }[];
};

/** Строка подбора: месяц × компания × услуга, ещё не ставшая отчётом. */
export type PreviewRow = {
  month: string;
  company: CompanyRef;
  servicePlan: ServicePlanRef;
  approval: {
    required: boolean;
    bySubdivisions: boolean;
    approver: Actor | null;
  };
  zone: string;
  worksCount: number;
  workIds: string[];
  overtimeWorkIds: string[];
  workingTimeMinutes: number;
  overtimeMinutes: number;
  price: number;
  additionalPrice: number;
  total: number;
  /** Работы вне услуг блокируют формирование отчёта у всей компании за месяц. */
  unrelatedWorksCount: number;
};

export type ReportPart = {
  _id: string;
  subdivision: string | null;
  subdivisionName: string;
  status: PartStatus;
  decidedBy: Actor | null;
  decidedAt: string | null;
  comment: string;
  price: number;
  additionalPrice: number;
  worksCount: number;
  canDecide: boolean;
  /**
   * Цепочка предков подразделения от корня к родителю. Части бывают на разной
   * глубине, и маршрут вкладывает каждую в ближайшего предка, у которого часть
   * тоже есть. Приходит только с карточки отчёта, не со списка стадии.
   */
  ancestors?: string[];
  /** Кого ждём по этой части. null — руководитель не назначен, подписать некому. */
  manager?: Actor | null;
};

export type ApprovalInfo = {
  required: boolean;
  bySubdivisions: boolean;
  finalApprover: Actor | null;
  submittedAt: string | null;
  deadlineAt: string | null;
  remindedAt: string | null;
  autoApprovedAt: string | null;
};

/** Кого ждём прямо сейчас — главный вопрос стадии «На утверждении». */
export type Awaiting =
  | {
      kind: "subdivisions";
      /** Подписано. Отдельным числом: часть бывает ещё и в очереди. */
      approved: number;
      pending: number;
      total: number;
      names: string[];
    }
  | { kind: "final"; name: string | null }
  | null;

export type ReportRow = {
  _id: string;
  status: ReportStatus;
  company: CompanyRef;
  servicePlan: ServicePlanRef;
  periodFrom: string;
  periodTo: string;
  /**
   * Месяц отчёта строкой, посчитанный сервером в зоне компании-клиента.
   * Браузер этого сделать не может: `periodFrom` — полночь первого числа в
   * зоне клиента, и в другой зоне она попадает на предыдущий месяц.
   */
  period: string | null;
  /** Компания-исполнитель — по автору отчёта. */
  contractor?: { _id: string; alias: string } | null;
  price: number | null;
  additionalPrice: number;
  total: number | null;
  worksCount: number;
  attempt: number;
  invoice?: { number?: string; date?: string; fullyPaidAt?: string };
  approval: ApprovalInfo;
  /** Кто отправил отчёт клиенту — первый узел маршрута подписей. */
  submittedBy: Actor | null;
  awaiting: Awaiting;
  /**
   * Сколько денег вправе видеть зритель. `overtimeOnly` — руководитель филиала:
   * итог договора и ставки сервер не отдаёт вовсе, видна только оплата работ в
   * нерабочее время.
   */
  money?: "full" | "overtimeOnly";
  parts: ReportPart[];
  canDecide: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TimelineEvent = {
  at: string;
  actor: "contractor" | "customer" | "system";
  by: Actor | null;
  action:
    | "submitted"
    | "resubmitted"
    | "approved"
    | "declined"
    | "autoApproved"
    | "reminded"
    | "invoiced"
    | "paid"
    | "archived";
  scope: "report" | "subdivision";
  subdivision: string | null;
  subdivisionName?: string;
  comment: string;
};

export type ReportWork = {
  _id: string;
  description: string;
  startedAt: string;
  finishedAt: string;
  withinPlan: boolean;
  finishedBy?: { firstName?: string; lastName?: string };
  tickets: {
    _id: string;
    num: number;
    categoryId?: string;
    applicantId?: { firstName?: string; lastName?: string };
  }[];
};

export type ReportCard = ReportRow & {
  works: ReportWork[];
  timeline: TimelineEvent[];
};

export type StageStat = {
  count: number;
  total: number;
  unrelatedWorks?: number;
  nearestDeadlineAt?: string | null;
  nearestDeadlineDays?: number | null;
  oldestDays?: number | null;
  oldestInvoiceDays?: number | null;
};

export type ApprovalScope = {
  kind: "all" | "scoped" | "none";
  isClientView: boolean;
  companiesCount: number | null;
  isFinalApprover: boolean;
  isSubdivisionManager: boolean;
};

export type PipelineResponse = {
  scope: ApprovalScope;
  zone: string;
  preview: PreviewRow[];
  reports: ReportRow[];
  stages: Partial<Record<PipelineStageKey | "declined", StageStat>>;
};
