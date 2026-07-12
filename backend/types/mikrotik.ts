import type { Types } from "mongoose";

export interface IMikrotikAddress {
  address?: string;
  network?: string;
  interface?: string;
  invalid?: string;
  dynamic?: string;
  disabled?: string;
  comment?: string;
}

export interface IMikrotikSchedule {
  frequency: "off" | "daily" | "weekly" | "monthly";
  time: string;
  weekday: number;
  dayOfMonth: number;
  keepLast: number;
  lastRunAt?: Date;
  lastSuccessAt?: Date;
  lastError?: string;
  nextRunAt?: Date;
}

// Mirror of backend/models/mikrotikOutage.js — one outage episode per document.
export interface IMikrotikOutage {
  mikrotik: Types.ObjectId;
  startedAt: Date;
  endedAt?: Date | null;
  // Present (true) only while the outage is ongoing; unset on close.
  open?: boolean;
  ticketId?: Types.ObjectId | null;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMikrotik {
  // Unset for standalone devices (e.g. Cloud Hosted Router).
  clientDevice?: Types.ObjectId;
  // Standalone identity, used when there is no clientDevice.
  companyId?: Types.ObjectId;
  label?: string;
  // Транзит: соединения туннелируются через SSH этого управляемого роутера.
  // Один уровень — запись с транзитом сама транзитом быть не может.
  jumpRecordId?: Types.ObjectId;
  credentials?: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    useTls?: boolean;
    tlsCert?: string;
    knockSequence?: string;
    sshPort?: number;
    sshHostKey?: string;
  };
  name?: string;
  boardName?: string;
  serialNumber?: string;
  currentFirmware?: string;
  addresses?: IMikrotikAddress[];
  status?: "online" | "offline";
  monitoringEnabled: boolean;
  lastSuccessfulConnectionAt?: Date;
  lastCheckedAt?: Date;
  lastError?: string;
  // Confirmed loss edge (set once CONFIRM_POLLS consecutive polls have failed).
  offlineSince?: Date;
  offlineAlertedAt?: Date;
  alertTicketId?: Types.ObjectId;
  // Anti-flap: consecutive failed poll cycles and the candidate loss edge.
  failedPolls: number;
  firstFailureAt?: Date;
  schedules?: {
    backup?: IMikrotikSchedule;
    export?: IMikrotikSchedule;
  };
  createdAt: Date;
  updatedAt: Date;
}
