import type { Types } from "mongoose";

export interface IMikrotikDownloadCode {
  user: Types.ObjectId;
  artifact: Types.ObjectId;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
