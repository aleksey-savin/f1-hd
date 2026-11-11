/**
 * Сообщение → комментарий заявки. Идемпотентно по `channel.messageId`: повтор
 * доставки не плодит комментариев. `_id` уходит в `ticket.comments` — иначе
 * интерфейс его не увидит. Время — время мессенджера, автор — связанный
 * пользователь или служебная учётка по умолчанию с подписью в `channel.authorName`.
 * Вложения — копиями: удаление вложения из заявки удаляет файл.
 */
const { commentContent } = require("./rules");
const { commentChannel, mirrorAuthorName } = require("./present");

const mirrorToTicketLocked = async ({ message, ticket, conversation, identity, channel, prefs, skipApplicant = false, assertLease = async () => {} }) => {
  const Comment = require("@/models/comment");
  const Message = require("@/models/message");
  const { Ticket } = require("@/models/ticket");
  const storage = require("@/services/storage");

  const existing = await Comment.findOne({ "channel.messageId": message._id }).select("_id").lean();
  if (existing) {
    await assertLease();
    await Ticket.updateOne({ _id: ticket._id }, { $addToSet: { comments: existing._id } });
    await Message.updateOne({ _id: message._id }, { $set: { commentId: existing._id } });
    return existing._id;
  }

  // Автор зеркала: сам отправитель, если сообщение — от человека (ответ
  // сотрудника из HD-инбокса ещё без привязки к заявке, origin "hd", позже
  // прикреплённый через attachMessages); исходящее с телефона — служебный
  // аккаунт канала (Channel.serviceUserId); иначе связанный пользователь или
  // служебная учётка по умолчанию
  const authorId =
    message.authorUserId ||
    (message.direction === "out" ? channel?.serviceUserId : null) ||
    identity?.userId ||
    prefs?.defaultApplicant?._id;
  if (!authorId) throw new Error("Не задана служебная учётка по умолчанию (Настройки → Сбор заявок)");
  // Saved bindings remain historical identity, never authority to write after deletion.
  const User = require("@/models/user");
  const author = await User.findById(authorId).select("deletedAt").lean();
  if (author?.deletedAt) return null;

  const attachments = [];
  for (const attachment of message.attachments || []) {
    if (attachment.status !== "ready" || !attachment.name) continue;
    try {
      attachments.push({
        name: await storage.copyObject(attachment.name),
        originalName: attachment.originalName,
        mimetype: attachment.mimetype,
      });
    } catch (error) {
      require("@/utils/logger").log("warn", "Вложение сообщения не скопировано в заявку", {
        module: "messaging",
        messageId: String(message._id),
        error: error.message,
      });
    }
  }

  let comment;
  try {
    await assertLease();
    comment = await Comment.create({
      content: commentContent(message),
      ticketId: ticket._id,
      attachments,
      notifications: { lastAction: "new comment", pending: true, skipApplicant, fromConversation: true },
      channel: commentChannel({
        network: conversation.network,
        conversationId: conversation._id,
        messageId: message._id,
        direction: message.direction === "in" ? "in" : "out",
        authorName: mirrorAuthorName({ identity, message, channel, network: conversation.network }),
        status: message.direction === "out" ? message.status : undefined,
      }),
      createdBy: authorId,
      updatedBy: authorId,
      createdAt: message.sentAt,
    });
  } catch (error) {
    if (error?.code !== 11000) {
      for (const attachment of attachments) await storage.deleteObject(attachment.name).catch(() => {});
      throw error;
    }
    // Тот же приём события пришёл дважды разом: комментарий уже создала другая
    // попытка — эта проигравшая, её копии вложений некому применить
    for (const attachment of attachments) {
      await storage.deleteObject(attachment.name).catch(() => {});
    }
    await assertLease();
    const winner = await Comment.findOne({ "channel.messageId": message._id }).select("_id").lean();
    await Ticket.updateOne({ _id: ticket._id }, { $addToSet: { comments: winner._id } });
    await Message.updateOne({ _id: message._id }, { $set: { commentId: winner._id } });
    return winner._id;
  }

  // Мигает только новейшее сообщение пачки: у более старых ещё не
  // уведомивших зеркал этого диалога/заявки/направления снимаем «pending» —
  // крон комментариев уведомит один раз, самым свежим текстом
  await assertLease();
  await Comment.updateMany(
    {
      _id: { $ne: comment._id },
      ticketId: ticket._id,
      "channel.conversationId": conversation._id,
      "channel.direction": message.direction === "in" ? "in" : "out",
      "notifications.pending": true,
      createdAt: { $lte: comment.createdAt },
    },
    { $set: { "notifications.pending": false } },
  );

  await assertLease();
  await Ticket.updateOne({ _id: ticket._id }, { $addToSet: { comments: comment._id } });
  await Message.updateOne({ _id: message._id }, { $set: { commentId: comment._id } });
  return comment._id;
};

const mirrorToTicket = async (args) => require("./message-lease").withMessageLease(args.message._id, async (message, lease) => {
  // A manager may have moved or deliberately freed the message while ingest was waiting.
  if (String(message.ticketId || "") !== String(args.ticket._id) || message.attachMode === "free") return null;
  return mirrorToTicketLocked({ ...args, message, assertLease: lease.assertOwned });
});
module.exports = { mirrorToTicket, mirrorToTicketLocked };
