/**
 * Мелкие общие операции диалога: номер в ленте, системная строка, «говорит ли
 * здесь этот человек», имя собеседника.
 */
const { identityName } = require("./rules");
const { userName } = require("./present");

/** Следующий номер сообщения в диалоге — порядок при равном времени. */
const nextSeq = async (conversationId) => {
  const Conversation = require("@/models/conversation");
  const doc = await Conversation.findOneAndUpdate(
    { _id: conversationId },
    { $inc: { lastSeq: 1 } },
    { returnDocument: "after", projection: { lastSeq: 1 } },
  ).lean();
  return doc.lastSeq;
};

/** Системная строка ленты («Создана заявка №…», «Ответ не нужен · …»). */
const addSystemLine = async (conversation, { kind, ticketNum, by, targetName, count }) => {
  const Message = require("@/models/message");
  const seq = await nextSeq(conversation._id);
  return Message.create({
    conversationId: conversation._id,
    channelId: conversation.channelId,
    externalChatId: conversation.externalChatId,
    seq,
    direction: "system",
    origin: "system",
    kind: "event",
    sentAt: new Date(),
    status: "received",
    effects: { conversation: true, attach: true, notify: true },
    event: {
      kind,
      ticketNum: ticketNum ?? undefined,
      byUserId: by?._id ?? undefined,
      byName: by ? userName(by) : undefined,
      targetName: targetName || undefined,
      count: count ?? undefined,
    },
  });
};

/** Участвует ли пользователь в диалоге (собеседник или участник группы). */
const userTalksHere = async (conversation, userId) => {
  if (!userId) return false;
  const ChannelIdentity = require("@/models/channelIdentity");
  const ids = [conversation.counterpartIdentityId, ...(conversation.participants || []).map((p) => p.identityId)].filter(Boolean);
  if (!ids.length) return false;
  return Boolean(await ChannelIdentity.exists({ _id: { $in: ids }, userId }));
};

/** «Фамилия Имя» связанного пользователя или имя из мессенджера. */
const displayNameFor = async (identity) => {
  if (!identity) return "";
  if (identity.userId) {
    const User = require("@/models/user");
    const user = await User.findById(identity.userId).select("firstName lastName").lean();
    if (user) return userName(user);
  }
  return identityName(identity);
};

module.exports = { nextSeq, addSystemLine, userTalksHere, displayNameFor };
