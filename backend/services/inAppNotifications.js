const { htmlToPlainText } = require("@/helpers/htmlToPlainText");
const logger = require("@/utils/logger");

/**
 * Уведомления «в приложении» — колокольчик.
 *
 * Третий канал рядом с почтой и Telegram, но со своей коллекцией
 * (`InAppNotification`): очередь `Notification` — исходящие сообщения без
 * адресата-пользователя и без состояния «прочитано», а здесь документ — это
 * строка в списке конкретного человека.
 *
 * Кто что получает, задаёт ТАБЛИЦА событий, а не ветки в
 * middleware/notifications.js: крон вызывает `notifyTicketEvent` один раз на
 * заявку перед своим `switch`, и аудитория каждого события описана в одном
 * месте. Аудитории повторяют почтовые ветки крона: заявитель, ответственные,
 * ещё не уведомлённые ответственные (защёлка `isNotified.inApp`, как у
 * telegram/email), менеджеры (`ticket.manage`).
 *
 * Гейт получателя тот же, что у остальных каналов, минус канал: категория
 * включена глобально (`prefs.notify.personal[X]`) и не выключена у человека
 * (`user.notify.inApp[X] !== false` — отсутствие поля значит «включено»,
 * см. services/absenceNotifications.js). Автор события своё уведомление не
 * получает; служебные и заблокированные учётки — не адресаты (у них нет
 * входа в приложение). Сами заявки — машинные и людские — не различаются.
 *
 * Сборщики (`build*`) — чистые функции над готовыми документами, тесты без
 * базы; `notify*` подгружают людей и пишут.
 */

const EXCERPT_LIMIT = 200;

const excerpt = (html, limit = EXCERPT_LIMIT) => {
  const text = htmlToPlainText(html || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

const idOf = (value) =>
  value && typeof value === "object" && "_id" in value
    ? String(value._id)
    : value == null
      ? ""
      : String(value);

const personName = (user) =>
  `${user?.lastName || ""} ${user?.firstName || ""}`.trim();

/**
 * Снимок автора для строки списка. Служебная учётка (мониторинг, почта) —
 * такой же автор: машинная заявка ничем не отличается от обычной.
 */
const snapshot = (user) =>
  user
    ? { _id: user._id, firstName: user.firstName, lastName: user.lastName }
    : null;

const usable = (user) =>
  Boolean(user) && user.isServiceAccount !== true && user.banned !== true;

const inAppAllowed = (user, category, prefs) =>
  Boolean(prefs?.notify?.personal?.[category]) &&
  user?.notify?.inApp?.[category] !== false;

const quote = (text) => {
  const short = excerpt(text);
  return short ? `«${short}»` : "";
};

const withActor = (actor, text) =>
  [personName(actor) || null, text || null].filter(Boolean).join(" · ");

const lastReason = (ticket) => {
  const rejected = ticket.rejected || [];
  return rejected.length ? rejected[rejected.length - 1]?.reason : "";
};

/**
 * Событие заявки → кому и что. Порядок правил внутри события важен: человек
 * получает одно уведомление на событие, и первое подходящее правило
 * побеждает (назначенному — «вы назначены», а не «новая заявка»).
 */
const TICKET_EVENTS = {
  "new ticket": [
    {
      category: "respStateUpdate",
      kind: "processed",
      title: "Вы назначены ответственным",
      audience: ["newResponsibles"],
      text: ({ actor }) => personName(actor),
    },
    {
      category: "newTicket",
      kind: "created",
      title: "Новая заявка",
      audience: ["managers", "applicant"],
      text: ({ ticket, applicant }) =>
        [ticket.company?.alias, personName(applicant)].filter(Boolean).join(" · "),
    },
  ],
  "process ticket": [
    {
      category: "respStateUpdate",
      kind: "processed",
      title: "Вы назначены ответственным",
      audience: ["newResponsibles"],
      skipIfClosed: true,
      text: ({ actor }) => personName(actor),
    },
  ],
  "take ticket to work": [
    {
      category: "ticketStateUpdate",
      kind: "taken",
      title: "Заявка принята в работу",
      audience: ["applicant"],
      text: ({ actor }) => personName(actor),
    },
  ],
  "request help": [
    {
      category: "respStateUpdate",
      kind: "helpRequested",
      title: "Запрошена помощь",
      audience: ["newResponsibles"],
      text: ({ actor }) => personName(actor),
    },
  ],
  "join responsibles": [
    {
      category: "respStateUpdate",
      kind: "joined",
      title: "Присоединился к заявке",
      audience: ["responsibles"],
      text: ({ actor }) => personName(actor),
    },
  ],
  "update deadline": [
    {
      category: "ticketDeadlineUpdate",
      kind: "deadline",
      title: "Срок изменён",
      audience: ["applicant", "responsibles"],
      skipIfClosed: true,
      text: ({ deadlineText }) => deadlineText || "",
    },
  ],
  "reject ticket": [
    {
      category: "respStateUpdate",
      kind: "rejected",
      title: "Отказ от заявки",
      audience: ["managers", "responsibles"],
      text: ({ ticket, actor }) => withActor(actor, quote(lastReason(ticket))),
    },
  ],
  "close ticket": [
    {
      category: "ticketStateUpdate",
      kind: "closed",
      title: "Заявка закрыта",
      audience: ["applicant", "responsibles"],
      text: ({ ticket, actor }) => withActor(actor, quote(ticket.closingComment)),
    },
  ],
  "back to work": [
    {
      category: "ticketStateUpdate",
      kind: "reopened",
      title: "Возвращена в работу",
      audience: ["applicant", "responsibles"],
      text: ({ ticket, actor }) =>
        withActor(actor, quote(ticket.returningComment)),
    },
  ],
};

const makeItem = ({ user, spec, ticket, actor, text, commentId = null }) => ({
  userId: user._id,
  category: spec.category,
  kind: spec.kind,
  ticketId: ticket?._id ?? null,
  ticketNum: ticket?.num ?? null,
  ticketTitle: ticket?.title || "",
  commentId,
  actor,
  title: spec.title,
  text: text || "",
  link: ticket?.num ? `/tickets/${ticket.num}` : spec.link || "",
  readAt: null,
});

/**
 * Собрать уведомления по событию заявки.
 *
 * @param {object} p
 * @param {string} p.lastAction — `ticket.notifications.lastAction`
 * @param {object} p.ticket — документ заявки (responsibles с `isNotified`)
 * @param {Map<string, object>} p.usersById — заявитель, ответственные, автор
 * @param {object[]} [p.managers] — носители `ticket.manage`
 * @param {object} p.prefs — Preferences
 * @param {string} [p.deadlineText] — строка нового срока для «update deadline»
 * @returns {{ items: object[], consideredResponsibleIds: string[] }}
 *   `consideredResponsibleIds` — кому ставить защёлку `isNotified.inApp`
 *   (всем рассмотренным, независимо от личного выключателя: иначе включивший
 *   категорию позже получил бы «вы назначены» при первой же правке заявки)
 */
const buildTicketItems = ({
  lastAction,
  ticket,
  usersById,
  managers = [],
  prefs,
  deadlineText,
}) => {
  const specs = TICKET_EVENTS[lastAction];
  const considered = new Set();
  if (!specs) return { items: [], consideredResponsibleIds: [] };

  const actorId = idOf(ticket.updatedBy);
  const actorUser = usersById.get(actorId);
  const actor = snapshot(actorUser);
  const applicant = usersById.get(idOf(ticket.applicantId));
  const responsibles = ticket.responsibles || [];

  const audienceOf = (name) => {
    switch (name) {
      case "applicant":
        return applicant ? [applicant] : [];
      case "responsibles":
        return responsibles.map((r) => usersById.get(idOf(r))).filter(Boolean);
      case "newResponsibles": {
        const fresh = responsibles.filter((r) => !r.isNotified?.inApp);
        for (const r of fresh) considered.add(idOf(r));
        return fresh.map((r) => usersById.get(idOf(r))).filter(Boolean);
      }
      case "managers":
        return managers;
      default:
        return [];
    }
  };

  const items = [];
  const notified = new Set();
  for (const spec of specs) {
    if (spec.skipIfClosed && ticket.isClosed) continue;
    const recipients = spec.audience.flatMap(audienceOf);
    const text = spec.text
      ? spec.text({ ticket, actor: actorUser, applicant, deadlineText })
      : "";
    for (const user of recipients) {
      const uid = idOf(user);
      if (!uid || uid === actorId || notified.has(uid)) continue;
      if (!usable(user) || !inAppAllowed(user, spec.category, prefs)) continue;
      notified.add(uid);
      items.push(makeItem({ user, spec, ticket, actor, text }));
    }
  }
  return { items, consideredResponsibleIds: [...considered] };
};

/** Комментарий → заявителю и ответственным, кроме автора. */
const buildCommentItems = ({ comment, ticket, usersById, prefs }) => {
  const authorId = idOf(comment.createdBy);
  const author =
    usersById.get(authorId) ||
    (comment.createdBy && typeof comment.createdBy === "object"
      ? comment.createdBy
      : null);
  const spec = {
    category: "ticketNewComment",
    kind: "comment",
    // Как в почтовой ветке: ответ в закрытую заявку называет себя вслух
    title: ticket.isClosed ? "Ответ в закрытую заявку" : "Новый комментарий",
  };
  const recipients = [
    usersById.get(idOf(ticket.applicantId)),
    ...(ticket.responsibles || []).map((r) => usersById.get(idOf(r))),
  ].filter(Boolean);
  const text = excerpt(comment.content);
  const actor = snapshot(author);

  const items = [];
  const notified = new Set();
  for (const user of recipients) {
    const uid = idOf(user);
    if (!uid || uid === authorId || notified.has(uid)) continue;
    if (!usable(user) || !inAppAllowed(user, spec.category, prefs)) continue;
    notified.add(uid);
    items.push(makeItem({ user, spec, ticket, actor, text, commentId: comment._id }));
  }
  return { items };
};

/** Запланированные работы → заявителям и ответственным всех заявок работы. */
const buildWorksItems = ({
  lastAction,
  work,
  tickets = [],
  ticketNums = [],
  company,
  recipients = [],
  prefs,
  dateText,
}) => {
  const added = lastAction === "new scheduled work";
  const spec = {
    category: "scheduledWorks",
    kind: added ? "workAdded" : "workUpdated",
    title: added ? "Запланированы работы" : "Изменены запланированные работы",
  };
  const first = tickets[0] || { num: ticketNums[0] };
  const actorId = idOf(work.updatedBy ?? work.createdBy);
  const text = [
    company,
    `Специалист: ${personName(work.executor) || "—"}`,
    `${work.visitRequired ? "Выезд" : "Удалённо"} · начало ${dateText || "—"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const items = [];
  const notified = new Set();
  for (const user of recipients) {
    const uid = idOf(user);
    if (!uid || uid === actorId || notified.has(uid)) continue;
    if (!usable(user) || !inAppAllowed(user, spec.category, prefs)) continue;
    notified.add(uid);
    items.push(makeItem({ user, spec, ticket: first, actor: null, text }));
  }
  return { items };
};

// ---------------------------------------------------------------- база

const USER_FIELDS = "firstName lastName notify isServiceAccount banned";

const loadUsers = async (ids) => {
  const User = require("@/models/user");
  const unique = [...new Set(ids.map(idOf).filter(Boolean))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } })
    .select(USER_FIELDS)
    .lean();
  return new Map(users.map((user) => [String(user._id), user]));
};

const loadManagers = async () => {
  const User = require("@/models/user");
  const { permissionFilter } = require("@/services/permissions");
  return User.find(await permissionFilter("ticket.manage"))
    .select(USER_FIELDS)
    .lean();
};

const insert = async (items) => {
  if (!items.length) return 0;
  const InAppNotification = require("@/models/inAppNotification");
  await InAppNotification.insertMany(items, { ordered: false });
  return items.length;
};

/** Защёлка «уже уведомлён в приложении» на рассмотренных ответственных. */
const latch = (ticket, consideredResponsibleIds) => {
  const ids = new Set(consideredResponsibleIds);
  for (const responsible of ticket.responsibles || []) {
    if (!ids.has(idOf(responsible))) continue;
    if (typeof responsible.set === "function") {
      responsible.set("isNotified.inApp", true);
    } else {
      responsible.isNotified = { ...(responsible.isNotified || {}), inApp: true };
    }
  }
};

/**
 * Один вызов на заявку из крона — ПЕРЕД `switch` по lastAction: тогда работают
 * и события, у которых своей ветки в кроне нет («join responsibles»).
 * Защёлки ставятся на переданном документе; сохраняет его сама ветка крона.
 */
const notifyTicketEvent = async ({ ticket, prefs, deadlineText }) => {
  const lastAction = ticket?.notifications?.lastAction;
  const specs = TICKET_EVENTS[lastAction];
  if (!specs) return 0;
  const usersById = await loadUsers([
    ticket.applicantId,
    ticket.updatedBy,
    ...(ticket.responsibles || []).map((r) => r._id),
  ]);
  const managers = specs.some((spec) => spec.audience.includes("managers"))
    ? await loadManagers()
    : [];
  const { items, consideredResponsibleIds } = buildTicketItems({
    lastAction,
    ticket,
    usersById,
    managers,
    prefs,
    deadlineText,
  });
  latch(ticket, consideredResponsibleIds);
  const count = await insert(items);
  if (count) {
    logger.log("notification", "In-app ticket notifications queued", {
      ticketNum: ticket.num,
      lastAction,
      count,
    });
  }
  return count;
};

const notifyCommentEvent = async ({ comment, ticket, prefs }) => {
  const usersById = await loadUsers([
    ticket.applicantId,
    comment.createdBy,
    ...(ticket.responsibles || []).map((r) => r._id),
  ]);
  const { items } = buildCommentItems({ comment, ticket, usersById, prefs });
  const count = await insert(items);
  if (count) {
    logger.log("notification", "In-app comment notifications queued", {
      ticketNum: ticket.num,
      count,
    });
  }
  return count;
};

const notifyWorksEvent = async ({
  work,
  tickets,
  company,
  applicantIds = [],
  responsibleIds = [],
  prefs,
  dateText,
}) => {
  const usersById = await loadUsers([...applicantIds, ...responsibleIds]);
  const { items } = buildWorksItems({
    lastAction: work?.notifications?.lastAction,
    work,
    tickets,
    company,
    recipients: [...usersById.values()],
    prefs,
    dateText,
  });
  const count = await insert(items);
  if (count) {
    logger.log("notification", "In-app works notifications queued", {
      workId: String(work?._id),
      count,
    });
  }
  return count;
};

/**
 * Уведомления вне заявок (отсутствия, согласование отчётов): получатели уже
 * известны вызывающему, у каждого может быть своя ссылка и текст.
 */
const pushInApp = async ({
  recipients = [],
  category,
  kind,
  title,
  text,
  link,
  titleFor,
  textFor,
  linkFor,
  prefs: givenPrefs,
}) => {
  const prefs =
    givenPrefs ?? (await require("@/models/preferences").findOne({}).lean());
  const items = [];
  const notified = new Set();
  for (const user of recipients) {
    const uid = idOf(user);
    if (!uid || notified.has(uid)) continue;
    if (!usable(user) || !inAppAllowed(user, category, prefs)) continue;
    notified.add(uid);
    items.push({
      userId: user._id,
      category,
      kind: kind || category,
      ticketId: null,
      ticketNum: null,
      ticketTitle: "",
      commentId: null,
      actor: null,
      title: titleFor ? titleFor(user) : title,
      text: textFor ? textFor(user) : text || "",
      link: linkFor ? linkFor(user) : link || "",
      readAt: null,
    });
  }
  const count = await insert(items);
  if (count) {
    logger.log("notification", "In-app notifications queued", { category, count });
  }
  return count;
};

module.exports = {
  TICKET_EVENTS,
  excerpt,
  inAppAllowed,
  buildTicketItems,
  buildCommentItems,
  buildWorksItems,
  notifyTicketEvent,
  notifyCommentEvent,
  notifyWorksEvent,
  pushInApp,
};
