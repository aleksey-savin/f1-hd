import type { Types } from "mongoose";

export interface IContract {
  title: string;
  company?: Types.ObjectId;
  terms?: Date;
  autoRenewal?: boolean;
  state?: "active" | "canceled";
  payments?: {
    type?: "per-hour" | "fixed";
    period?: "monthly" | "one-time";
  };
  ticketCategories?: Types.ObjectId[];
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
