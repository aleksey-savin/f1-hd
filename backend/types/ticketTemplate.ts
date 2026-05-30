import type { Types } from "mongoose";
import type { ITicketDefaultFields } from "./ticket";

export interface ITicketTemplate extends ITicketDefaultFields {
  sharedCompanies?: { _id?: Types.ObjectId; alias?: string }[];
  sharedUsers?: {
    _id?: Types.ObjectId;
    firstName?: string;
    lastName?: string;
  }[];
  createdBy?: { _id?: Types.ObjectId; firstName?: string; lastName?: string };
  updatedBy?: { _id?: Types.ObjectId; firstName?: string; lastName?: string };
  createdAt: Date;
  updatedAt: Date;
}
