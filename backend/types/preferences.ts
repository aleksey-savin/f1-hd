import type { Types } from "mongoose";

import type { IWorkSchedule } from "./_shared";

/** Режим шифрования почтового соединения (IMAP и SMTP). */
export type MailSecurity = "ssl" | "starttls" | "none";

/**
 * Состояние внешнего почтового канала: пишут крон сбора, отправка уведомлений
 * и кнопка проверки в настройках; читает строка состояния секции.
 */
export interface IChannelHealth {
  lastCheckedAt: Date | null;
  lastOkAt: Date | null;
  /** Когда канал последний раз реально сработал: забрал или отправил письмо. */
  lastMessageAt: Date | null;
  lastError: string;
  lastErrorHint: string;
  lastErrorAt: Date | null;
  consecutiveFailures: number;
}

export interface IPreferences {
  timezone: string;
  htmlTicketDesc: boolean;
  /** Ящик-приёмник: письма на него становятся заявками. */
  mailbox: {
    isActive: boolean;
    address: string;
    host: string;
    port: number;
    security: MailSecurity;
    folder: string;
    allowSelfSigned: boolean;
    /** Шифртекст secretBox; наружу отдаётся маской. Логин — это address. */
    password: string;
    health: IChannelHealth;
  };
  defaultApplicant?: {
    _id?: Types.ObjectId;
    firstName?: string;
    lastName?: string;
  };
  defaultCompany?: { _id?: Types.ObjectId; alias?: string };
  identifyCompany: boolean;
  identifyApplicant: boolean;
  checkPhoneNumber: boolean;
  deadline: number;
  notify: {
    personal: {
      newTicket: boolean;
      respStateUpdate: boolean;
      ticketStateUpdate: boolean;
      ticketNewComment: boolean;
      scheduledWorks: boolean;
    };
    byEmail: {
      isActive: boolean;
      host: string;
      port: number;
      security: MailSecurity;
      allowSelfSigned: boolean;
      /** "none" — внутренний релей, принимающий почту без пароля. */
      authMethod: "password" | "none";
      user: string;
      /** Шифртекст secretBox; наружу отдаётся маской. */
      pass: string;
      sendFromName: string;
      sendFromEmail: string;
      health: IChannelHealth;
    };
    byTelegram: {
      isActive: boolean;
      sendToGroup: boolean;
      chatId: string;
      messageThreadId: string;
    };
  };
  statusBoard: {
    isActive: boolean;
    messageId: number | null;
    lastText: string;
  };
  contacts: { tel: string; email: string; address: string };
  getScreen: { isActive: boolean };
  modules: {
    timeTracking: { isActive: boolean };
    finances: { isActive: boolean };
    inventory: { isActive: boolean };
  };
  overtime: {
    defaultSchedule?: IWorkSchedule;
    defaultTariffingPeriodMinutes: number;
    weekdayCoefficient: number;
    weekendCoefficient: number;
  };
  ai: {
    isActive: boolean;
    provider: "openai" | "anthropic" | "deepseek" | "yandexai" | "local";
    openai: { apiKey: string; model: string };
    anthropic: { apiKey: string; model: string };
    deepseek: { apiKey: string; model: string };
    yandexai: { apiKey: string; model: string; folderId: string };
    local: { baseUrl: string; apiKey: string; model: string };
    speechToText: {
      isActive: boolean;
      provider: "openai" | "yandex" | "local";
      useProviderCredentials: boolean;
      apiKey: string;
      model: string;
      yandex: { apiKey: string; model: string; folderId: string };
      local: { baseUrl: string; apiKey: string; model: string };
      health: IChannelHealth;
    };
    health: IChannelHealth;
  };
  knowledgeBase: {
    moderators: {
      _id?: Types.ObjectId;
      firstName?: string;
      lastName?: string;
    }[];
    hideNotApproved: boolean;
    approvalPeriodDays: number;
    scanForSecrets: boolean;
    trackServiceExpiry: boolean;
    serviceExpiryDays: number;
  };
  /** Срез «давно без движения» на главной — см. services/ticketActivity. */
  staleTickets: {
    /** Молчание в рабочих днях, после которого заявка попадает в срез. */
    thresholdDays: number;
    ignoreAuto: boolean;
    ignoreUnassigned: boolean;
  };
  mikrotik: {
    isActive: boolean;
    offlineTicket: {
      isActive: boolean;
      thresholdMinutes: number;
      categoryId: Types.ObjectId | null;
    };
    configChangeTicket: {
      isActive: boolean;
      categoryId: Types.ObjectId | null;
    };
    securityUpdateTicket: {
      isActive: boolean;
      categoryId: Types.ObjectId | null;
      minSeverity: "high" | "critical";
    };
  };
}
