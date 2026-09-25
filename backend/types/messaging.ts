import type { Types } from "mongoose";

export type Network = "telegram" | "whatsapp" | "max" | "site";
export type ChannelState =
  | "disconnected"
  | "connecting"
  | "awaitingQr"
  | "awaitingCode"
  | "awaitingPassword"
  | "connected"
  | "loggedOut"
  | "banned"
  | "error";
export type ConversationKind = "direct" | "group" | "form";
export type MessageDirection = "in" | "out" | "system";
export type MessageOrigin = "client" | "staff" | "hd" | "device" | "form" | "system";
export type MessageStatus = "received" | "queued" | "sent" | "delivered" | "read" | "failed";
export type MessageKind =
  | "text" | "photo" | "voice" | "audio" | "video" | "document"
  | "sticker" | "location" | "contact" | "form" | "other" | "event";
export type AttachMode = "bound" | "reply" | "manual" | "origin" | "deliver" | null;
export type JobType = "send" | "markRead" | "fetchMedia" | "login" | "logout" | "loadHistory" | "testProxy";

export interface IChannel {
  type: Network;
  name: string;
  isActive: boolean;
  state: ChannelState;
  stateReason: string;
  account: { externalId: string; displayName: string; username: string; phone: string };
  login: { qr: string | null; expiresAt: Date | null };
  gatewaySeenAt: Date | null;
  lastMessageAt: Date | null;
  settings: {
    proxyUrl: string;
    historyDays: number;
    importGroups: boolean;
    markReadOnOpen: boolean;
    signReplies: boolean;
    maxMediaMb: number;
    ignoredChatIds: string[];
    site: { formKey?: string; allowedOrigins: string[]; consentText: string };
  };
  secrets: { tgApiId: string; tgApiHash: string; proxyPassword: string; maxToken: string; maxWebhookSecret: string };
  serviceUserId: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IChannelIdentity {
  network: Network;
  externalId: string;
  aliases: string[];
  firstName: string;
  lastName: string;
  displayName: string;
  username: string;
  phone: string;
  email: string;
  isBot: boolean;
  userId: Types.ObjectId | null;
  linkMethod: "tgBot" | "phone" | "pairing" | "manual" | "email" | null;
  isStaff: boolean;
  companyId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IConversation {
  channelId: Types.ObjectId;
  network: Network;
  kind: ConversationKind;
  externalChatId: string;
  externalAliases: string[];
  title: string;
  counterpartIdentityId: Types.ObjectId | null;
  participants: { identityId: Types.ObjectId; isStaff: boolean }[];
  companyId: Types.ObjectId | null;
  binding: {
    ticketId: Types.ObjectId | null;
    ticketNum: number | null;
    boundAt: Date | null;
    boundBy: Types.ObjectId | null;
    endedAt: Date | null;
    endReason: "closed" | "deleted" | "manual" | null;
  };
  decision: { ticketId: Types.ObjectId | null; ticketNum: number | null; at: Date | null };
  assigneeId: Types.ObjectId | null;
  awaitingSince: Date | null;
  waitNotifiedAt: Date | null;
  handled: { at: Date | null; by: Types.ObjectId | null; how: string | null };
  lastMessage: { at: Date | null; direction: MessageDirection | null; origin: MessageOrigin | null; preview: string; authorName: string };
  lastSeq: number;
  hidden: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMessageAttachment {
  name: string;
  originalName: string;
  mimetype: string;
  size: number;
  durationSec: number | null;
  status: "ready" | "pending" | "skipped" | "failed";
  externalRef: string;
}

export interface IMessage {
  conversationId: Types.ObjectId;
  channelId: Types.ObjectId;
  externalChatId: string;
  externalId?: string;
  externalIds?: string[];
  seq: number;
  direction: MessageDirection;
  origin: MessageOrigin;
  kind: MessageKind;
  identityId: Types.ObjectId | null;
  authorUserId: Types.ObjectId | null;
  authorName: string;
  text: string;
  attachments: IMessageAttachment[];
  form?: { fields?: { label: string; value: string }[] };
  replyToExternalId: string | null;
  replyToId: Types.ObjectId | null;
  sentAt: Date;
  status: MessageStatus;
  error: string;
  jobId: Types.ObjectId | null;
  editedAt: Date | null;
  revisions?: { text: string; at: Date }[];
  deletedAt: Date | null;
  ticketId: Types.ObjectId | null;
  ticketNum: number | null;
  attachMode: AttachMode;
  suggestTicketId: Types.ObjectId | null;
  commentId: Types.ObjectId | null;
  imported: boolean;
  event?: { kind?: string; ticketNum?: number; byUserId?: Types.ObjectId; byName?: string; targetName?: string; count?: number };
  effects: { conversation: boolean; attach: boolean; notify: boolean };
  createdAt: Date;
  updatedAt: Date;
}

export interface IChannelJob {
  channelId: Types.ObjectId;
  network: Network;
  type: JobType;
  conversationId: Types.ObjectId | null;
  messageId: Types.ObjectId | null;
  state: "pending" | "done" | "failed" | "cancelled";
  notBefore: Date;
  leaseId: string | null;
  leaseUntil: Date | null;
  attempts: number;
  lastError: string;
  payload: Record<string, unknown>;
  result: unknown;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IConversationRead {
  userId: Types.ObjectId;
  conversationId: Types.ObjectId;
  seenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
