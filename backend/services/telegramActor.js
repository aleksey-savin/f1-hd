const User = require("@/models/user");

const { buildAuthContext, isDeniedAccount } = require("@/services/authContext");
const { claim } = require("@/services/telegramPairing");
const logger = require("@/utils/logger");

/**
 * Кто стоит за телеграм-запросом.
 *
 * Общий секрет `X-TG-Token` доказывает, что зовёт БОТ, и никогда — от чьего
 * имени. Поэтому актора разрешает бэкенд по своей таблице привязок, а не бот по
 * своему слову: у бота остаётся ровно один секрет и ни одного удостоверения
 * пользователя. Отсюда же следует, что скомпрометированный бот может выступать
 * только за уже привязанных людей, а не за кого угодно.
 *
 * Правила отказа берутся из `services/authContext` — те же, что у браузерного
 * сеанса. Отдельного списка «кого пускать в бота» нет намеренно: он бы разошёлся
 * (сегодня и разошёлся — `banned` не проверялся в боте вовсе).
 */

/**
 * В личном чате Telegram `chat.id` равен id пользователя и положителен; у
 * групп, супергрупп и каналов он отрицательный. Привязка учётки к группе —
 * это не «человек подключил бота», а «комната говорит от имени человека»:
 * каждый её участник начинает получать чужие уведомления и заводить заявки от
 * чужого имени. Такую привязку не заводим.
 */
const isPrivateChatId = (chatId) => /^[0-9]+$/.test(String(chatId ?? "").trim());

/**
 * Привязать чат к учётке по одноразовому коду.
 *
 * @returns {{ok: true, user: object} | {ok: false, reason: string}}
 */
const bindChat = async ({ code, chatId }) => {
  const chat = String(chatId ?? "").trim();

  if (!isPrivateChatId(chat)) {
    return { ok: false, reason: "group-chat" };
  }

  const claimed = await claim(code);
  if (!claimed) {
    return { ok: false, reason: "invalid-code" };
  }

  const user = await User.findById(claimed.userId);
  if (!user) {
    return { ok: false, reason: "not-found" };
  }

  // Код выписывается живому человеку, но между выпиской и обменом проходит до
  // пятнадцати минут — за них учётку успевают отключить.
  if (isDeniedAccount(user)) {
    return { ok: false, reason: "denied" };
  }

  /**
   * Один чат — одна учётка. Уникального индекса на `telegramBot.chatId` нет, а
   * `findOne` по нему выбирает произвольный документ из совпавших: две учётки
   * с одним chatId означали бы, что бот показывает то одного человека, то
   * другого. Прежнюю привязку снимаем здесь, а не полагаемся на то, что её
   * снимет владелец.
   */
  await User.updateMany(
    { "telegramBot.chatId": chat, _id: { $ne: user._id } },
    { $set: { "telegramBot.isActive": false, "telegramBot.chatId": "" } },
  );

  user.set("telegramBot.isActive", true);
  user.set("telegramBot.chatId", chat);
  user.set("telegramBot.linkedAt", new Date());
  await user.save();

  return { ok: true, user };
};

/**
 * Собрать `req.auth` по телеграм-идентификатору. `null` значит «актор не
 * разрешён» — вызывающий отвечает 401, не раскрывая, чем именно не подошёл.
 */
const resolveActor = async (tgUserId) => {
  const chat = String(tgUserId ?? "").trim();

  // Пустая строка — не «нет актора», а совпадение с дефолтом `chatId: ""` у
  // всех непривязанных учёток. Раньше на этом спотыкался
  // `setWorkStatusFromTelegram`: `String(tgUserId || "")` уходил в запрос как
  // есть и мог поднять чужой документ.
  if (!isPrivateChatId(chat)) {
    return null;
  }

  const matches = await User.find({
    "telegramBot.chatId": chat,
    "telegramBot.isActive": true,
  }).limit(2);

  if (matches.length !== 1) {
    if (matches.length > 1) {
      // Данные из времён, когда `chatId` принимался из тела запроса. Молча
      // взять первого — значит выдать боту чужую учётку.
      logger.log("error", "Один telegram-чат привязан к нескольким учётным записям", {
        module: "telegramActor",
        chatId: chat,
        users: matches.map((user) => user._id.toString()),
      });
    }
    return null;
  }

  const user = matches[0];
  if (isDeniedAccount(user)) {
    return null;
  }

  return buildAuthContext(user);
};

module.exports = { bindChat, resolveActor, isPrivateChatId };
