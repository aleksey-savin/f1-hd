import type { Types } from "mongoose";

export interface IMikrotikArtifact {
  mikrotik: Types.ObjectId;
  type: "backup" | "export";
  trigger: "manual" | "scheduled";
  storageKey: string;
  fileName: string;
  size?: number;
  contentHash?: string;
  storage: "s3" | "local";
  routerOsVersion?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
