/**
 * «Диалоги» — формы ответов API так, как их отдаёт бэкенд
 * (backend/services/messaging/present.js, controllers/conversation.js,
 * controllers/channel.js, services/messaging/origin.js). Контракт —
 * docs/messaging.md, «Staff API».
 */

export type Network = "telegram" | "whatsapp" | "max" | "site";
export type ConversationKind = "direct" | "group" | "form";
export type ConversationQueue =
  | "awaiting"
  | "mine"
  | "unbound"
  | "all"
  | "hidden";

/** Строка списка — `conversationRow`. */
export type ConversationRow = {
  id: string;
  kind: ConversationKind;
  network: Network;
  title: string;
  /** Личный чат или форма без связанного пользователя. */
  unknown: boolean;
  company: { id: string; alias: string } | null;
  lastMessage: {
    at: string;
    direction: "in" | "out" | "system";
    origin: string;
    preview: string;
    authorName: string;
  } | null;
  awaitingSince: string | null;
  unread: number;
  ticket: { id: string; num: number } | null;
  /** Все живые привязки; ticket сохраняется для старых клиентов. */
  tickets?: { id: string; num: number }[];
  decision: { ticketId: string; ticketNum: number } | null;
  assignee: { id: string; name: string } | null;
  hidden: boolean;
};

export type QueueCounts = {
  awaiting: number;
  mine: number;
  unbound: number;
  all: number;
};

export type ConversationListResponse = {
  items: ConversationRow[];
  counts: QueueCounts;
  nextBefore: string | null;
};

export type AttachmentStatus = "ready" | "pending" | "skipped" | "failed";

export type MessageAttachment = {
  name: string;
  originalName: string;
  mimetype: string;
  size: number;
  durationSec: number | null;
  status: AttachmentStatus;
};

export type MessageStatus =
  | "received"
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

/** Сообщение ленты — `messageRow`. */
export type MessageRow = {
  id: string;
  seq: number;
  direction: "in" | "out" | "system";
  origin: string;
  kind: string;
  text: string;
  form: { fields: { label: string; value: string }[] } | null;
  sentAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  author: { name: string; userId: string | null; isStaff: boolean };
  attachments: MessageAttachment[];
  replyTo: { id: string; authorName: string; text: string } | null;
  status: MessageStatus;
  error: string;
  ticket: { id: string; num: number; title?: string } | null;
  attachMode: string | null;
  suggestTicketId: string | null;
  event: {
    kind: string;
    ticketNum: number | null;
    byName: string;
    targetName: string;
    count: number | null;
  } | null;
};

/** Страница ленты: при открытии и по «Показать раньше». */
export type MessagesPage = { items: MessageRow[]; serverTime: string };

/** Ответ опроса `changedSince`. */
export type MessagesChanges = {
  items: MessageRow[];
  removedIds?: string[];
  serverTime: string;
  hasMore: boolean;
  afterId?: string;
};

export type ConversationPerson = {
  identityId: string;
  name: string;
  username: string;
  phone: string;
  userId: string | null;
  linkMethod: string | null;
  isStaff: boolean;
};

export type ConversationTicket = {
  canReply?: boolean;
  id: string;
  num: number;
  title: string;
  state: string;
  deadline: string | null;
  responsibles: string[];
  boundAt: string | null;
};

/** Контекст ответа принадлежит сотруднику, а не всему диалогу. */
export type ConversationReplyContext = {
  ticketId: string | null;
  withoutTicket: boolean;
  expiresAt: string | null;
  required: boolean;
  updatedAt?: string | null;
};

export type ConversationReplySelection = {
  mode: "ticket" | "free" | "choose";
  ticket: ConversationTicket | null;
  expiresAt: string | null;
  updatedAt?: string | null;
};

/** Карточка диалога — `GET /api/conversations/:id`. */
export type ConversationCard = {
  access: { all: boolean; reply: boolean; manage: boolean; start: boolean };
  conversation: ConversationRow;
  channel: {
    id: string;
    provider?: "gateway" | "wazzup";
    type: Network;
    name: string;
    state: string;
    isActive: boolean;
  } | null;
  counterpart: ConversationPerson | null;
  participants: ConversationPerson[];
  contact: {
    id: string;
    name: string;
    position: string;
    company: string;
    phone: string;
    email: string;
  } | null;
  otherChannels: {
    network: Network;
    handle: string;
    conversationId: string | null;
  }[];
  ticket: ConversationTicket | null;
  tickets?: ConversationTicket[];
  replyContext?: ConversationReplyContext;
  openTickets: {
    id: string;
    num: number;
    title: string;
    state: string;
    deadline: string | null;
  }[];
};

/** Черновик формы заявки — `GET /api/conversations/:id/ticket-draft`. */
export type TicketDraft = {
  description: string;
  applicantId: string | null;
  companyId: string | null;
  source: string;
  attachments: number;
};

/** Маршрут «Ответить через» — `GET /api/tickets/:num/delivery-routes`. */
export type DeliveryRoute = {
  stickersAvailable?: boolean;
  id: string;
  channelId: string;
  network: Network;
  kind: ConversationKind;
  title: string;
  available: boolean;
  reason: string | null;
  boundHere: boolean;
} & (
  | { target: "conversation"; conversationId: string }
  | { target: "phone"; conversationId: null; kind: "direct" }
);

export type DeliveryRoutes = {
  canSend?: boolean;
  routes: DeliveryRoute[];
  /** id маршрута или `"notify"` — «Почта и бот». */
  defaultRoute: string;
  applicantName: string;
};

/** Кандидат «Это он» — `GET /api/identities/:id/candidates`. */
export type IdentityCandidate = {
  id: string;
  name: string;
  position: string;
  company: string;
};

/** Получатель первого сообщения: пользователь HD или введённый номер. */
export type StartRecipient = {
  userId: string | null;
  name: string;
  phone: string;
};

export type ConversationRecipient = {
  id: string;
  name: string;
  company: string;
  phone: string;
  email?: string;
};

export type StartRoutes = {
  recipient: StartRecipient;
  routes: DeliveryRoute[];
};

export type OutgoingStart = {
  messageId: string;
  conversationId: string | null;
  status: MessageStatus;
  error?: string | null;
};

/** Только идентификатор принятого сообщения и получатель, без содержимого. */
export type PendingStart = {
  clientRequestId: string;
  messageId?: string;
  recipient: StartRecipient;
};

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

/** Канал в настройках — `publicChannel` (секреты только признаком «задан»). */
export type MessagingChannel = {
  id: string;
  provider?: "gateway" | "wazzup";
  type: Network;
  name: string;
  isActive: boolean;
  state: ChannelState;
  stateReason: string;
  account: {
    externalId?: string;
    displayName?: string;
    username?: string;
    phone?: string;
  };
  login: { qr: string | null; expiresAt: string | null };
  gatewaySeenAt: string | null;
  lastMessageAt: string | null;
  settings: {
    proxyUrl?: string;
    historyDays?: number;
    importGroups?: boolean;
    markReadOnOpen?: boolean;
    signReplies?: boolean;
    maxMediaMb?: number;
  };
  secrets: Record<
    "tgApiId" | "tgApiHash" | "proxyPassword" | "maxToken" | "maxWebhookSecret",
    boolean
  >;
  serviceUserId: string | null;
};

/** Итог команды шлюзу — `GET /api/channels/:id/jobs/:jobId`. */
export type ChannelJobView = {
  id: string;
  type: string;
  state: "pending" | "done" | "failed" | "cancelled";
  error: string;
  result: unknown;
  finishedAt: string | null;
};

/** Блок `channel` комментария-зеркала (backend/services/messaging/present.js). */
export type CommentChannel = {
  isSticker?: boolean;
  network: Network;
  conversationId: string;
  messageId?: string;
  direction: "in" | "out";
  authorName?: string;
  status?: "preparing" | MessageStatus;
  statusAt?: string;
  error?: string;
};
