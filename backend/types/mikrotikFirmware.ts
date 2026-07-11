import type { Types } from "mongoose";

export type RouterOsBranchKey =
  | "7.stable"
  | "7.long-term"
  | "6.stable"
  | "6.long-term";

export interface IRouterOsRelease {
  _id: RouterOsBranchKey;
  version?: string;
  releasedAt?: Date;
  changelog?: string;
  fetchedAt?: Date;
  lastError?: string;
  lastErrorAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRouterOsCveMatcher {
  edition: "stable" | "ltr" | "any";
  exactVersion?: string;
  versionStartIncluding?: string;
  versionStartExcluding?: string;
  versionEndIncluding?: string;
  versionEndExcluding?: string;
}

export interface IRouterOsCve {
  cveId: string;
  baseScore?: number;
  baseSeverity?: string;
  description?: string;
  matchers: IRouterOsCveMatcher[];
  published?: Date;
  lastModified?: Date;
  fetchedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMikrotikFirmwareStateItem {
  recordId: Types.ObjectId;
  description: string;
  safe: boolean;
}

// Keyed-синглтоны: "cve-sync" (поля статуса NVD-синка) и "security-ticket"
// (CAS-клейм + привязка единственной авто-заявки безопасности).
export interface IMikrotikFirmwareState {
  _id: string;
  lastSuccessAt?: Date;
  lastError?: string;
  lastErrorAt?: Date;
  cveCount?: number;
  claimedAt?: Date;
  ticketId?: Types.ObjectId;
  items: IMikrotikFirmwareStateItem[];
  allSafeCommentedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
