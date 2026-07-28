const logger = require("./logger");

/**
 * Заглушка почты вне прода — последняя дверь перед SMTP.
 *
 * Письма физически отправляет этот пакет, поэтому здесь стоит финальная
 * проверка: что бы ни лежало в очереди Notification (её мог создать бэкенд
 * старой версии, миграция или прод-снимок базы), вне продакшена письмо уйдёт
 * только на разработческий ящик.
 *
 * Условие «от обратного»: подменяем всегда, КРОМЕ явного NODE_ENV=production.
 * В dev-контейнерах NODE_ENV не задан вовсе — проверка «не dev» была бы тихо
 * бесполезной. Ошибка в сторону лишнего редиректа заметна сразу, ошибка в
 * другую сторону — это письмо реальному клиенту из копии прод-базы.
 *
 * Зеркало этой защиты — backend/utils/mailGuard.js (подмена на этапе записи
 * уведомления в очередь).
 */

const DEV_RECIPIENT = process.env.DEV_MAIL_RECIPIENT || "a.savin@f1lab.ru";

const isProduction = () => process.env.NODE_ENV === "production";

const guardRecipient = (to) => {
  if (isProduction() || !to) {
    return { to, redirected: false, intended: to };
  }
  if (to === DEV_RECIPIENT) {
    return { to, redirected: false, intended: to };
  }
  logger.log("warn", "Mail recipient redirected (non-production)", {
    module: "mailGuard",
    intended: to,
    actual: DEV_RECIPIENT,
  });
  return { to: DEV_RECIPIENT, redirected: true, intended: to };
};

const guardSubject = (subject, intended) =>
  isProduction() ? subject : `[DEV → ${intended || "?"}] ${subject || ""}`.trim();

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
