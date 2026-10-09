const { isBanned } = require("@/services/authBan");

/**
 * Вход по ссылке из письма — кому он положен (решение D4 спеки W1).
 *
 * Ссылка — вход без пароля и без второго фактора: доступ к почте равен доступу
 * к учётной записи. Клиенту это та же цена, что у восстановления пароля, ради
 * него ссылка и заведена (services/invitation.js). Сотруднику и тому, кто
 * включил второй фактор, ссылка означала бы вход мимо пароля и TOTP.
 *
 * Правило стоит в двух местах, и нужны оба:
 *   • отправка (`hooks.sendMagicLink`): плагин шлёт по любому известному
 *     адресу, а вызывать его может любой серверный код — сейчас приглашение.
 *     Не положено — письма нет. HTTP-ручка `/api/auth/sign-in/magic-link`
 *     снаружи закрыта (middleware/authPathAllowList.js);
 *   • вход (`hooks.sessionRefusal` из `databaseHooks.session.create.before`):
 *     ссылки, выписанные до этого правила, и любые, что появятся мимо отправки.
 */

/** Путь ручки входа по ссылке — `ctx.path` в хуке создания сеанса. */
const MAGIC_LINK_VERIFY_PATH = "/magic-link/verify";

const LINK_REFUSED =
  "Ссылка из письма для этой учётной записи не действует. Войдите на странице входа.";

/**
 * Можно ли выслать ссылку. Клиент — только ЯВНЫЙ (`isEndUser === true`):
 * учётная запись без записанного типа ссылку не получает. Служебной входить
 * нечем и незачем — как в приглашении.
 *
 * @param {object|null} user — lean-документ: isEndUser, isServiceAccount,
 *   banned, banExpires, twoFactorEnabled, company.isActive
 * @returns {boolean}
 */
const mayReceiveMagicLink = (user) =>
  Boolean(user) &&
  user.isEndUser === true &&
  !user.isServiceAccount &&
  !isBanned(user) &&
  user.company?.isActive !== false &&
  !user.twoFactorEnabled;

/**
 * Отказ в сеансе, который выписывает ручка входа по ссылке. Остальные способы
 * входа (пароль, код из письма, подмена, серверные вызовы вне ручки) — не его
 * дело: их правила в `sessionRefusal` и в плагинах.
 *
 * @param {{ path?: string|null, user?: object|null }} params — путь ручки
 *   (`ctx.path`) и lean-документ с isEndUser и twoFactorEnabled
 * @returns {string|null} текст отказа или null
 */
const refuseMagicLinkSession = ({ path, user }) => {
  if (path !== MAGIC_LINK_VERIFY_PATH || !user) return null;
  return user.isEndUser === false || user.twoFactorEnabled ? LINK_REFUSED : null;
};

module.exports = {
  MAGIC_LINK_VERIFY_PATH,
  mayReceiveMagicLink,
  refuseMagicLinkSession,
};
