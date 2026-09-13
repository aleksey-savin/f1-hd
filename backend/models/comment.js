const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const commentSchema = new Schema(
  {
    content: {
      type: String,
      required: true,
    },
    // Цитируемая переписка, отрезанная от почтового ответа (хвост письма).
    // В content остаётся только новый текст; хвост раскрывается в UI по клику.
    quotedText: {
      type: String,
    },
    attachments: [
      {
        mimetype: String,
        name: String,
        originalName: String,
      },
    ],
    // legacy, delete after 1.8.9
    ticket: {
      type: Number,
    },
    // ---------------
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
    },
    notifications: {
      lastAction: String,
      pending: Boolean,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

// Новый комментарий — движение заявки (точка «непрочитано» в списках, см.
// services/ticketSeen.js). Пометку «новый» берём в pre-save: в post-save
// isNew уже сброшен. Хук асинхронный, и Mongoose его дожидается — поэтому
// «отметить просмотренным» после `comment.save()` гарантированно позже
// движения. Сбой обновления комментарий не роняет.
commentSchema.pre("save", function rememberNew() {
  this.$locals.wasNew = this.isNew;
});
commentSchema.post("save", async function bumpTicketActivity(doc) {
  if (!doc.$locals || !doc.$locals.wasNew) return;
  try {
    await mongoose.model("Ticket").updateOne(
      { _id: doc.ticketId },
      {
        $set: {
          activity: { at: doc.createdAt || new Date(), by: doc.createdBy },
        },
      },
    );
  } catch (error) {
    console.warn(
      "activity заявки не обновлена по комментарию:",
      error?.message || error,
    );
  }
});

// Живые обновления: комментарий двигает свою заявку (см. services/pulseTopics.js)
commentSchema.plugin(require("../services/pulsePlugin"), { model: "Comment" });

module.exports = mongoose.model("Comment", commentSchema);
