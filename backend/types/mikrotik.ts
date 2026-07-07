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

export interface IMikrotik {
  // Unset for standalone devices (e.g. Cloud Hosted Router).
  clientDevice?: Types.ObjectId;
  // Standalone identity, used when there is no clientDevice.
  companyId?: Types.ObjectId;
  label?: string;
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
  offlineSince?: Date;
  offlineAlertedAt?: Date;
  alertTicketId?: Types.ObjectId;
  schedules?: {
    backup?: IMikrotikSchedule;
    export?: IMikrotikSchedule;
  };
  createdAt: Date;
  updatedAt: Date;
}
