/**
 * Внешний API по ключу компании (routes/external/user.js): заявки и журнал
 * входов AD. КЛЮЧ ДЕЙСТВУЕТ ТОЛЬКО В СВОЕЙ КОМПАНИИ (спека W1, D3).
 *
 * Ключ лежит на рабочих станциях клиента в сценариях входа AD, поэтому тело
 * запроса — чужой ввод:
 *   - люди ищутся только внутри компании ключа, а значения из тела берутся
 *     строками — объект вида `{"$ne": null}` в фильтр не попадает;
 *   - заявка ложится в компанию ключа, ответственных и срок интеграция не
 *     задаёт;
 *   - категория — только настоящая;
 *   - в ответах нет адресов почты.
 *
 * Модуль чистый: поиск в базе приходит аргументами из контроллеров
 * (controllers/external/ticket.js, controllers/log/companyLog.js).
 */

const HEX_OBJECT_ID = /^[a-f0-9]{24}$/i;
const HOUR_MS = 60 * 60 * 1000;

/** Значение из тела строкой. Не строка и не число — пустая строка. */
const asString = (value) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";

/** Первый найденный по фильтрам в порядке очереди — или null. */
const firstMatch = async (filters, findUser) => {
  for (const filter of filters) {
    const user = await findUser(filter);
    if (user) return user;
  }
  return null;
};

/**
 * Где искать заявителя: по id, затем по почте — оба раза только в компании
 * ключа. Отключённых по почте не ищем, как и прежде.
 */
const apiApplicantFilters = ({ companyId, userId, userEmail }) => {
  if (!companyId) return [];
  const id = asString(userId);
  const email = asString(userEmail).toLowerCase();
  return [
    ...(HEX_OBJECT_ID.test(id) ? [{ _id: id, "company._id": companyId }] : []),
    ...(email
      ? [{ email, "company._id": companyId, banned: { $ne: true } }]
      : []),
  ];
};

/** Заявитель из тела или null — тогда заявка уходит от пользователя по умолчанию. */
const resolveApiApplicant = ({ companyId, userId, userEmail }, { findUser }) =>
  firstMatch(apiApplicantFilters({ companyId, userId, userEmail }), findUser);

/** Категория — только настоящий id существующей категории, иначе null. */
const resolveApiCategoryId = async (categoryId, { categoryExists }) => {
  const id = asString(categoryId);
  if (!HEX_OBJECT_ID.test(id)) return null;
  return (await categoryExists(id)) ? id : null;
};

const validCustomFields = (customFields) =>
  customFields
    ? (Array.isArray(customFields) ? customFields : [customFields]).filter(
        (field) => field && field.name,
      )
    : [];

/**
 * Поля новой заявки. Компания — всегда компания ключа: заявитель найден в ней
 * же, а пользователь по умолчанию своей компании заявке не навязывает.
 * `responsibles` и `deadline` из тела не читаются (D3): ответственных
 * назначает диспетчер, срок — настройки.
 */
const externalTicketDoc = ({
  body,
  applicant,
  company,
  categoryId,
  attachments,
  deadlineHours,
  now,
}) => ({
  title: body.title,
  description: body.description || "",
  customFields: validCustomFields(body.customFields),
  attachments,
  isClosed: false,
  categoryId: categoryId || null,
  applicantId: applicant._id,
  company: { _id: company._id, alias: company.alias },
  responsibles: [],
  deadline: new Date(now.getTime() + deadlineHours * HOUR_MS),
  state: "Новая",
  source: body.source || "Другое",
  createdBy: applicant._id,
  updatedBy: applicant._id,
  notifications: {
    lastAction: "new ticket",
    pending: true,
  },
});

/** Ответ на создание заявки: без почты заявителя. */
const externalTicketResponse = ({ ticket, applicant, company }) => ({
  success: true,
  message: "Заявка успешно создана",
  ticket: {
    _id: ticket._id,
    num: ticket.num,
    title: ticket.title,
    description: ticket.description,
    state: ticket.state,
    createdAt: ticket.createdAt,
    deadline: ticket.deadline,
    applicant: {
      _id: applicant._id,
      firstName: applicant.firstName,
      lastName: applicant.lastName,
    },
    company: { _id: company._id, alias: company.alias },
  },
});

/** Человек записи журнала входов: по GUID, затем по почте — в компании ключа. */
const companyLogUserFilters = ({ companyId, activeDirectoryObjectGUID, email }) => {
  if (!companyId) return [];
  const guid = asString(activeDirectoryObjectGUID);
  const mail = asString(email).toLowerCase();
  return [
    ...(guid ? [{ activeDirectoryObjectGUID: guid, "company._id": companyId }] : []),
    ...(mail ? [{ email: mail, "company._id": companyId }] : []),
  ];
};

const resolveCompanyLogUser = (
  { companyId, activeDirectoryObjectGUID, email },
  { findUser },
) =>
  firstMatch(
    companyLogUserFilters({ companyId, activeDirectoryObjectGUID, email }),
    findUser,
  );

/** Связанный человек в ответе журнала: id и имя, без почты. */
const companyLogLinkedUser = (user) =>
  user
    ? { id: user._id, firstName: user.firstName, lastName: user.lastName }
    : null;

module.exports = {
  apiApplicantFilters,
  asString,
  companyLogLinkedUser,
  companyLogUserFilters,
  externalTicketDoc,
  externalTicketResponse,
  resolveApiApplicant,
  resolveApiCategoryId,
  resolveCompanyLogUser,
};
