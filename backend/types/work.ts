import type { Types } from "mongoose";

export type WorkFinancesStatus =
  | "preview"
  | "pendingApproval"
  | "approved"
  | "declined"
  | "underReview";

/** Denormalized user reference stored on a work entry. */
export interface IWorkUserRef {
  _id?: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  profileImagePath?: string;
}

export interface IWorkFinancesConfirmation {
  isConfirmed?: boolean;
  confirmedAt?: Date;
  confirmedBy?: { _id?: Types.ObjectId; firstName?: string; lastName?: string };
}

export interface IWork {
  description?: string;
  visitRequired?: boolean;
  startedAt?: Date;
  finishedAt?: Date;
  finishedBy?: IWorkUserRef;
  scheduled?: boolean;
  planningToStart?: Date;
  planningToFinish?: Date;
  executor?: IWorkUserRef;
  tickets?: Types.ObjectId[];
  company: Types.ObjectId;
  withinPlan: boolean;
  notifications?: { lastAction?: string; pending?: boolean };
  finances?: {
    status?: WorkFinancesStatus;
    contractor?: IWorkFinancesConfirmation;
    customer?: IWorkFinancesConfirmation;
  };
  createdBy: { _id?: Types.ObjectId; firstName?: string; lastName?: string };
  updatedBy: { _id?: Types.ObjectId; firstName?: string; lastName?: string };
  createdAt: Date;
  updatedAt: Date;
}
