import type { Types } from "mongoose";

export interface IPro32Connection {
  user?: { _id?: Types.ObjectId; firstName?: string; lastName?: string };
  ticket?: number;
  getScreenId?: number;
  status?: number;
  createTime?: number;
  inviteCode?: string;
  inviteUrl?: string;
  connectUrl?: string;
  clientName?: string;
  clientOs?: string;
  clientPreviewUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}
