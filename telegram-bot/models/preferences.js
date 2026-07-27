const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// Копия контракта из backend/models/preferences.js — менять синхронно.
const channelHealth = () => ({
  lastCheckedAt: { type: Date, default: null },
  lastOkAt: { type: Date, default: null },
  lastMessageAt: { type: Date, default: null },
  lastError: { type: String, default: "" },
  lastErrorHint: { type: String, default: "" },
  lastErrorAt: { type: Date, default: null },
  consecutiveFailures: { type: Number, default: 0 },
});

const preferencesSchema = new Schema({
  timezone: { type: String, default: "Europe/Moscow" },
  htmlTicketDesc: { type: Boolean, default: false },
  // Ящик-приёмник (бот его не читает, но схема обязана совпадать с бэкендом)
  mailbox: {
    isActive: { type: Boolean, default: false },
    address: { type: String, default: "" },
    host: { type: String, default: "" },
    port: { type: Number, default: 993 },
    security: {
      type: String,
      enum: ["ssl", "starttls", "none"],
      default: "ssl",
    },
    folder: { type: String, default: "INBOX" },
    allowSelfSigned: { type: Boolean, default: false },
    user: { type: String, default: "" },
    password: { type: String, default: "" },
    health: channelHealth(),
  },
  defaultApplicant: {
    _id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    firstName: String,
    lastName: String,
  },
  defaultCompany: {
    _id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: false,
    },
    alias: String,
  },
  identifyCompany: { type: Boolean, default: false },
  identifyApplicant: { type: Boolean, default: false },
  checkPhoneNumber: { type: Boolean, default: false },
  deadline: { type: Number, default: 10 },
  notify: {
    personal: {
      newTicket: { type: Boolean, default: false },
      respStateUpdate: { type: Boolean, default: false },
      ticketStateUpdate: { type: Boolean, default: false },
      ticketNewComment: { type: Boolean, default: false },
      scheduledWorks: { type: Boolean, default: false },
    },
    // Канал отправки. Транспорт собирает services/mail/transport, health пишет
    // этот сервис при каждой отправке — по нему строка состояния в настройках
    // показывает «письма уходят» или причину сбоя.
    byEmail: {
      isActive: { type: Boolean, default: false },
      host: { type: String, default: "" },
      port: { type: Number, default: 465 },
      security: {
        type: String,
        enum: ["ssl", "starttls", "none"],
        default: "ssl",
      },
      allowSelfSigned: { type: Boolean, default: false },
      authMethod: {
        type: String,
        enum: ["password", "none"],
        default: "password",
      },
      user: { type: String, default: "" },
      pass: { type: String, default: "" },
      sendFromName: { type: String, default: "" },
      sendFromEmail: { type: String, default: "" },
      health: channelHealth(),
    },
    // Единственная группа Telegram команды: сюда идут групповые уведомления и
    // здесь же живёт табло статусов; messageThreadId (ветка форум-группы)
    // действует на оба потока ("" → General-топик или не форум)
    byTelegram: {
      isActive: { type: Boolean, default: false },
      sendToGroup: { type: Boolean, default: false },
      chatId: { type: String, default: "" },
      messageThreadId: { type: String, default: "" },
    },
  },
  // Табло статусов сотрудников: одно закреплённое сообщение в группе
  // notify.byTelegram (chatId + messageThreadId), которое бот редактирует.
  // isActive — конфигурация (веб-настройки или команда /status_board);
  // messageId/lastText — служебные поля бота (кэш рендера для no-op сравнения).
  statusBoard: {
    isActive: { type: Boolean, default: false },
    messageId: { type: Number, default: null },
    lastText: { type: String, default: "" },
  },
  contacts: {
    tel: { type: String, default: "" },
    email: { type: String, default: "" },
    address: { type: String, default: "" },
  },
  getScreen: {
    isActive: { type: Boolean, default: false },
  },
  modules: {
    timeTracking: { isActive: { type: Boolean, default: false } },
    finances: { isActive: { type: Boolean, default: false } },
    inventory: { isActive: { type: Boolean, default: false } },
  },
  // Зеркало backend ai-настроек — telegram-bot использует их для автоопределения
  // категории заявки. Достаточно провайдера, ключа и модели текстовой генерации.
  ai: {
    isActive: { type: Boolean, default: false },
    provider: {
      type: String,
      enum: ["openai", "anthropic", "deepseek", "yandexgpt", "yandexai"],
    },
    openai: {
      apiKey: { type: String, default: "" },
      model: { type: String, default: "gpt-4o" },
    },
    anthropic: {
      apiKey: { type: String, default: "" },
      model: { type: String, default: "claude-opus-4-8" },
    },
    deepseek: {
      apiKey: { type: String, default: "" },
      model: { type: String, default: "deepseek-chat" },
    },
    yandexgpt: {
      apiKey: { type: String, default: "" },
      folderId: { type: String, default: "" },
      model: { type: String, default: "yandexgpt" },
    },
    yandexai: {
      apiKey: { type: String, default: "" },
      folderId: { type: String, default: "" },
      model: { type: String, default: "deepseek-r1" },
    },
  },
});

module.exports = mongoose.model("Preferences", preferencesSchema);
