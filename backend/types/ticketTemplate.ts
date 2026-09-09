import type { Types } from "mongoose";
import type { ITicketDefaultFields } from "./ticket";

/** What the initiator does with the description when creating from this template. */
export type TicketDescriptionMode = "required" | "optional" | "hidden";

export interface ITicketTemplate extends ITicketDefaultFields {
  descriptionMode?: TicketDescriptionMode;
  allowAllStaff?: boolean;
  checklist?: { description?: string; mandatory?: boolean }[];
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
