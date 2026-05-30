import type { Types } from "mongoose";

export interface ITicketLog {
  /** @deprecated legacy ticket number */
  ticket?: number;
  ticketId?: Types.ObjectId;
  user?: { firstName?: string; lastName?: string };
  event?: string;
  severity?: "info" | "warning" | "danger";
  createdAt: Date;
  updatedAt: Date;
}
