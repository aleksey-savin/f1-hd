const isEmail = require("validator/lib/isEmail");

const { accountAudienceOf } = require("@/auth/access");
const { escapeHtml } = require("@/services/telegramMessage");

/**
 * Правка карточки человека (`POST /api/users/update/:id`) — что она делает с
 * ДОСТУПОМ его учётной записи. Решение отдельно от контроллера: контроллер
 * читает базу и пишет документ, а правила проверяются без базы.
 *
 * Три поля карточки на деле не анкета, а доступ:
 *   • email — по нему входят (пароль, код, ссылка). Сменить его — перевести
 *     вход на другой ящик, поэтому смена требует `user.manageAccess`, гасит
 *     сеансы и уведомляет прежний адрес (последнее делает контроллер);
 *   • banned — отключение. Меняется только ПРИСЛАННЫМ ДРУГИМ значением и
 *     правом ручки отключения: пропущенное поле раньше молча включало учётку
 *     (`Boolean(undefined)`);
 *   • isEndUser — тип учётной записи: сотрудник или клиент. Только булево:
 *     пропуск раньше стирал поле, и учётка оказывалась ни сотрудником, ни
 *     клиентом. Тип — это адресат (`accountAudienceOf`): от него зависит, какие
 *     права учётки действуют, поэтому СМЕНА типа требует того же
 *     `user.manageAccess`, что и смена email. Сменой считается присланное
 *     булево, которое меняет адресата; то же значение, что записано, права не
 *     требует (учётка без записанного типа — клиент, и `true` для неё не смена).
 *
 * Проверки формы идут раньше проверок права: кривое тело — 400 при любых
 * правах. Права проверяются по порядку: email, тип учётной записи, отключение;
 * отказ (403) — по первому, которого не хватает.
 */

const MESSAGES = {
  isEndUser: "Тип учётной записи передан неверно",
  banned: "Признак отключения передан неверно",
  emailInvalid: "Неверный email",
  emailEmpty: "Укажите email",
  emailRight: "Недостаточно прав, чтобы менять email: по нему входят в портал",
  typeRight: "Недостаточно прав, чтобы менять тип учётной записи",
  banRight: "Недостаточно прав, чтобы отключать и включать учётную запись",
};

const refuse = (status, message) => ({
  refusal: { status, message },
  emailChange: null,
  banned: undefined,
  isEndUser: undefined,
  audienceChanged: false,
});

/**
 * @param {object} params
 * @param {object} params.target — документ пользователя до правки
 * @param {object} params.body — тело запроса
 * @param {boolean} params.mayManageAccess — `req.auth.can({ user: ["manageAccess"] })`:
 *   нужно и для смены email, и для смены типа учётной записи (`isEndUser`)
 * @param {boolean} params.mayBan — право ручки отключения (`user.manage`)
 * @returns {{
 *   refusal: {status: number, message: string} | null,
 *   emailChange: {from: string, to: string} | null,
 *   banned: boolean | undefined,
 *   isEndUser: boolean | undefined,
 *   audienceChanged: boolean,
 * }} `undefined` у поля — не трогать. `refusal` — 400 на кривое тело (раньше
 *   любых прав) или 403 на нехватку права: email, тип учётной записи или
 *   отключение; при отказе остальные поля пусты. `isEndUser` отдаётся как
 *   прислано, и запись того же значения, что уже стоит, безвредна. Сменой типа
 *   считается только `audienceChanged` — она и требует `mayManageAccess`, по
 *   ней контроллер пересчитывает роли.
 */
const planAccountUpdate = ({ target, body, mayManageAccess, mayBan }) => {
  const { email, banned, isEndUser } = body || {};

  if (isEndUser !== undefined && typeof isEndUser !== "boolean") {
    return refuse(400, MESSAGES.isEndUser);
  }
  if (banned !== undefined && typeof banned !== "boolean") {
    return refuse(400, MESSAGES.banned);
  }

  let emailChange = null;
  if (email !== undefined) {
    if (typeof email !== "string") return refuse(400, MESSAGES.emailInvalid);
    const next = email.trim().toLowerCase();
    const current = String(target.email || "").trim().toLowerCase();
    if (next !== current) {
      if (!next) return refuse(400, MESSAGES.emailEmpty);
      if (!isEmail(next)) return refuse(400, MESSAGES.emailInvalid);
      emailChange = { from: current, to: next };
    }
  }

  // Поля `banned` в документе может не быть — это «работает»
  const bannedChanges =
    banned !== undefined && banned !== Boolean(target.banned);

  // Адресат, а не сырое поле: учётка без записанного типа — клиент
  // (accountAudienceOf), и «клиент» для неё сменой не считается
  const audienceChanged =
    isEndUser !== undefined &&
    accountAudienceOf(target) !== accountAudienceOf({ isEndUser });

  if (emailChange && !mayManageAccess) return refuse(403, MESSAGES.emailRight);
  if (audienceChanged && !mayManageAccess) {
    return refuse(403, MESSAGES.typeRight);
  }
  if (bannedChanges && !mayBan) return refuse(403, MESSAGES.banRight);

  return {
    refusal: null,
    emailChange,
    banned: bannedChanges ? banned : undefined,
    isEndUser,
    audienceChanged,
  };
};

/**
 * Письмо на ПРЕЖНИЙ адрес о смене email — документ `Notification` (очередь
 * services/mail/outbox, вне прода получатель подменяется моделью). На
 * прежний: новый мог вписать тот, кто учётную запись и уводит, а владелец
 * узнаёт об этом из своего ящика.
 */
const emailChangedNotice = ({ from, to }) => ({
  instrument: "email",
  to: { email: from },
  title: "Email учётной записи изменён",
  text: `<p>Email вашей учётной записи изменён на ${escapeHtml(to)}. Если это сделали не вы — обратитесь к администратору.</p>`,
});

module.exports = {
  planAccountUpdate,
  emailChangedNotice,
  ACCOUNT_UPDATE_MESSAGES: MESSAGES,
};
