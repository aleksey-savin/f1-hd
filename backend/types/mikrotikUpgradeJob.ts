import type { Types } from "mongoose";

// Mirror of backend/models/mikrotikUpgradeJob.js.
export type UpgradeStep =
  | "export"
  | "channel"
  | "check"
  | "download"
  | "reboot"
  | "wait"
  | "routerboot"
  | "routerbootReboot"
  | "routerbootWait"
  | "verify";

export interface IUpgradeVersions {
  os?: string;
  boot?: string;
}

export interface IMikrotikUpgradeItem {
  _id: Types.ObjectId;
  mikrotik: Types.ObjectId;
  name: string;
  channel: "long-term" | "stable";
  state: "queued" | "running" | "done" | "failed" | "skipped";
  step?: UpgradeStep;
  stepStartedAt?: Date;
  rebootRequestedAt?: Date | null;
  startedAt?: Date;
  finishedAt?: Date;
  from?: IUpgradeVersions;
  to?: IUpgradeVersions;
  artifactId?: Types.ObjectId;
  error?: string;
  fix?: string;
  log: { at: Date; text: string }[];
}

export interface IMikrotikUpgradeJob {
  status: "running" | "done" | "stopped" | "cancelled";
  channelMode: "current" | "long-term" | "stable";
  createdBy: Types.ObjectId;
  finishedAt?: Date;
  cancelRequestedAt?: Date;
  stopReason?: string;
  items: IMikrotikUpgradeItem[];
  createdAt: Date;
  updatedAt: Date;
}
