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

export type UpgradeChannel = "long-term" | "stable";
// A leg may also set MikroTik's `upgrade` channel — the v6 → v7 bridge.
export type UpgradeLegChannel = UpgradeChannel | "upgrade";

export interface IMikrotikUpgradeItem {
  _id: Types.ObjectId;
  mikrotik: Types.ObjectId;
  name: string;
  // The final branch; `legs` is the route there (a single leg = [channel]).
  channel: UpgradeChannel;
  legs?: UpgradeLegChannel[];
  // Cursor into `legs`.
  leg?: number;
  // The version the current leg installs (from check-for-updates).
  hopTo?: string | null;
  // Planned versions for the UI: [from, ...via, to].
  path?: string[];
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
  // «Перейти на RouterOS 7» for the v6 devices of the batch.
  toV7?: boolean;
  createdBy: Types.ObjectId;
  finishedAt?: Date;
  cancelRequestedAt?: Date;
  stopReason?: string;
  items: IMikrotikUpgradeItem[];
  createdAt: Date;
  updatedAt: Date;
}
