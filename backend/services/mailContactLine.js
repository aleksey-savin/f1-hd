/**
 * Фраза «как с нами связаться» в письмах заявителю по заявке.
 *
 * Телефон организации (`Preferences.contacts.tel`) необязателен: без него
 * письмо не должно звать позвонить «по номеру» в пустоту — остаётся только
 * ответ письмом. Отдаёт готовый HTML-текст одного предложения.
 */
const { formatPhone } = require("./phone");
const { escapeHtml } = require("./brand");

const REPLY = "отправьте ответное письмо (только не меняйте тему).";

const mailContactLine = (preferences) => {
  const raw = preferences?.contacts?.tel;
  const phone = typeof raw === "string" && raw.trim() ? formatPhone(raw).trim() : "";
  const lead = "Если у Вас есть вопросы или дополнительная информация, пожалуйста,";
  return phone
    ? `${lead} позвоните нам по номеру ${escapeHtml(phone)} или ${REPLY}`
    : `${lead} ${REPLY}`;
};

module.exports = { mailContactLine };
