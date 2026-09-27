// «Диалоги» P1: демо-данные для живой проверки интерфейса без шлюза.
// Только дев. НЕ миграция и НЕ часть migrate.js.
//
// Создаёт «[DEMO]»-каналы (Telegram и форма сайта), компанию, двух клиентов,
// заявку и диалоги НАСТОЯЩИМИ путями: приём событий (ingest), ответ из HD
// (outbound) и подтверждения шлюза (jobs). Автор ответов — существующий
// сотрудник (первый администратор): его документ не меняется, на него только
// ссылаются. Модуль «Диалоги» скрипт не включает — это делает человек в
// «Настройки → Модули».
//
// Уборка — `--remove`: всё демо находится от «[DEMO]»-каналов и адресов
// @demo-p1.invalid, сначала считается, потом удаляется по списку _id. Чужие
// данные не трогаются.
//
//   docker compose -f compose.dev.yml exec backend node scripts/seedDemoConversations.js
//   docker compose -f compose.dev.yml exec backend node scripts/seedDemoConversations.js --remove
require("module-alias/register");
const mongoose = require("mongoose");

const TAG = "[DEMO]";
const TAG_RE = /^\[DEMO\] /;
// Внешние id собеседников и чатов: ни с чем настоящим не совпадут
const EXT = "demo-p1-";
const MAIL_DOMAIN = "demo-p1.invalid";

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000);

const models = () => ({
  Channel: require("@/models/channel"),
  Conversation: require("@/models/conversation"),
  Message: require("@/models/message"),
  ChannelIdentity: require("@/models/channelIdentity"),
  ChannelJob: require("@/models/channelJob"),
  ConversationRead: require("@/models/conversationRead"),
  Comment: require("@/models/comment"),
  Company: require("@/models/company"),
  User: require("@/models/user"),
  Ticket: require("@/models/ticket").Ticket,
  TicketRead: require("@/models/ticketRead"),
  TicketLog: require("@/models/ticketLog"),
  InAppNotification: require("@/models/inAppNotification"),
  Preferences: require("@/models/preferences"),
});

/** Все демо-документы по коллекциям — и для проверки «уже есть», и для уборки. */
const collect = async (m) => {
  const channels = await m.Channel.find({ name: TAG_RE }).select("_id").lean();
  const channelIds = channels.map((doc) => doc._id);
  const conversations = await m.Conversation.find({ channelId: { $in: channelIds } })
    .select("_id counterpartIdentityId participants binding")
    .lean();
  const conversationIds = conversations.map((doc) => doc._id);
  const messages = await m.Message.find({ conversationId: { $in: conversationIds } }).select("_id ticketId identityId").lean();
  const identityIds = [
    ...conversations.flatMap((doc) => [doc.counterpartIdentityId, ...(doc.participants || []).map((p) => p.identityId)]),
    ...messages.map((msg) => msg.identityId),
  ].filter(Boolean);
  const identities = await m.ChannelIdentity.find({
    _id: { $in: identityIds },
    externalId: { $regex: `^${EXT}` },
  })
    .select("_id")
    .lean();
  const jobs = await m.ChannelJob.find({ channelId: { $in: channelIds } }).select("_id").lean();
  const reads = await m.ConversationRead.find({ conversationId: { $in: conversationIds } }).select("_id").lean();
  const candidateTickets = [
    ...new Set(
      [...conversations.map((doc) => doc.binding?.ticketId), ...messages.map((doc) => doc.ticketId)]
        .filter(Boolean)
        .map(String),
    ),
  ];
  // Только заявки, заведённые скриптом: «[DEMO]» в теме
  const tickets = await m.Ticket.find({ _id: { $in: candidateTickets }, title: TAG_RE }).select("_id").lean();
  const ticketIds = tickets.map((doc) => doc._id);
  const comments = await m.Comment.find({ ticketId: { $in: ticketIds } }).select("_id").lean();
  const ticketReads = await m.TicketRead.find({ ticketId: { $in: ticketIds } }).select("_id").lean();
  const ticketLogs = await m.TicketLog.find({ ticketId: { $in: ticketIds } }).select("_id").lean();
  const notices = await m.InAppNotification.find({
    $or: [
      { link: { $in: conversationIds.map((id) => `/conversations/${id}`) } },
      { ticketId: { $in: ticketIds } },
    ],
  })
    .select("_id")
    .lean();
  const users = await m.User.find({ email: new RegExp(`@${MAIL_DOMAIN.replace(".", "\\.")}$`) }).select("_id").lean();
  const companies = await m.Company.find({ alias: TAG_RE }).select("_id").lean();
  return {
    InAppNotification: notices,
    TicketRead: ticketReads,
    TicketLog: ticketLogs,
    Comment: comments,
    Message: messages,
    ConversationRead: reads,
    ChannelJob: jobs,
    Conversation: conversations,
    ChannelIdentity: identities,
    Ticket: tickets,
    User: users,
    Company: companies,
    Channel: channels,
  };
};

const remove = async (m) => {
  const found = await collect(m);
  const total = Object.values(found).reduce((sum, list) => sum + list.length, 0);
  if (!total) {
    console.log("Демо-данных нет — удалять нечего.");
    return;
  }
  console.log("Будет удалено:");
  for (const [name, list] of Object.entries(found)) console.log(`  ${name}: ${list.length}`);
  // Порядок — от зависимых к основам; каждое удаление — по списку _id
  for (const [name, list] of Object.entries(found)) {
    if (!list.length) continue;
    await m[name].deleteMany({ _id: { $in: list.map((doc) => doc._id) } });
  }
  console.log("Готово.");
};

const seed = async (m) => {
  const already = await collect(m);
  if (already.Channel.length || already.User.length || already.Company.length) {
    throw new Error("Демо-данные уже есть — сначала `--remove`");
  }

  const { validateEvent } = require("@/services/messaging/events");
  const { ingestEvent } = require("@/services/messaging/ingest");
  const { bindConversation } = require("@/services/messaging/bindings");
  const { sendFromInbox } = require("@/services/messaging/outbound");
  const { leaseJobs, ackJobs } = require("@/services/messaging/jobs");

  const staff = await m.User.findOne({ isEndUser: false, isServiceAccount: { $ne: true }, banned: { $ne: true } })
    .sort({ isAdmin: -1, createdAt: 1 })
    .select("_id firstName lastName")
    .lean();
  if (!staff) throw new Error("Нет сотрудника (isEndUser: false) — ответы из HD писать некому");
  const auth = {
    userId: String(staff._id),
    isAdmin: true,
    isEndUser: false,
    can: () => true,
    legacy: { responsibleForCompanies: [] },
  };

  const ingest = async (raw) => {
    const checked = validateEvent(raw);
    if (!checked.ok) throw new Error(`Событие не прошло проверку: ${checked.error}`);
    const result = await ingestEvent(checked.event);
    if (!result.ok) throw new Error(`Событие не принято: ${result.error}`);
  };
  const say = (channel, chat, message, minutes) =>
    ingest({
      type: "message",
      channelId: String(channel._id),
      at: minutesAgo(minutes).toISOString(),
      chat,
      message: { sentAt: minutesAgo(minutes).toISOString(), kind: "text", ...message },
    });
  const conversationOf = (channel, chat) =>
    m.Conversation.findOne({ channelId: channel._id, externalChatId: chat.id }).lean();

  // Письма и бот о демо-заявке никому не нужны: крон уведомлений берёт только
  // `notifications.pending`, его и гасим после каждого шага
  const quiet = async (ticketId) => {
    await m.Comment.updateMany({ ticketId, "notifications.pending": true }, { $set: { "notifications.pending": false } });
    await m.Ticket.updateOne({ _id: ticketId }, { $set: { "notifications.pending": false } });
  };

  /**
   * Ответ из HD настоящим путём, затем «шлюз»: отправлено → нужный статус.
   * Время ответа сдвигается в прошлое сырым обновлением (демо должно
   * выглядеть как переписка, а не как пачка «только что»).
   */
  const reply = async ({ channel, chat, text, minutes, outcome, externalId }) => {
    const conversation = await conversationOf(channel, chat);
    const sent = await sendFromInbox({ conversationId: conversation._id, text, files: [], auth });
    const when = minutesAgo(minutes);
    await m.Message.collection.updateOne({ _id: sent._id }, { $set: { sentAt: when } });
    if (sent.commentId) await m.Comment.collection.updateOne({ _id: sent.commentId }, { $set: { createdAt: when } });
    await m.Conversation.collection.updateOne(
      { _id: conversation._id, "lastMessage.at": { $gt: when } },
      { $set: { "lastMessage.at": when } },
    );
    // Широкая выдача: в деве могут висеть чужие задания без шлюза
    const batch = await leaseJobs({ networks: [channel.type], limit: 50 });
    const job = batch.jobs.find((item) => String(item.messageId) === String(sent._id));
    if (!job) throw new Error("Задание отправки не выдано");
    if (outcome === "failed") {
      await ackJobs(batch.leaseId, [{ id: String(job._id), ok: false, retryable: false, error: "PEER_FLOOD" }]);
      return;
    }
    await ackJobs(batch.leaseId, [{ id: String(job._id), ok: true, result: { externalId } }]);
    if (outcome === "read") {
      await ingest({ type: "message.status", channelId: String(channel._id), status: "read", jobId: String(job._id) });
    }
  };

  const prefs = await m.Preferences.findOne({}).select("modules.messaging").lean();

  const telegram = await m.Channel.create({
    type: "telegram",
    name: `${TAG} Telegram`,
    state: "connected",
    account: { displayName: "F1Lab Поддержка", phone: "+7 (423) 200-00-00", username: "f1lab_support" },
    settings: { proxyUrl: "socks5://relay.example.invalid:1080", historyDays: 14 },
    gatewaySeenAt: new Date(),
  });
  const site = await m.Channel.create({
    type: "site",
    name: `${TAG} Форма с сайта`,
    state: "connected",
    settings: { site: { formKey: `${EXT}${Date.now()}` } },
  });
  const company = await m.Company.create({ alias: `${TAG} ТД Восток`, fullTitle: `${TAG} ООО «ТД Восток»` });
  const client = (firstName, lastName, position, key) =>
    m.User.create({
      email: `${key}@${MAIL_DOMAIN}`,
      firstName,
      lastName,
      position,
      isEndUser: true,
      company: { _id: company._id, alias: company.alias },
      // Опознание по Telegram id — как у настоящих клиентов; бот не включён
      telegramBot: { isActive: false, chatId: `${EXT}${key}` },
    });
  const marina = await client("Марина", "Соколова", "Бухгалтер", "marina");
  const oleg = await client("Олег", "Смирнов", "Директор", "oleg");

  const ticket = await m.Ticket.create({
    title: `${TAG} Не печатает принтер в бухгалтерии`,
    description: "<p>Доброе утро! В бухгалтерии опять не печатает принтер, документы висят в очереди.</p>",
    applicantId: marina._id,
    company: { _id: company._id, alias: company.alias },
    responsibles: [{ _id: staff._id, firstName: staff.firstName, lastName: staff.lastName }],
    source: "Telegram",
    state: "В работе",
    deadline: new Date(Date.now() + 6 * 3_600_000),
    createdBy: staff._id,
    updatedBy: staff._id,
    notifications: { lastAction: "new ticket", pending: false },
  });

  // 1. Соколова Марина — личный чат, привязан к заявке, ждёт ответа 12 мин
  const marinaPeer = { id: `${EXT}marina`, firstName: "Марина", lastName: "Соколова", username: "m_sokolova" };
  const marinaChat = { id: `${EXT}chat-marina`, kind: "direct", title: "Марина Соколова", peer: marinaPeer };
  await say(telegram, marinaChat, { id: "m1", direction: "in", sender: marinaPeer, text: "Доброе утро! В бухгалтерии опять не печатает принтер, документы висят в очереди." }, 44);
  await reply({ channel: telegram, chat: marinaChat, text: "Доброе утро, Марина! Сейчас посмотрю — подключусь удалённо.", minutes: 40, outcome: "read", externalId: `${EXT}out-1` });
  await bindConversation({ conversation: await conversationOf(telegram, marinaChat), ticket, by: staff, attachPending: true, eventKind: "ticketCreated" });
  await reply({ channel: telegram, chat: marinaChat, text: "Очередь очистил. Подскажите, какой индикатор горит на самом принтере?", minutes: 37, outcome: "read", externalId: `${EXT}out-2` });
  await say(telegram, marinaChat, {
    id: "m2",
    direction: "in",
    sender: marinaPeer,
    kind: "photo",
    text: "Вот так мигает",
    attachments: [{ status: "skipped", originalName: "IMG_2291.jpg", mimetype: "image/jpeg", size: 1_887_436 }],
  }, 12);
  await say(telegram, marinaChat, {
    id: "m3",
    direction: "in",
    sender: marinaPeer,
    kind: "voice",
    attachments: [{ status: "skipped", mimetype: "audio/ogg", size: 23_000, durationSec: 14 }],
  }, 11);
  await say(telegram, marinaChat, { id: "m4", direction: "in", sender: marinaPeer, text: "Оранжевый мигает. Бумагу вынимали, не помогло.", replyToId: `${EXT}out-2` }, 1);
  const marinaConversation = await conversationOf(telegram, marinaChat);
  await m.Conversation.updateOne({ _id: marinaConversation._id }, { $set: { assigneeId: staff._id } });
  await quiet(ticket._id);

  // 2. Смирнов Олег — опознан, без заявки; наш ответ не доставлен («Повторить»)
  const olegPeer = { id: `${EXT}oleg`, firstName: "Олег", lastName: "Смирнов" };
  const olegChat = { id: `${EXT}chat-oleg`, kind: "direct", title: "Олег Смирнов", peer: olegPeer };
  await say(telegram, olegChat, { id: "o1", direction: "in", sender: olegPeer, text: "Добрый день! Нужен доступ к общей папке для нового бухгалтера." }, 60);
  await reply({ channel: telegram, chat: olegChat, text: "Олег, добрый день! Уточните, пожалуйста, как зовут нового сотрудника.", minutes: 55, outcome: "failed" });
  await say(telegram, olegChat, { id: "o2", direction: "in", sender: olegPeer, text: "Коллеги, в 14:00 у нас встреча с партнёрами — успеете?" }, 23);
  await say(telegram, olegChat, { id: "o3", direction: "in", sender: olegPeer, text: "Есть кто живой?" }, 9);

  // 3. Андрей — неизвестный собеседник: «Кто это?»
  const andreyPeer = { id: `${EXT}andrey`, firstName: "Андрей", username: "andrey_primavto" };
  const andreyChat = { id: `${EXT}chat-andrey`, kind: "direct", title: "Андрей", peer: andreyPeer };
  await say(telegram, andreyChat, { id: "a1", direction: "in", sender: andreyPeer, text: "Здравствуйте! У нас в офисе на Алеутской, 45 с утра не работает интернет." }, 37);
  await say(telegram, andreyChat, { id: "a2", direction: "in", sender: andreyPeer, text: "Это Андрей, Примавто. Роутер перезагружали, не помогло." }, 36);

  // 4. Белов Сергей — вчерашний, ответили с телефона: не ждёт
  const belovPeer = { id: `${EXT}belov`, firstName: "Сергей", lastName: "Белов" };
  const belovChat = { id: `${EXT}chat-belov`, kind: "direct", title: "Сергей Белов", peer: belovPeer };
  await say(telegram, belovChat, { id: "b1", direction: "in", sender: belovPeer, text: "Когда приедет инженер?" }, 26 * 60);
  await say(telegram, belovChat, { id: "b2", direction: "out", text: "Завтра в 10 приедет инженер" }, 25 * 60);

  // 5. Группа — должна просто показываться (выбор сообщений — этап P2)
  const kostya = { id: `${EXT}kostya`, firstName: "Костя", username: "kostya_it" };
  const groupChat = {
    id: `${EXT}chat-group`,
    kind: "group",
    title: `${TAG} ТД Восток × F1Lab`,
    participants: [olegPeer, kostya],
  };
  await say(telegram, groupChat, { id: "g1", direction: "in", sender: olegPeer, text: "В переговорной не работает HDMI — проектор пишет «нет сигнала»" }, 31);
  await say(telegram, groupChat, { id: "g2", direction: "in", sender: kostya, text: "Кабель я проверял, он целый" }, 30);

  // 6. Форма сайта — должна просто показываться (карточка формы — этап P5)
  const formPerson = { id: `${EXT}form-1`, name: "Кравцова Елена" };
  await say(site, { id: `${EXT}form-1`, kind: "form", title: "Кравцова Елена", peer: formPerson }, {
    id: "f1",
    direction: "in",
    origin: "form",
    kind: "form",
    sender: formPerson,
    form: {
      fields: [
        { label: "Имя", value: "Кравцова Елена" },
        { label: "Компания", value: "ООО «Северный порт»" },
        { label: "Сообщение", value: "Нужна абонентская поддержка для 12 компьютеров и сервера 1С." },
      ],
    },
  }, 59);

  await quiet(ticket._id);

  const created = await collect(m);
  console.log("Демо «Диалогов» создано:");
  for (const [name, list] of Object.entries(created)) if (list.length) console.log(`  ${name}: ${list.length}`);
  console.log(`Автор ответов из HD: ${staff.lastName} ${staff.firstName}`);
  if (!prefs?.modules?.messaging?.isActive) {
    console.log("Модуль «Диалоги» выключен — включите его: Настройки системы → Модули → «Диалоги».");
  }
  console.log("Убрать всё демо: node scripts/seedDemoConversations.js --remove");
};

const run = async () => {
  // Только дев (см. заголовок файла) — от прода отгораживаемся до подключения
  if (process.env.NODE_ENV === "production") {
    throw new Error("Демо-данные «Диалогов» — только дев: в проде скрипт не запускается");
  }
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const m = models();
  try {
    if (process.argv.includes("--remove")) await remove(m);
    else await seed(m);
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error("FAIL:", error.message);
  process.exit(1);
});
