const Company = require("@/models/company");
const Subdivision = require("@/models/subdivision");
const User = require("@/models/user");
const { isBanned } = require("@/services/accountDenial");

/**
 * Справочники для ИИ-агента: компании и пользователи. Единственный, кто читает
 * модели; наружу идёт положительная проекция — почта, телефон, Telegram-id,
 * адреса и реквизиты сюда не попадают вовсе, поэтому инструменту нечего
 * случайно показать.
 */

exports.loadCompanies = async () => {
  const [companies, subdivisions] = await Promise.all([
    Company.find({}).select("alias fullTitle isActive").lean(),
    Subdivision.find({}).select("name company").lean(),
  ]);
  return {
    companies: companies.map((c) => ({ _id: String(c._id), alias: c.alias, fullTitle: c.fullTitle, isActive: c.isActive !== false })),
    subdivisions: subdivisions.map((s) => ({ _id: String(s._id), name: s.name, companyId: s.company ? String(s.company) : null })),
  };
};

exports.loadUsers = async () => {
  const users = await User.find({})
    .select("firstName lastName position isEndUser isServiceAccount isCloudTelephony company._id subdivision banned banExpires telegramBot.isActive telegramBot.chatId")
    .lean();
  return users.map((u) => ({
    _id: String(u._id),
    firstName: u.firstName || "",
    lastName: u.lastName || "",
    position: u.position || "",
    isEndUser: u.isEndUser !== false,
    isSystem: Boolean(u.isServiceAccount || u.isCloudTelephony),
    companyId: u.company?._id ? String(u.company._id) : null,
    subdivisionId: u.subdivision ? String(u.subdivision) : null,
    // Отключение со сроком — только через isBanned
    isBlocked: isBanned(u),
    // Сам chatId наружу не идёт: только факт привязки
    telegramLinked: Boolean(u.telegramBot?.isActive && u.telegramBot?.chatId),
  }));
};
