const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Подключённый канал «Диалогов»: корпоративный аккаунт Telegram или WhatsApp
 * (сессию держит шлюз msg-gateway), бот MAX или форма сайта.
 *
 * Секреты — шифртексты secretBox (services/crypto/secretBox.js); наружу их
 * расшифрованными получает только шлюз (controllers/gateway.js). Сессии
 * мессенджеров здесь НЕ хранятся: они живут в томе шлюза, иначе копия базы на
 * деве (sync-dev-db.sh) унесла бы живую сессию прода.
 */
const channelSchema = new Schema(
  {
    type: { type: String, enum: ["telegram", "whatsapp", "max", "site"], required: true },
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    state: {
      type: String,
      enum: [
        "disconnected",
        "connecting",
        "awaitingQr",
        "awaitingCode",
        "awaitingPassword",
        "connected",
        "loggedOut",
        "banned",
        "error",
      ],
      default: "disconnected",
    },
    stateReason: { type: String, default: "" },
    account: {
      externalId: { type: String, default: "" },
      displayName: { type: String, default: "" },
      username: { type: String, default: "" },
      phone: { type: String, default: "" },
    },
    // Вход по QR: шлюз присылает код, страница настроек его показывает
    login: {
      qr: { type: String, default: null },
      expiresAt: { type: Date, default: null },
    },
    gatewaySeenAt: { type: Date, default: null },
    lastMessageAt: { type: Date, default: null },
    // Когда администраторам последний раз звонил колокольчик о состоянии
    // «error» — не чаще раза в 6 часов (services/messaging/channelAlert.js)
    errorAlertedAt: { type: Date, default: null },
    settings: {
      proxyUrl: { type: String, default: "" },
      historyDays: { type: Number, default: 14, min: 0, max: 90 },
      importGroups: { type: Boolean, default: true },
      markReadOnOpen: { type: Boolean, default: true },
      signReplies: { type: Boolean, default: true },
      maxMediaMb: { type: Number, default: 50, min: 1, max: 200 },
      ignoredChatIds: { type: [String], default: [] },
      site: {
        formKey: { type: String, default: undefined },
        allowedOrigins: { type: [String], default: [] },
        consentText: { type: String, default: "" },
      },
    },
    secrets: {
      tgApiId: { type: String, default: "" },
      tgApiHash: { type: String, default: "" },
      proxyPassword: { type: String, default: "" },
      maxToken: { type: String, default: "" },
      maxWebhookSecret: { type: String, default: "" },
    },
    // Автор зеркал «с телефона»; не задан — служебная учётка по умолчанию
    serviceUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

channelSchema.index({ type: 1, isActive: 1 });
channelSchema.index({ "settings.site.formKey": 1 }, { unique: true, sparse: true });

// Настройки каналов узнают о входе по QR и смене состояния из пульса — тема
// «channels» (сигнал шлюза и отметка сообщения — шум, services/pulseTopics.js)
channelSchema.plugin(require("../services/pulsePlugin"), { model: "Channel" });

module.exports = mongoose.model("Channel", channelSchema);
