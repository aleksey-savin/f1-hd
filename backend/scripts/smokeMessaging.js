// Прогон «Диалогов» P0 на базе дева: события шлюза → сообщения, зеркала в
// заявку, ответ из HD, очередь и эхо, закрытие заявки. Всё созданное удаляется
// по списку _id (считаем → удаляем), чужие данные не трогаются. НЕ миграция.
//
// Запуск внутри контейнера бэкенда:  node scripts/smokeMessaging.js
require("module-alias/register");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const Channel = require("@/models/channel");
  const Conversation = require("@/models/conversation");
  const Message = require("@/models/message");
  const ChannelIdentity = require("@/models/channelIdentity");
  const ChannelJob = require("@/models/channelJob");
  const Comment = require("@/models/comment");
  const Preferences = require("@/models/preferences");
  const User = require("@/models/user");
  const { Ticket } = require("@/models/ticket");
  const InAppNotification = require("@/models/inAppNotification");
  const { validateEvent } = require("@/services/messaging/events");
  const { ingestEvent } = require("@/services/messaging/ingest");
  const { bindConversation } = require("@/services/messaging/bindings");
  const { sendFromInbox } = require("@/services/messaging/outbound");
  const { leaseJobs, ackJobs } = require("@/services/messaging/jobs");

  const created = { channels: [], tickets: [] };
  const step = (name) => console.log(`• ${name}`);
  const ingest = async (raw) => {
    const checked = validateEvent(raw);
    assert.equal(checked.ok, true, checked.error);
    const result = await ingestEvent(checked.event);
    assert.equal(result.ok, true, result.error);
    return result;
  };

  const prefs = await Preferences.findOne({}).lean();
  const serviceId = prefs?.defaultApplicant?._id;
  if (!serviceId) throw new Error("Нет служебной учётки по умолчанию (Настройки → Сбор заявок)");
  const service = await User.findById(serviceId).lean();
  const staff = await User.findOne({ isEndUser: false, isServiceAccount: { $ne: true } }).select("_id firstName lastName").lean();
  if (!staff) throw new Error("Нет сотрудника (isEndUser: false) для прогона");

  try {
    const channel = await Channel.create({ type: "telegram", name: "[SMOKE] Telegram", state: "connected", account: { displayName: "SMOKE Поддержка" } });
    created.channels.push(channel._id);
    const chatId = `smoke-${Date.now()}`;
    const at = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
    const inbound = (id, text, minutes) => ({
      type: "message",
      channelId: String(channel._id),
      chat: { id: chatId, kind: "direct", title: "SMOKE Собеседник", peer: { id: chatId, name: "SMOKE Собеседник" } },
      message: { id, direction: "in", sender: { id: chatId, name: "SMOKE Собеседник" }, kind: "text", text, sentAt: at(minutes) },
    });

    step("replay: одно событие дважды → одно сообщение, диалог ждёт ответа, один колокольчик");
    await ingest(inbound("1", "Принтер не печатает", -10));
    const conversation = await Conversation.findOne({ channelId: channel._id, externalChatId: chatId }).lean();
    const noticeLink = `/conversations/${conversation._id}`;
    const noticesAfterFirst = await InAppNotification.find({ kind: "conversationWaiting", link: noticeLink }).select("_id").lean();
    assert.ok(
      noticesAfterFirst.length >= 1,
      "Нет уведомления conversationWaiting — нужен хотя бы один активный пользователь с правом conversation.manage в деве",
    );
    await ingest(inbound("1", "Принтер не печатает", -10)); // повтор доставки того же события
    assert.equal(await Message.countDocuments({ conversationId: conversation._id, direction: "in" }), 1);
    assert.ok(conversation.awaitingSince);
    const noticesAfterReplay = await InAppNotification.find({ kind: "conversationWaiting", link: noticeLink }).select("_id").lean();
    assert.equal(
      noticesAfterReplay.length,
      noticesAfterFirst.length,
      "повтор доставки не должен добавить второй колокольчик на то же ожидание",
    );

    step("binding: привязка кладёт неотвеченное в заявку");
    const ticket = await Ticket.create({
      title: "[SMOKE] Диалоги",
      description: "smoke",
      applicantId: service._id,
      company: { _id: service.company._id, alias: service.company.alias },
      source: "Telegram",
      state: "В работе",
      createdBy: service._id,
      updatedBy: service._id,
      notifications: { lastAction: "new ticket", pending: false },
    });
    created.tickets.push(ticket._id);
    await bindConversation({ conversation, ticket, by: staff });
    const first = await Message.findOne({ conversationId: conversation._id, externalId: "1" }).lean();
    assert.equal(String(first.ticketId), String(ticket._id));
    assert.ok(first.commentId, "первое сообщение стало комментарием");

    step("bound: новое сообщение клиента — сразу комментарий, id в ticket.comments");
    await ingest(inbound("2", "Горит оранжевый", -5));
    const second = await Message.findOne({ conversationId: conversation._id, externalId: "2" }).lean();
    assert.ok(second.commentId);
    const withComments = await Ticket.findById(ticket._id).select("comments").lean();
    assert.ok(withComments.comments.map(String).includes(String(second.commentId)));

    step("outbound: ответ из «Диалогов» → комментарий, сообщение, задание; ожидание снято");
    const auth = { userId: String(staff._id), isAdmin: true, isEndUser: false, can: () => true, legacy: { responsibleForCompanies: [] } };
    const sent = await sendFromInbox({ conversationId: conversation._id, text: "Сейчас посмотрим", files: [], auth });
    assert.equal(sent.status, "queued");
    assert.ok(sent.commentId);
    assert.equal((await Conversation.findById(conversation._id).lean()).awaitingSince, null);

    step("echo before ack: эхо с jobId не плодит второе исходящее");
    const batch = await leaseJobs({ networks: ["telegram"] });
    const job = batch.jobs.find((item) => String(item.messageId) === String(sent._id));
    assert.ok(job, "задание выдано");
    await ingest({
      type: "message",
      channelId: String(channel._id),
      chat: { id: chatId, kind: "direct" },
      message: { id: "3", direction: "out", origin: "hd", jobId: String(job._id), kind: "text", text: "Сейчас посмотрим", sentAt: at(0) },
    });
    await ackJobs(batch.leaseId, [{ id: String(job._id), ok: true, result: { externalId: "3" } }]);
    assert.equal(await Message.countDocuments({ conversationId: conversation._id, direction: "out" }), 1);
    const delivered = await Message.findById(sent._id).lean();
    assert.equal(delivered.status, "sent");
    assert.equal((await Comment.findById(delivered.commentId).lean()).channel.status, "sent");

    step("after close: закрытие заканчивает привязку, новое сообщение спрашивает «о ней?»");
    const doc = await Ticket.findById(ticket._id);
    doc.isClosed = true;
    doc.state = "Закрыта";
    await doc.save();
    await new Promise((resolve) => setTimeout(resolve, 500)); // хук закрытия работает после сохранения
    await ingest(inbound("4", "Снова не печатает", 1));
    const after = await Conversation.findById(conversation._id).lean();
    assert.ok(after.binding.endedAt, "привязка закончилась");
    assert.equal(String(after.decision.ticketId), String(ticket._id));
    const fourth = await Message.findOne({ conversationId: conversation._id, externalId: "4" }).lean();
    assert.equal(fourth.ticketId, null, "в закрытую заявку не пишем");

    console.log("\nPASS");
  } finally {
    const conversations = await Conversation.find({ channelId: { $in: created.channels } }).select("_id counterpartIdentityId participants").lean();
    const conversationIds = conversations.map((c) => c._id);
    const messages = await Message.find({ conversationId: { $in: conversationIds } }).select("_id").lean();
    const comments = await Comment.find({ ticketId: { $in: created.tickets } }).select("_id").lean();
    const jobs = await ChannelJob.find({ channelId: { $in: created.channels } }).select("_id").lean();
    const identities = await ChannelIdentity.find({
      _id: { $in: conversations.flatMap((c) => [c.counterpartIdentityId, ...(c.participants || []).map((p) => p.identityId)]).filter(Boolean) },
      externalId: /^smoke-/,
    }).select("_id").lean();
    // Следы прогона вне «Диалогов»: водяной знак заявки у отправителя и
    // колокольчик «новое сообщение» у тех, кто ведёт диалоги
    const TicketRead = require("@/models/ticketRead");
    const reads = await TicketRead.find({ ticketId: { $in: created.tickets } }).select("_id").lean();
    const notices = await InAppNotification.find({
      link: { $in: conversationIds.map((id) => `/conversations/${id}`) },
    }).select("_id").lean();
    console.log(
      `Уборка: каналов ${created.channels.length}, диалогов ${conversationIds.length}, сообщений ${messages.length}, ` +
        `комментариев ${comments.length}, заданий ${jobs.length}, собеседников ${identities.length}, заявок ${created.tickets.length}, ` +
        `отметок прочтения ${reads.length}, уведомлений ${notices.length}`,
    );
    await TicketRead.deleteMany({ _id: { $in: reads.map((r) => r._id) } });
    await InAppNotification.deleteMany({ _id: { $in: notices.map((n) => n._id) } });
    await Comment.deleteMany({ _id: { $in: comments.map((c) => c._id) } });
    await Message.deleteMany({ _id: { $in: messages.map((m) => m._id) } });
    await ChannelJob.deleteMany({ _id: { $in: jobs.map((j) => j._id) } });
    await Conversation.deleteMany({ _id: { $in: conversationIds } });
    await ChannelIdentity.deleteMany({ _id: { $in: identities.map((i) => i._id) } });
    await Ticket.deleteMany({ _id: { $in: created.tickets } });
    await Channel.deleteMany({ _id: { $in: created.channels } });
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error("FAIL:", error.message);
  process.exit(1);
});
