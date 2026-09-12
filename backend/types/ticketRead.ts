import type { Types } from "mongoose";

/** Когда человек последний раз открывал заявку (одна запись на пару). */
export interface ITicketRead {
  userId: Types.ObjectId;
  ticketId: Types.ObjectId;
  seenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
