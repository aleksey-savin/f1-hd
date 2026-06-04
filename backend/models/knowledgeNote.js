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
  },
  { timestamps: true },
);

knowledgeNoteSchema.index({ "companies._id": 1 });
knowledgeNoteSchema.index({ "users._id": 1 });
knowledgeNoteSchema.index({ "categories._id": 1 });
knowledgeNoteSchema.index({ title: 1 });

module.exports = mongoose.model("KnowledgeNote", knowledgeNoteSchema);
