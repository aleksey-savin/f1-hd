import type { Types } from "mongoose";
import type { IAttachment } from "./_shared";

export interface IComment {
  content: string;
  attachments?: IAttachment[];
  /** @deprecated legacy ticket number, removed after 1.8.9 */
  ticket?: number;
  ticketId: Types.ObjectId;
  notifications?: { lastAction?: string; pending?: boolean };
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
