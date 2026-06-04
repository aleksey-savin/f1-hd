const TicketLog = require("@/models/ticketLog");
const logger = require("@/utils/logger");

// Системный «пользователь» для записей лога, сделанных ИИ-обработкой.
const AI_USER = { firstName: "ИИ", lastName: "" };

/**
 * Записать событие фоновой ИИ-обработки в лог заявки (распознавание речи,
 * автоопределение категории и т.п.). Никогда не бросает исключение — сбой записи
 * лога не должен влиять на саму обработку.
 *
 * @param {string|object} ticketId
 * @param {string} event текст события (на русском)
 * @param {"info"|"warning"|"danger"} [severity="info"]
 */
exports.logAiTicketEvent = async (ticketId, event, severity = "info") => {
  try {
    await new TicketLog({
      ticketId,
      user: AI_USER,
      severity,
      event,
    }).save();
  } catch (error) {
    logger.log("error", "Failed to write AI ticket log", {
      ticketId: typeof ticketId === "object" ? ticketId?.toString() : ticketId,
      event,
      error: error.message,
    });
  }
};
