const mongoose = require("mongoose");

const Preferences = require("../models/preferences");
const User = require("../models/user");
const {
  WORK_STATUSES,
  WORK_STATUS_BY_CODE,
} = require("../utils/workStatuses");
// tgBotApi лениво требует этот модуль из callback-обработчика — прямой require
// здесь безопасен, цикла на этапе загрузки нет (tgBotApi загружается первым).
const { getBot, formatDate } = require("../middleware/tgBotApi");
const logger = require("../utils/logger");

const TG_TEXT_LIMIT = 4096;

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const capitalize = (text) =>
  text ? text[0].toUpperCase() + text.slice(1) : text;

// Статичная клавиатура из каталога: 6 статусов по 2 в ряд + сброс. Собирается
// детерминированно, поэтому на no-op сравнение текста не влияет.
const boardKeyboard = () => {
  const real = WORK_STATUSES.filter((status) => status.code !== "unset");
  const rows = [];
  for (let i = 0; i < real.length; i += 2) {
    rows.push(
      real.slice(i, i + 2).map((status) => ({
        text: `${status.emoji} ${status.label}`,
        callback_data: `ws:${status.code}`,
      })),
    );
  }
  rows.push([
    {
      text: `${WORK_STATUS_BY_CODE.unset.emoji} сбросить статус`,
      callback_data: "ws:unset",
    },
  ]);
  return { inline_keyboard: rows };
};

const renderBoardText = (staff, timezone, { withNotes = true } = {}) => {
  const lines = ["<b>Статусы сотрудников</b>"];

  for (const status of WORK_STATUSES) {
    const group = staff.filter(
      (user) => (user.workStatus?.code || "unset") === status.code,
    );
    if (group.length === 0) {
      continue;
    }

    lines.push("");
    lines.push(
      `${status.emoji} <b>${capitalize(status.label)} — ${group.length}</b>`,
    );
    for (const user of group) {
      const name = escapeHtml(
        `${user.lastName || ""} ${user.firstName || ""}`.trim(),
      );
      const note =
        withNotes && user.workStatus?.note
          ? ` (${escapeHtml(user.workStatus.note)})`
          : "";
      lines.push(`• ${name}${note}`);
    }
  }

  // Футер — момент ПОСЛЕДНЕЙ смены статуса, не «сейчас»: иначе текст различался
  // бы на каждом тике и no-op сравнение с lastText никогда бы не срабатывало.
  const timestamps = staff
    .map((user) => user.workStatus?.updatedAt)
    .filter(Boolean)
    .map((date) => new Date(date).getTime());
  if (timestamps.length > 0) {
    lines.push("");
    lines.push(
      `<i>Обновлено: ${formatDate(new Date(Math.max(...timestamps)), timezone)}</i>`,
    );
  }

  return lines.join("\n");
};

// Ступенчатая деградация под лимит Telegram: без заметок → усечение строк
const renderBoardTextWithLimit = (staff, timezone) => {
  let text = renderBoardText(staff, timezone);
  if (text.length <= TG_TEXT_LIMIT) {
    return text;
  }

  text = renderBoardText(staff, timezone, { withNotes: false });
  if (text.length <= TG_TEXT_LIMIT) {
    return text;
  }

  const suffix = "\n<i>…список усечён</i>";
  const lines = text.split("\n");
  while (
    lines.length &&
    lines.join("\n").length + suffix.length > TG_TEXT_LIMIT
  ) {
    lines.pop();
  }
  logger.log("warn", "Status board text truncated to fit Telegram limit");
  return lines.join("\n") + suffix;
};

let isChecking = false;
// Дедупликация повторяющихся ошибок: тик каждые 20 с, «chat not found» на
// dev-стенде с прод-данными иначе зальёт лог одинаковыми записями.
let lastErrorSignature = "";

const logDeduped = (level, message, meta = {}) => {
  const signature = `${level}:${message}`;
  if (signature === lastErrorSignature) {
    return;
  }
  lastErrorSignature = signature;
  logger.log(level, message, meta);
};

const persistBoard = (fields) => Preferences.updateOne({}, { $set: fields });

const handleTelegramError = async (error, text) => {
  const body = error?.response?.body || {};
  const description = String(body.description || error.message || "");
  const migrateTo = body.parameters?.migrate_to_chat_id;

  if (description.includes("message is not modified")) {
    // Контент в Telegram уже актуален — синхронизируем кэш и живём дальше
    await persistBoard({ "statusBoard.lastText": text });
    lastErrorSignature = "";
    return;
  }

  if (migrateTo) {
    // Группа стала супергруппой — переезжаем на новый chat id и пересоздаёмся
    await persistBoard({
      "statusBoard.chatId": String(migrateTo),
      "statusBoard.messageId": null,
      "statusBoard.lastText": "",
    });
    logger.log("info", "Status board chat migrated to supergroup", {
      migrateTo,
    });
    return;
  }

  if (
    description.includes("message to edit not found") ||
    description.includes("MESSAGE_ID_INVALID")
  ) {
    // Табло удалили руками — пересоздадим и закрепим на следующем тике
    await persistBoard({
      "statusBoard.messageId": null,
      "statusBoard.lastText": "",
    });
    logger.log("info", "Status board message was deleted, recreating");
    return;
  }

  if (description.includes("message thread not found")) {
    // Ветку удалили. messageThreadId сохраняем: это явный выбор админа —
    // пусть переназначит /status_board, а не получит табло молча в General.
    await persistBoard({
      "statusBoard.messageId": null,
      "statusBoard.lastText": "",
    });
    logDeduped(
      "error",
      "Status board topic deleted — выполните /status_board в нужной ветке",
    );
    return;
  }

  if (description.includes("TOPIC_CLOSED")) {
    // Закрытая ветка блокирует отправку; после открытия всё само продолжится
    logDeduped(
      "error",
      "Status board topic is closed — откройте ветку или выберите другую командой /status_board",
    );
    return;
  }

  // «chat not found» / бот выгнан из группы и прочее — ждём починки конфига
  logDeduped("warn", "Status board update failed", { description });
};

// Конвергентный цикл табло: каждый тик рендерит эталонный текст из БД и
// правит закреплённое сообщение, только если текст изменился. Любой сбой
// (удалённое сообщение, миграция чата, рестарт) сходится на следующем тике.
exports.checkStatusBoard = async () => {
  if (isChecking) {
    return;
  }
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  isChecking = true;
  try {
    const prefs = await Preferences.findOne({});
    const board = prefs?.statusBoard;
    if (!board?.isActive) {
      return;
    }

    // Пустой chatId — фолбэк на группу уведомлений
    const chatId = board.chatId || prefs.notify?.byTelegram?.chatId || "";
    if (!chatId) {
      return;
    }

    const staff = await User.find({
      isActive: true,
      isEndUser: false,
      isServiceAccount: false,
      isCloudTelephony: false,
      hideWorkStatus: { $ne: true },
    })
      .sort({ lastName: 1, firstName: 1 })
      .lean();

    const text = renderBoardTextWithLimit(staff, prefs.timezone);
    const bot = getBot();
    const replyMarkup = boardKeyboard();

    try {
      // Инициализация: сообщения ещё нет — отправляем в нужную ветку и закрепляем
      if (board.messageId == null) {
        const sendOptions = {
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: replyMarkup,
        };
        if (board.messageThreadId) {
          sendOptions.message_thread_id = Number(board.messageThreadId);
        }

        const message = await bot.sendMessage(chatId, text, sendOptions);

        try {
          await bot.pinChatMessage(chatId, message.message_id);
        } catch (pinError) {
          logger.log(
            "warn",
            "Failed to pin status board — выдайте боту право «Закрепление сообщений», табло работает незакреплённым",
            { error: pinError.message },
          );
        }

        await persistBoard({
          "statusBoard.messageId": message.message_id,
          "statusBoard.lastText": text,
        });
        lastErrorSignature = "";
        logger.log("info", "Status board created", { chatId });
        return;
      }

      // Обычный путь: ничего не изменилось — ноль обращений к Telegram
      if (text === board.lastText) {
        return;
      }

      // Клавиатуру передаём на каждом edit — без reply_markup Telegram её снимет
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: board.messageId,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: replyMarkup,
      });

      await persistBoard({ "statusBoard.lastText": text });
      lastErrorSignature = "";
    } catch (tgError) {
      await handleTelegramError(tgError, text);
    }
  } catch (error) {
    logger.log("error", "Status board check failed", {
      error: error.message,
      stack: error.stack,
    });
  } finally {
    isChecking = false;
  }
};
