import type { Types } from "mongoose";
import type { IAttachment } from "./_shared";

export interface ICommentChannel {
  network?: "telegram" | "whatsapp" | "max" | "site";
  conversationId?: Types.ObjectId;
  messageId?: Types.ObjectId;
  direction?: "in" | "out";
  authorName?: string;
  status?: string;
  statusAt?: Date;
  error?: string;
  editedAt?: Date;
  deletedAt?: Date;
}

export interface IComment {
  content: string;
  quotedText?: string;
  attachments?: IAttachment[];
  /** @deprecated legacy ticket number, removed after 1.8.9 */
  ticket?: number;
  ticketId: Types.ObjectId;
  notifications?: { lastAction?: string; pending?: boolean; skipApplicant?: boolean };
  channel?: ICommentChannel;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
