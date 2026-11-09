export type ReviewKind = "departure" | "inactivity" | "deletion" | "unresolved";
export type ReviewStatus =
  | "pending"
  | "disabled"
  | "deleted"
  | "dismissed"
  | "deferred"
  | "restored";
export type ReviewUser = {
  _id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  position?: string;
  createdAt?: string | null;
  company?: { _id?: string; alias?: string };
  banned?: boolean;
  disabledAt?: string | null;
  deletedAt?: string | null;
  lastLogin?: string | null;
  lastActivityAt?: string | null;
};
export type ReviewTicket = {
  _id: string;
  num: number;
  title?: string;
  company?: { _id?: string; alias?: string };
};
export type ReviewEvidence = {
  ticketId?: string;
  ticketNum?: number;
  quote?: string;
  name?: string;
  employment?: "departure" | "return" | "historical" | "unclear";
  access?: "closeAll" | "restrict" | "preserve" | "handover" | "none";
  effectiveDate?: string | null;
  systems?: string[];
  exceptions?: string[];
  sourceAt?: string | null;
  sourceId?: string;
  sourceRole?: "current" | "quoted" | "signature";
};
export type ReviewProposal = {
  _id: string;
  key: string;
  user?: ReviewUser | null;
  userId?: ReviewUser | string | null;
  tickets?: ReviewTicket[];
  ticketIds?: ReviewTicket[];
  kind: ReviewKind;
  status: ReviewStatus;
  evidence: ReviewEvidence[];
  matchedCandidates?: ReviewUser[];
  reason?: string;
  deferredUntil?: string | null;
  decisionAt?: string | null;
  blockedReason?: string;
  blocked?: boolean;
  actionable?: boolean;
  analysisReason?: string;
};
export type ReviewSettings = {
  enabled: boolean;
  suggestDeletion: boolean;
  disabledDays: number;
  inactivityDays: number;
  historyPaused: boolean;
};
export type ReviewScan = {
  hasRun: boolean;
  phase:
    | "idle"
    | "discovering"
    | "checking"
    | "waiting"
    | "paused"
    | "done"
    | "errors"
    | "disabled";
  availableTotal: number;
  total: number;
  discovered: number;
  notDiscovered: number;
  checked: number;
  errors: number;
  settled: number;
  pending: number;
  processing: number;
  remaining: number;
  discoveryComplete: boolean;
  startedAt: string | null;
  updatedAt: string | null;
  discoveryLeaseUntil?: string | null;
  active: {
    ticket: ReviewTicket;
    stage: "checking" | "ai";
    inSnapshot: boolean;
    startedAt: string | null;
    updatedAt: string | null;
    leaseUntil?: string | null;
  } | null;
  cadence: { analysisSeconds: number; discoverySeconds: number };
};
export type ReviewSummary = {
  aiEnabled?: boolean;
  unknownDisabled?: number;
  pending: number;
  total: number;
  byKind: Record<ReviewKind, number>;
  byStatus: Record<ReviewStatus, number>;
  companies: { _id: string; alias: string }[];
  items: ReviewProposal[];
  scan?: ReviewScan | null;
  analysis: {
    pending: number;
    processing: number;
    done: number;
    error: number;
    paused: boolean;
  };
  analysisMethods?: {
    rules: number;
    ai: number;
    cache: number;
    unknown: number;
  };
  settings: ReviewSettings;
  canManage: boolean;
  canAnalyze: boolean;
  canManageUsers: boolean;
};
export type ReviewAnalysis = {
  _id: string;
  ticket?: ReviewTicket;
  ticketId: ReviewTicket | string;
  status: "pending" | "processing" | "done" | "error";
  events?: ReviewEvidence[];
  checkedAt?: string | null;
  error?: string;
  attempts?: number;
  method?: "rules" | "ai" | "cache";
};
export type ReviewPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
export type ReviewActionResult = { message?: string; error?: string };
