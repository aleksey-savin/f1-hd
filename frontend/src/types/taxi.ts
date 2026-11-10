export type TaxiPurpose = "business" | "service" | "personal" | "unknown";
/** Public route labels are formatted by the API; full provider addresses stay on the server. */
export interface TaxiPoint {
  address: string;
  lat?: number;
  lon?: number;
}
export interface TaxiPerson {
  _id: string;
  firstName: string;
  lastName: string;
  email?: string;
}
export interface TaxiCompany {
  _id: string;
  alias: string;
  isInternal?: boolean;
}
export interface TaxiTicket {
  _id: string;
  num: number;
  title: string;
  isClosed: boolean;
}
export interface TaxiTrip {
  _id: string;
  externalId: string;
  source: "hd" | "go";
  userId: string | null;
  personName: string;
  companyId: string | null;
  companyName: string;
  purpose: TaxiPurpose;
  status: string;
  origin?: TaxiPoint;
  destination?: TaxiPoint;
  startedAt?: string;
  requestedAt?: string;
  finishedAt?: string;
  estimateMinor?: number | null;
  totalMinor?: number | null;
  currency?: string;
  driver?: { name?: string; phone?: string; car?: string; number?: string };
  ticketIds: string[];
  directTicketIds: string[];
  workTicketIds: string[];
  tickets: TaxiTicket[];
  workIds: string[];
  canAllocate: boolean;
  canDelete?: boolean;
}
export interface TaxiEmployee {
  _id?: string;
  externalId: string;
  userId: string | null;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  nickname?: string;
  phone?: string;
  active: boolean;
}
export interface TaxiSettings {
  isActive: boolean;
  clientId: string;
  tokenIsSet: boolean;
  pollSeconds: number;
  historyDays: number;
  health?: {
    lastOkAt?: string;
    lastErrorAt?: string;
    lastError?: string;
    financialPending?: boolean;
    financialError?: string;
    consecutiveFailures?: number;
  };
  lastSyncAt?: string | null;
}
export interface TaxiSettingsData {
  settings: TaxiSettings;
  employees: TaxiEmployee[];
  users: TaxiPerson[];
}
export interface TaxiReportData {
  period?: { from: string; to: string };
  trips: TaxiTrip[];
  total: number;
  totalMinor: number;
  estimatedMinor?: number;
  companies: TaxiCompany[];
  users: TaxiPerson[];
  isActive: boolean;
}
export type TaxiReportResult =
  | { report: TaxiReportData; error?: never }
  | { report?: never; error: string };
export interface TaxiDetail {
  trip: TaxiTrip;
}
export interface TaxiActionResult {
  error?: string;
  message?: string;
  ok?: boolean;
  skipped?: boolean;
  intent?: string;
  trip?: TaxiTrip;
  trips?: TaxiTrip[];
  isActive?: boolean;
  candidateKey?: string;
  deletedTripId?: string;
  allocationOptions?: {
    tripId: string;
    companyId: string;
    tickets: TaxiTicket[];
  };
}
export interface TaxiSyncResult {
  imported: number;
  skipped?: boolean;
  message?: string;
  financialPending?: boolean;
  financialError?: string;
}
