import type { InlineKeyboardMarkup } from "grammy/types";
import type { Api } from "grammy";

/**
 * Формы ответов бэкенда — В ОДНОМ МЕСТЕ.
 *
 * Это единственная граница, где мы вынуждены поверить чужим данным на слово, и
 * поверить их ровно один раз (`api/client.ts`), а не приведением по месту
 * использования. Zod в проекте нет, поэтому формы описаны типами, а то, от чего
 * зависит поведение, ещё и проверяется сужением.
 *
 * `interface I*` тут не заводится намеренно: по конвенции репозитория это форма
 * документа Mongoose, а Mongoose здесь нет вовсе — значит `type`.
 */

/** Статус присутствия из каталога сервера. Кодов своих не держим. */
export type WorkStatus = {
  code: string;
  label: string;
  emoji: string;
  /** Можно ли поставить руками; автоматические кнопкой не предлагаем. */
  manual: boolean;
};

export type BotConfig = {
  telegram: {
    isActive: boolean;
    sendToGroup: boolean;
    chatId: string;
    messageThreadId: string;
    /** Имя бота, как его знает сервер; сверяется с getMe (см. main.ts). */
    botUsername: string;
  };
  statusBoard: {
    isActive: boolean;
    messageId: number | null;
  };
  timezone: string;
  deadlineHours: number;
  workStatuses: WorkStatus[];
};

/**
 * Разметка кнопок приезжает с бэкенда как есть и уходит в Telegram как есть.
 *
 * Тип берём телеграмный, а не описываем свой похожий: поле и правда является
 * разметкой Telegram (на бэкенде оно `Schema.Types.Mixed`), и собственное
 * приблизительное описание разошлось бы с настоящим — что уже и произошло:
 * `url` у кнопки-ссылки обязателен, а в моей версии был необязательным.
 */
export type ReplyMarkup = InlineKeyboardMarkup;

/**
 * Блоки рич-сообщения.
 *
 * Тип выводится ИЗ САМОГО МЕТОДА, а не описывается рядом: так он не может
 * разойтись с тем, что примет API, и обновится вместе с grammy.
 */
export type RichBlocks = NonNullable<
  Parameters<Api["sendRichMessage"]>[1]["blocks"]
>;

export type OutboxItem = {
  id: string;
  ticketId: string | null;
  chatId: string;
  messageThreadId: string | null;
  globalChat: boolean;
  text: string;
  replyMarkup: ReplyMarkup | null;
  /** Основная форма сообщения; `text` — запасная, если рич не пройдёт. */
  richMessage: RichBlocks | null;
  attempt: number;
};

export type OutboxBatch = {
  leaseId: string;
  leaseExpiresAt: string;
  notifications: OutboxItem[];
};

/**
 * Исход доставки. Дискриминированный юнион, а не мешок необязательных полей:
 * от `ok` зависят три разные ветки на бэкенде, и «забыл проверить флаг» тут
 * стоит повторной отправки. Ровно на этой арифметике флагов путался прежний
 * отправщик.
 */
export type DeliveryOutcome =
  | { id: string; ok: true; tgMessageId: number }
  | { id: string; ok: false; retryable: true; reason: string }
  | { id: string; ok: false; retryable: false; reason: string };

export type BoardUser = {
  _id: string;
  firstName: string;
  lastName?: string;
  workStatus?: {
    code?: string;
    note?: string;
    updatedAt?: string | null;
  };
};

export type BoardData = { users: BoardUser[] };

export type TicketSummary = {
  _id: string;
  num: number;
  company: { alias?: string };
  title: string;
  description?: string;
  applicant?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    position?: string;
  } | null;
  category?: { title?: string } | null;
  responsibles?: { firstName?: string; lastName?: string }[];
  createdAt: string;
  deadline?: string | null;
  state: string;
  latestComment?: { content?: string } | null;
  clientTimeLabel?: string | null;
};

export type TicketList = { tickets: TicketSummary[] };

export type PairingResult = { message: string; firstName?: string };

export type WorkStatusResult = {
  message: string;
  workStatus?: { code: string; note: string };
};

export type CreatedTicket = { message: string; ticket?: { num?: number } };
