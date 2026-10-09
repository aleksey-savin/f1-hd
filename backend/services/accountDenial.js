/**
 * Основания отказать учётной записи — общие для всех каналов: браузер
 * (middleware/attachSession), Telegram (services/telegramActor) и ответ
 * письмом в заявку (services/mail/replyRouting). Правило одно, чтобы ни один
 * канал не пускал тех, кого не пускает браузер.
 *
 * Модуль нарочно без зависимостей — ни моделей, ни better-auth: его берут и
 * чистые модули. services/authBan и services/authContext отдают эти функции
 * дальше, вызовы по проекту не менялись.
 */

/** Отключение действует: флаг стоит, и срок либо не задан, либо не вышел. */
const isBanned = (user) =>
  Boolean(user?.banned) &&
  !(user.banExpires && new Date(user.banExpires).getTime() <= Date.now());

/**
 * Основания отказать, общие для всех способов входа.
 *
 * `company.isActive` остаётся отдельной проверкой: у better-auth нет понятия
 * «организация отключила сотрудника», это прикладное правило (см. комментарий в
 * `middleware/attachSession`).
 *
 * `banned` читается через `isBanned`, а не напрямую: отключение со сроком после
 * срока не действует (см. `services/authBan`).
 */
const isDeniedAccount = (user) =>
  Boolean(
    isBanned(user) || user.company?.isActive === false || user.isServiceAccount,
  );

module.exports = { isBanned, isDeniedAccount };
