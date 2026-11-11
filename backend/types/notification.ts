import type { Types } from "mongoose";

export interface INotification {
  instrument?: "email" | "telegram";
  ticketId?: Types.ObjectId;
  commentId?: Types.ObjectId;
  conversationWait?: { conversationId: Types.ObjectId; awaitingSince: Date };
  to?: {
    chatId?: string;
    globalChat?: boolean;
    messageThreadId?: string;
    companyChat?: string;
    applicant?: string;
    responsible?: string;
    manager?: string;
    email?: string;
  };
  title?: string;
  text?: string;
  sent: boolean;
  failed: boolean;
  attemptsCounter: number;
  createdAt: Date;
  updatedAt: Date;
}
