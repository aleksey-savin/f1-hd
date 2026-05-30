import type { Types } from "mongoose";

export type ServicePlanReportStatus =
  | "pendingApproval"
  | "approved"
  | "awaitingPayment"
  | "paid"
  | "archived"
  | "declined";

export interface IServicePlanReport {
  company: Types.ObjectId;
  servicePlan: Types.ObjectId;
  works?: Types.ObjectId[];
  price: number;
  additionalPrice: number;
  periodFrom?: Date;
  periodTo?: Date;
  invoice?: { number?: string; date?: Date; fullyPaidAt?: Date };
  status: ServicePlanReportStatus;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
