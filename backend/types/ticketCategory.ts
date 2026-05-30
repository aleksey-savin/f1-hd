import type { Types } from "mongoose";

export interface ITicketCategory {
  title: string;
  description?: string;
  alwaysWithinPlan?: boolean;
  isActive: boolean;
  users?: { _id?: Types.ObjectId; firstName?: string; lastName?: string }[];
  servicePlans?: { _id?: Types.ObjectId; title?: string }[];
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
