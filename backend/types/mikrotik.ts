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

export interface IMikrotik {
  clientDevice: Types.ObjectId;
  credentials?: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    useTls?: boolean;
    tlsCert?: string;
    knockSequence?: string;
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
  createdAt: Date;
  updatedAt: Date;
}
