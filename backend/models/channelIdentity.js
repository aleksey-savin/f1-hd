const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Собеседник в одной сети: Telegram-id, телефон WhatsApp, user_id MAX, почта
 * или телефон с формы сайта. Связь с пользователем HD — только по твёрдому
 * основанию (services/messaging/identity.js), поэтому у пользователя своих
 * полей мессенджеров нет: страж staffContacts видит их полный список.
 */
const channelIdentitySchema = new Schema(
  {
    network: { type: String, enum: ["telegram", "whatsapp", "max", "site"], required: true },
    externalId: { type: String, required: true },
    // Другие идентификаторы того же человека в сети (WhatsApp: телефон ↔ LID)
    aliases: { type: [String], default: [] },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    displayName: { type: String, default: "" },
    username: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    isBot: { type: Boolean, default: false },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    linkMethod: {
      type: String,
      enum: ["tgBot", "phone", "pairing", "manual", "email", null],
      default: null,
    },
    isStaff: { type: Boolean, default: false },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
  },
  { timestamps: true },
);

channelIdentitySchema.index({ network: 1, externalId: 1 }, { unique: true });
channelIdentitySchema.index({ network: 1, aliases: 1 });
channelIdentitySchema.index({ userId: 1 });
channelIdentitySchema.index({ phone: 1 }, { sparse: true });

channelIdentitySchema.plugin(require("../services/pulsePlugin"), { model: "ChannelIdentity" });

module.exports = mongoose.model("ChannelIdentity", channelIdentitySchema);
