const mongoose = require("mongoose");

/**
 * Скоуп заявок — три яруса (спека 2026-09-11, «Заявки»):
 *   own       — инициатор, автор или ответственный;
 *   companies — плюс все заявки компаний скоупа: сотруднику — где он в
 *               ответственных компании (`responsibleForCompanies`), клиенту —
 *               своей компании;
 *   all       — всё (`ticket.readAll` или администратор).
 * Одна функция на список и на карточку: раньше правило жило в четырёх
 * контроллерах и в мидлвари и расходилось.
 */

const idOf = (value) => (value ? String(value._id ?? value.id ?? value) : null);

/** Плоский пользователь: на документе Mongoose виртуальный `id` затеняет поле `id` подсхемы. */
const plainUser = (auth) =>
  auth.legacy ?? (auth.user?.toObject ? auth.user.toObject() : auth.user) ?? {};

const ticketTier = (auth) => {
  if (auth.isAdmin || auth.can({ ticket: ["readAll"] })) return "all";
  if (auth.can({ ticket: ["readCompanies"] })) return "companies";
  return "own";
};

const scopeCompanyIds = (auth) => {
  const user = plainUser(auth);
  if (auth.isEndUser) return [idOf(user.company?._id)].filter(Boolean);
  return [
    ...new Set(
      (user.responsibleForCompanies || [])
        .map((company) => idOf(company?.id ?? company?._id))
        .filter(Boolean),
    ),
  ];
};

const ownConditions = (auth) => {
  const userId = new mongoose.Types.ObjectId(String(auth.userId));
  // `applicant._id` — легаси-снимок заявителя (models/ticket.js, поле помечено
  // «legacy, delete after 1.8.9»); карточку (`ticketInScope`) он уже пускает.
  return [
    { "responsibles._id": userId },
    { createdBy: userId },
    { applicantId: userId },
    { "applicant._id": userId },
  ];
};

/** Фрагмент фильтра Mongo для `Ticket.find`; `{}` — без ограничений. */
const ticketListFilter = (auth) => {
  const tier = ticketTier(auth);
  if (tier === "all") return {};
  if (tier === "companies") {
    const ids = scopeCompanyIds(auth).map((id) => new mongoose.Types.ObjectId(id));
    return { $or: [{ "company._id": { $in: ids } }, ...ownConditions(auth)] };
  }
  return { $or: ownConditions(auth) };
};

/** То же правило для уже загруженной заявки (карточка, комментарии, работы). */
const ticketInScope = (ticket, auth) => {
  if (!ticket || !auth) return false;
  const tier = ticketTier(auth);
  if (tier === "all") return true;

  const userId = String(auth.userId);
  const isOwn =
    (ticket.responsibles || []).some((resp) => idOf(resp) === userId) ||
    idOf(ticket.createdBy) === userId ||
    idOf(ticket.applicantId) === userId ||
    idOf(ticket.applicant?._id) === userId;
  if (isOwn) return true;

  return tier === "companies" && scopeCompanyIds(auth).includes(idOf(ticket.company?._id));
};

module.exports = { ticketTier, scopeCompanyIds, ticketListFilter, ticketInScope };
