/**
 * «Диалоги» — формы ответов API так, как их отдаёт бэкенд
 * (backend/services/messaging/present.js, controllers/conversation.js,
 * controllers/channel.js, services/messaging/origin.js). Контракт —
 * docs/messaging.md, «Staff API».
 */

export type Network = "telegram" | "whatsapp" | "max" | "site";
export type ConversationKind = "direct" | "group" | "form";
export type ConversationQueue = "awaiting" | "mine" | "unbound" | "all" | "hidden";

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
  ticket: { id: string; num: number } | null;
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

/** Карточка диалога — `GET /api/conversations/:id`. */
export type ConversationCard = {
  conversation: ConversationRow;
  channel: {
    id: string;
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
  ticket: {
    id: string;
    num: number;
    title: string;
    state: string;
    deadline: string | null;
    responsibles: string[];
    boundAt: string | null;
  } | null;
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
  conversationId: string;
  network: Network;
  kind: ConversationKind;
  title: string;
  available: boolean;
  reason: string | null;
  boundHere: boolean;
};

export type DeliveryRoutes = {
  routes: DeliveryRoute[];
  /** id диалога или `"notify"` — «Почта и бот HD, как сейчас». */
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
  network: Network;
  conversationId: string;
  messageId?: string;
  direction: "in" | "out";
  authorName?: string;
  status?: "preparing" | MessageStatus;
  statusAt?: string;
  error?: string;
};
