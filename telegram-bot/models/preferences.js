const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const preferencesSchema = new Schema({
  timezone: { type: String, default: "Europe/Moscow" },
  htmlTicketDesc: { type: Boolean, default: false },
  useEmail: { type: Boolean, default: false },
  emailAddress: { type: String, default: "" },
  emailPassword: { type: String, default: "" },
  imapServer: { type: String, default: "" },
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
    global: {
      attemptsInterval: { type: Number, default: 15 },
      attempts: { type: Number, default: 3 },
    },
    personal: {
      newTicket: { type: Boolean, default: false },
      respStateUpdate: { type: Boolean, default: false },
      ticketStateUpdate: { type: Boolean, default: false },
      ticketNewComment: { type: Boolean, default: false },
      scheduledWorks: { type: Boolean, default: false },
    },
    byEmail: {
      isActive: { type: Boolean, default: false },
      host: { type: String, default: "" },
      isSecure: { type: Boolean, default: false },
      port: { type: Number, default: 465 },
      user: { type: String, default: "" },
      pass: { type: String, default: "" },
      sendFromName: { type: String, default: "" },
      sendFromEmail: { type: String, default: "" },
    },
    byTelegram: {
      isActive: { type: Boolean, default: false },
      sendToGroup: { type: Boolean, default: false },
      chatId: { type: String, default: "" },
    },
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
    provider: { type: String, enum: ["openai", "anthropic"] },
    openai: {
      apiKey: { type: String, default: "" },
      model: { type: String, default: "gpt-4o" },
    },
    anthropic: {
      apiKey: { type: String, default: "" },
      model: { type: String, default: "claude-opus-4-8" },
    },
  },
});

module.exports = mongoose.model("Preferences", preferencesSchema);
