import type { Types } from "mongoose";

export interface IPreferences {
  timezone: string;
  htmlTicketDesc: boolean;
  useEmail: boolean;
  emailAddress: string;
  emailPassword: string;
  imapServer: string;
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
    global: { attemptsInterval: number; attempts: number };
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
      isSecure: boolean;
      port: number;
      user: string;
      pass: string;
      sendFromName: string;
      sendFromEmail: string;
    };
    byTelegram: {
      isActive: boolean;
      sendToGroup: boolean;
      chatId: string;
    };
  };
  contacts: { tel: string; email: string; address: string };
  getScreen: { isActive: boolean };
  modules: {
    timeTracking: { isActive: boolean };
    finances: { isActive: boolean };
    inventory: { isActive: boolean };
  };
  ai: {
    isActive: boolean;
    provider: "openai" | "anthropic" | "deepseek" | "yandexgpt" | "yandexai";
    openai: { apiKey: string; model: string };
    anthropic: { apiKey: string; model: string };
    deepseek: { apiKey: string; model: string };
    yandexgpt: { apiKey: string; model: string; folderId: string };
    yandexai: { apiKey: string; model: string; folderId: string };
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
    trackDomainExpiry: boolean;
    domainExpiryDays: number;
  };
}
