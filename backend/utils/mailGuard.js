const logger = require("./logger");

/**
 * Заглушка почты вне прода.
 *
 * Дев-база — копия прода (см. sync-dev-db.sh): в ней лежат живые адреса
 * клиентов, включён канал `notify.byEmail` и боевой SMTP. Любое уведомление,
 * созданное на деве, ушло бы настоящему заказчику. Поэтому вне продакшена
 * получатель ПРИНУДИТЕЛЬНО подменяется на разработческий ящик — без
 * исключений и независимо от настроек в базе.
 *
 * Условие намеренно «от обратного»: подменяем всегда, КРОМЕ явного
 * NODE_ENV=production. Прежняя проверка `NODE_ENV !== "development"` была
 * тихо сломана — в dev-контейнерах NODE_ENV не задан вовсе, поэтому она всегда
 * давала «это не dev» и ничего не подавляла. Ошибаться эта проверка должна в
 * сторону «письмо не ушло клиенту», а не наоборот: лишний редирект на проде
 * заметят в тот же день, утёкшее письмо — не отзовёшь.
 *
 * Вторая (последняя) дверь — services/mail/send.js: письма
 * физически отправляет он, и там стоит такая же защита.
 */

const DEV_RECIPIENT = process.env.DEV_MAIL_RECIPIENT || "a.savin@f1lab.ru";

const isProduction = () => process.env.NODE_ENV === "production";

/** Куда на самом деле уйдёт письмо. */
const guardRecipient = (email, context = {}) => {
  if (isProduction() || !email) {
    return email;
  }
  if (email === DEV_RECIPIENT) {
    return email;
  }
  logger.log("warn", "Mail recipient redirected (non-production)", {
    ...context,
    intended: email,
    actual: DEV_RECIPIENT,
  });
  return DEV_RECIPIENT;
};

/** Пометка в теме, чтобы письмо на деве нельзя было спутать с боевым. */
const guardSubject = (subject, intendedEmail) =>
  isProduction()
    ? subject
    : `[DEV → ${intendedEmail || "?"}] ${subject || ""}`.trim();

// Состояние заглушки видно в первых строках лога: если она вдруг окажется
// включённой на проде, это заметят сразу, а не по жалобам клиентов
logger.log(
  isProduction() ? "info" : "warn",
  isProduction()
    ? "Mail guard OFF (production): письма уходят настоящим получателям"
    : `Mail guard ON: ВСЕ письма уходят только на ${DEV_RECIPIENT}`,
  { module: "mailGuard", nodeEnv: process.env.NODE_ENV || null },
);

module.exports = { DEV_RECIPIENT, isProduction, guardRecipient, guardSubject };
