const { Ticket } = require("../models/ticket");
const User = require("../models/user");
const Company = require("../models/company");
const Preferences = require("../models/preferences");
const TicketTemplate = require("../models/ticketTemplate");
const Work = require("../models/work");
const Connection = require("../models/pro32Connect/connection");
const { AppError } = require("../middleware/errorHandling");
const logger = require("../utils/logger");
const storage = require("./storage");
const { resolveGetScreenApiKey } = require("../helpers/getScreenKey");
const { deriveTicketTitle } = require("../helpers/deriveTicketTitle");
const { canSeeTemplate } = require("../controllers/ticketTemplate");
const { collectAnswers, composeDescription, descriptionIsEmpty, hasAnswer } = require("./ticketQuestionnaire");
const { prepareOrigin } = require("./messaging/origin");
const { resolveAiFeatures } = require("./ai/features");
const { detectTicketCategory } = require("./ticketCategoryService");
const { autoApplyEnabled, bestTemplateForTicket, itemsToChecklist } = require("./checklistTemplates");
const { permissionFilter } = require("./permissions");
const { isBanned } = require("./authBan");

const buildAttachment = (file) => ({
  mimetype: file.mimetype,
  mimeType: file.mimetype,
  name: file.key,
  originalName: file.originalname,
  size: file.size,
});

/**
 * Ответственных проверяем поимённо: право «брать заявки в работу» должно быть у
 * КАЖДОГО из списка, а не подразумеваться из того, что список пришёл из формы.
 *
 * Условие собирает `permissionFilter` — с ролями флага в документе пользователя
 * нет, и прямое `{ "permissions.canPerformTickets": true }` молча вернуло бы
 * неполный список. Он же отсекает отключённых и служебные учётки: раньше это
 * условие дописывал каждый вызывающий, и здесь оно было забыто — ответственным
 * можно было поставить уволенного или машинную учётку.
 * Отказ называет людей по именам: идентификаторы человеку, который его читает,
 * ничего не говорят.
 */
const assertResponsiblesMayPerform = async (responsibles) => {
  const ids = responsibles.map((person) => person?._id).filter(Boolean);
  if (!ids.length) return;

  const filter = await permissionFilter("ticket.perform");
  const allowed = await User.find({ _id: { $in: ids }, ...filter })
    .select("_id")
    .lean();

  if (allowed.length === ids.length) return;

  const allowedIds = new Set(allowed.map((user) => user._id.toString()));
  const names = responsibles
    .filter((person) => !allowedIds.has(String(person?._id)))
    .map(
      (person) =>
        [person.lastName, person.firstName].filter(Boolean).join(" ") ||
        String(person._id),
    )
    .join(", ");

  throw new AppError(
    `Нельзя назначить ответственным: ${names} — у них нет права выполнять заявки`,
    400,
  );
};

async function prepareNewTicket({ auth, body, files }) {
  const { userId, company } = auth.legacy;
  const prefs = await Preferences.findOne({});
  const userCompany = await Company.findById(company._id);
  const now = new Date();

  /**
   * Заявку за другого заводит только тот, кому это разрешено. Сотрудник —
   * за любого инициатора любой компании и с ответственными; клиент — только
   * за коллегу своей компании: компания всегда его, ответственных он не
   * указывает. Раньше клиент с этим правом мог прислать чужую компанию телом
   * запроса.
   */
  const isClient = auth.isEndUser;
  const onBehalfOfOthers = auth.can({ ticket: ["createForOthers"] });

  // Заявка из диалога («Диалоги» → «Создать заявку»): проверяем до создания
  // (и до выбора заявителя ниже — черновик уже решил, кто это), а сообщения,
  // привязку и файлы разносим после (services/messaging/origin.js)
  const conversationOrigin = body.originConversationId
    ? await prepareOrigin({
        auth: auth,
        conversationId: body.originConversationId,
        messageIds: body.originMessageIds,
      })
    : null;
  // Собеседник не связан с пользователем — как у почты: служебная учётка по
  // умолчанию, а имя собеседника уходит в realSender
  const originApplicant = conversationOrigin
    ? String(conversationOrigin.applicantId || prefs.defaultApplicant?._id || userId)
    : null;
  // Заявитель черновика — авторитетный источник (M9): когда applicantId не
  // прислан или совпадает с тем, что определил диалог, применяем его НАПРЯМУЮ,
  // не спрашивая ticket.createForOthers — иначе заявку из диалога не завести
  // без лишнего права. Другой, явно выбранный applicantId — по обычным правилам.
  const usesOriginApplicant =
    conversationOrigin && (!body.applicantId || String(body.applicantId) === String(conversationOrigin.applicantId));

  let applicant = userId;
  if (usesOriginApplicant) {
    const originUser = await User.findById(originApplicant).select("deletedAt").lean();
    if (!originUser || originUser.deletedAt) throw new AppError("Инициатор диалога удалён: выберите другого пользователя", 409);
    applicant = originApplicant;
  } else if (onBehalfOfOthers && body.applicantId && String(body.applicantId) !== String(userId)) {
    const chosen = await User.findById(body.applicantId)
      .select("_id company isServiceAccount deletedAt banned banExpires")
      .lean();
    if (!chosen || chosen.isServiceAccount || isBanned(chosen)) {
      throw new AppError("Инициатор не найден или отключён", 404);
    }
    if (isClient && String(chosen.company?._id) !== String(company?._id)) {
      throw new AppError("Инициатором может быть только сотрудник вашей компании", 403);
    }
    applicant = String(chosen._id);
  }

  const attachments = files?.map(buildAttachment);

  // Шаблон приходит одним id (прежний клиент слал документ целиком — из
  // него берём только _id): вопросы, чек-лист и видимость решает документ
  // из базы, а не то, что прислал браузер, — иначе любой присланный JSON
  // сходил за шаблон, и обязательность вопросов проверить было не по чему
  const parsedTemplate = body.template
    ? JSON.parse(body.template)
    : null;
  const templateId = body.templateId || parsedTemplate?._id || null;
  const template = templateId
    ? await TicketTemplate.findById(templateId)
    : null;
  if (templateId && !template) {
    throw new AppError("Шаблон заявки не найден", 404);
  }
  if (template && !canSeeTemplate(template, auth)) {
    throw new AppError("Шаблон вам недоступен", 403);
  }

  const submittedFields = body.customFields
    ? JSON.parse(body.customFields)
    : [];
  let validCustomFields;
  if (template) {
    const answers = collectAnswers({
      definitions: template.customFields.map((field) => field.toObject()),
      submitted: submittedFields,
    });
    if (answers.errors.length) {
      throw new AppError(
        answers.errors.map((error) => error.message).join("; "),
        400,
      );
    }
    validCustomFields = answers.customFields;
  } else {
    // Без шаблона проверять не по чему — храним, что прислали с названием
    validCustomFields = submittedFields.filter(
      (field) => field && field.name,
    );
  }

  // Категория шаблона — категория заявки: заявитель её не выбирает, и без
  // этого каждая заявка по шаблону уходила на автоопределение категории
  const categoryId =
    body.categoryId ||
    (template?.categoryId ? String(template.categoryId) : undefined);

  // Чек-лист-заготовка шаблона копируется в заявку (обязательность сохраняется).
  let templateChecklist = (template?.checklist || []).map((item) => ({
    description: item.description,
    checked: false,
    mandatory: !!item.mandatory,
  }));

  // Свой чек-лист шаблона заявки сильнее подбора: он часть заготовки, по
  // которой заявку и создают. Подбор шаблона чек-листа работает там, где
  // списка нет, — то есть в 90 % заявок, создаваемых вручную
  const ticketCompany =
    !isClient && onBehalfOfOthers && body.company
      ? JSON.parse(body.company)
      : userCompany;

  const responsibles =
    !isClient && onBehalfOfOthers ? JSON.parse(body.responsibles || "[]") : [];
  await assertResponsiblesMayPerform(responsibles);

  if (templateChecklist.length === 0 && (await autoApplyEnabled())) {
    const best = await bestTemplateForTicket({
      categoryId,
      company: ticketCompany,
    });
    if (best) {
      templateChecklist = itemsToChecklist(best);
    }
  }

  // Тему выводит сервер, а не браузер: у заявителя поля «Тема» нет, а тема
  // уезжает в список, в письмо, в Telegram и в отчёты. Прежняя обрезка на
  // клиенте (`substring(0, 50)`) давала 684 темы ровно в 50 знаков из 884
  // клиентских заявок за год — оборванных посреди слова.
  // Описание: что написали — то и хранится, в любом режиме шаблона (режим
  // говорит, о чём спрашивает форма, а не что принимает сервер: у
  // сотрудника редактор есть всегда). Пустое при ответах на вопросы
  // собирается из них — тогда тема, письмо, Telegram и подсказка ИИ
  // работают как прежде. Пустое без ответов — отказ, если шаблон (или его
  // отсутствие) описание требует.
  const descriptionMode = template?.descriptionMode ?? "required";
  let description = body.description ?? "";
  let descriptionComposed = false;
  if (descriptionIsEmpty(description)) {
    if (
      validCustomFields.some((field) => hasAnswer(field.type, field.value))
    ) {
      description = composeDescription(validCustomFields);
      descriptionComposed = true;
    } else if (descriptionMode === "required") {
      throw new AppError("Опишите задачу", 400);
    }
  }

  const submittedTitle = (body.title || "").trim();
  // Из собранного описания тема не выводится: «ФИО: Иванов» — не тема,
  // ею становится название шаблона
  const title =
    submittedTitle ||
    (descriptionComposed && template?.title) ||
    deriveTicketTitle(description) ||
    template?.title ||
    "";
  // Тему, выведенную из текста, может переписать ассистент — тем же проходом,
  // которым он подбирает категорию. Провизорную тему всё равно сохраняем:
  // уведомления уходят в момент создания, безымянной заявки быть не должно.
  //
  // Условие повторяет условие запуска прохода (ниже: функция включена и
  // категории нет). Иначе заявка с категорией, но без темы получила бы вечный
  // pending: проход для неё не стартует. На практике это одно и то же
  // множество — темы не заполняет только заявитель, а категорию он и не
  // выбирает. Тема из шаблона — не провизорная, переписывать её ассистенту не
  // надо. Подбор категории и тема включаются по отдельности (Настройки → ИИ →
  // «Функции»), проход один: модель читает заявку один раз.
  const aiFeatures = resolveAiFeatures(prefs?.ai);
  const wantsAiCategory = aiFeatures.category && !categoryId;
  const wantsAiTitle =
    aiFeatures.title &&
    !categoryId &&
    !submittedTitle &&
    !descriptionComposed &&
    !!title;

  const ticket = new Ticket({
    title,
    description,
    descriptionComposed,
    template: template?._id ?? null,
    checklist: templateChecklist,
    customFields: validCustomFields,
    attachments: attachments,
    isClosed: false,
    categoryId: categoryId,
    // Заявитель либо авторизованный пользователь, либо указанный в полной форме создания заявки
    applicantId: applicant,
    company: ticketCompany,
    responsibles: responsibles,
    deadline: body.deadline
      ? body.deadline
      : now.setTime(now.getTime() + prefs.deadline * 60 * 60 * 1000),
    state: body.state,
    source: conversationOrigin ? conversationOrigin.source : body.source,
    ...(conversationOrigin ? { originConversationId: conversationOrigin.conversation._id } : {}),
    ...(conversationOrigin?.realSender && !conversationOrigin.applicantId && !body.applicantId
      ? { realSender: conversationOrigin.realSender }
      : {}),
    createdBy: userId,
    updatedBy: userId,
    notifications: {
      lastAction: "new ticket",
      pending: true,
    },
    // Если категория не выбрана и подбор включён — помечаем заявку ожидающей
    // автоопределения категории (бейдж статуса появится сразу).
    ...(wantsAiCategory ? { aiCategory: { status: "pending" } } : {}),
    ...(wantsAiTitle ? { aiTitle: { status: "pending" } } : {}),
  });

  return { ticket, conversationOrigin, applicant, wantsAiCategory, wantsAiTitle };
}

function startTicketAi(ticket, wantsAiCategory, wantsAiTitle) {
  if (wantsAiCategory || wantsAiTitle) {
    detectTicketCategory(ticket._id, { category: wantsAiCategory }).catch((error) =>
      logger.log("error", "Background AI ticket processing failed", {
        ticketId: ticket._id.toString(),
        error: error.message,
      }),
    );
  }
}

function applyTicketDetails(ticket, { title, description, deadline }) {
  if (title) ticket.title = title;
  if (deadline) ticket.deadline = deadline;
  // Текст, написанный рукой, снимает признак «собрано из ответов»; пока
  // признак стоит, правка ответов пересобирает описание
  if (description && description !== ticket.description) {
    ticket.description = description;
    ticket.descriptionComposed = false;
  }
}

async function cleanupTicketResources(ticket, auth) {
  const connection = await Connection.findOne({ ticket: ticket.num });
  if (connection) {
    const prefs = await Preferences.findOne({});
    if (prefs?.getScreen?.isActive) {
      const user = await User.findById(auth.userId ?? auth.legacy.userId);
      await fetch(
        `https://api.pro32connect.ru/v1/support/close?apikey=${resolveGetScreenApiKey(user)}&connection_id=${connection.getScreenId}`,
        { method: "POST" },
      );
    }
    await Connection.deleteOne({ _id: connection._id });
  }
  for (const file of ticket.attachments ?? []) await storage.deleteObject(file.name);
  // Both predicates are evaluated by Mongo on the current work. Replaying after
  // detaching a shared work cannot remove another ticket's link.
  await Work.updateMany({ tickets: ticket._id, "tickets.1": { $exists: true } }, { $pull: { tickets: ticket._id } });
  await Work.deleteMany({ tickets: ticket._id, "tickets.1": { $exists: false } });
}

module.exports = { prepareNewTicket, startTicketAi, applyTicketDetails, cleanupTicketResources, buildAttachment, assertResponsiblesMayPerform };
