import type { Types } from "mongoose";

export interface IMikrotikDownloadCode {
  _id: string;
  user: Types.ObjectId;
  artifact: Types.ObjectId;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
