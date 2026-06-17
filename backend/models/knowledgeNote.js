const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const knowledgeNoteSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
    },
    // Markdown-контент из Toast UI Editor
    content: {
      type: String,
      default: "",
    },
    // Денормализованный текст без тегов для глобального поиска
    plainText: {
      type: String,
      default: "",
    },
    companies: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          ref: "Company",
        },
        alias: String,
      },
    ],
    users: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        firstName: String,
        lastName: String,
        // Компания пользователя нужна для правила видимости:
        // заметка, связанная с пользователем, видна тем, кому доступна его компания
        company: {
          _id: {
            type: Schema.Types.ObjectId,
            ref: "Company",
          },
          alias: String,
        },
      },
    ],
    categories: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          ref: "TicketCategory",
        },
        title: String,
      },
    ],
    // Назначение заметки: общая информация / известные проблемы / инструкции
    type: {
      type: String,
      enum: ["info", "backlog", "instructions"],
      default: "info",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    // Модерация: заметка создаётся неодобренной и требует одобрения модератора.
    // Существующие заметки (без поля approved) тоже считаются неодобренными —
    // в коде проверяем approved !== true, а скрипт backfillNoteApproval
    // проставляет им approved: false явно.
    approved: {
      type: Boolean,
      default: false,
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    approvedAt: {
      type: Date,
      required: false,
    },
    // Двухэтапное удаление: заявка на удаление ждёт подтверждения модератора
    pendingDeletion: {
      type: Boolean,
      default: false,
    },
    pendingDeletionBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    pendingDeletionAt: {
      type: Date,
      required: false,
    },
    // Результат почасового сканера на утечку секретов (пароли, ключи, токены).
    // Сырой секрет не сохраняем — только тип правила и замаскированный фрагмент.
    secretsScan: {
      flagged: { type: Boolean, default: false },
      findings: [
        {
          category: String, // идентификатор правила, напр. "aws-access-key"
          location: String, // "title" | "content"
          maskedSnippet: String, // замаскированный фрагмент, напр. AKIA••••1234
          hash: String, // sha256 значения — для дедупа и игнор-листа; сырой секрет не храним
        },
      ],
      // Хэши значений, помеченных модератором как «не секрет» — пропускаем при
      // сканировании. Храним хэш, а не текст: новый реальный секрет (другое
      // значение) в той же заметке всё равно сработает.
      ignoredHashes: [String],
      scannedAt: Date,
    },
    // Архивирование: двухэтапно, как удаление. Менеджер запрашивает архивацию
    // (pendingArchive), модератор подтверждает — ставится archivedAt, и заметка
    // исчезает отовсюду. Восстановить (снять archivedAt) может менеджер.
    pendingArchive: {
      type: Boolean,
      default: false,
    },
    pendingArchiveBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    pendingArchiveAt: {
      type: Date,
      required: false,
    },
    archivedAt: {
      type: Date,
      required: false,
    },
    archivedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    // Отслеживание продления услуг: таблицы услуг (домены, хостинг и т. п.)
    // парсятся из content (см. services/serviceExpiryScanner) — сюда складываются
    // распознанные записи.
    serviceExpiry: {
      entries: [
        {
          service: String,
          registrar: String,
          expiresAt: Date,
        },
      ],
      scannedAt: Date,
    },
  },
  { timestamps: true },
);

knowledgeNoteSchema.index({ "companies._id": 1 });
knowledgeNoteSchema.index({ "users._id": 1 });
knowledgeNoteSchema.index({ "categories._id": 1 });
knowledgeNoteSchema.index({ title: 1 });
knowledgeNoteSchema.index({ type: 1 });
knowledgeNoteSchema.index({ approved: 1, approvedAt: 1 });
knowledgeNoteSchema.index({ pendingDeletion: 1 });
knowledgeNoteSchema.index({ "secretsScan.flagged": 1 });
knowledgeNoteSchema.index({ archivedAt: 1 });
knowledgeNoteSchema.index({ pendingArchive: 1 });
knowledgeNoteSchema.index({ "serviceExpiry.entries.expiresAt": 1 });

module.exports = mongoose.model("KnowledgeNote", knowledgeNoteSchema);
