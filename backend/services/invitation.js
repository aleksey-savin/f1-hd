const mongoose = require("mongoose");

const { getAuth, getFromNodeHeaders } = require("@/auth/bootstrap");
const logger = require("@/utils/logger");

/**
 * Приглашение в портал — письмо при заведении учётной записи.
 *
 * Способ входа выбирает СЕРВЕР, а не администратор: клиент входит по ссылке,
 * сотрудник задаёт пароль. Это свойство учётной записи, а не решение того, кто
 * её заводит, — то же правило, что на экране входа («одна дверь»).
 *
 * Текст письма при этом свой, а не переиспользованное восстановление: человек,
 * который не знал о существовании портала, получает «Восстановление доступа»,
 * ничего не восстанавливал — и читает письмо как чужое или как фишинг. Какой
 * текст отправить, решают сами хуки писем по СОСТОЯНИЮ учётки (нет пароля и ни
 * одного входа = доступ открывают впервые) — помечать вызов нечем: у
 * восстановления метаданных нет.
 */

/**
 * Ссылка в приглашении живёт ДОЛЬШЕ обычной.
 *
 * Обычную ссылку входа человек только что запросил сам — тридцати минут ему
 * достаточно, и короткий срок тут защита. Приглашение приходит без спроса: его
 * откроют вечером, завтра, после выходных. Двое суток — компромисс между «успел
 * прочитать» и «не валяется в почте месяцами»; дальше человек берёт новую сам
 * кнопкой «Прислать письмо» на входе.
 */
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Плагин `magic-link` берёт срок ТОЛЬКО из своих опций — на вызов его не
 * переопределить. Поэтому строку проверки продлеваем после выписки: находим
 * свежую запись по адресу внутри значения. Внутри одного запроса она
 * единственная, а лишний час жизни у чужой строки был бы хуже, чем у своей,
 * поэтому берём самую новую и только что созданную.
 */
const extendMagicLink = async (email) => {
  const rows = mongoose.connection.db.collection("authVerifications");
  const fresh = await rows
    .find({ value: { $regex: email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") } })
    .sort({ _id: -1 })
    .limit(1)
    .next();

  if (!fresh) return;
  await rows.updateOne(
    { _id: fresh._id },
    { $set: { expiresAt: new Date(Date.now() + INVITE_TTL_MS) } },
  );
};

/**
 * @param {object} user — только что созданный документ пользователя
 * @param {object} req — нужен ради заголовков: better-auth ждёт их у своих ручек
 * @returns {Promise<boolean>} ушло ли письмо
 */
const invite = async (user, req) => {
  // Служебной учётке входить нечем и незачем.
  if (user.isServiceAccount || !user.email) return false;

  const headers = getFromNodeHeaders()(req.headers);
  const byLink = user.isEndUser !== false && !user.twoFactorEnabled;

  try {
    if (byLink) {
      await getAuth().api.signInMagicLink({
        body: {
          email: user.email,
          callbackURL: "/",
        },
        headers,
      });
      await extendMagicLink(user.email);
    } else {
      await getAuth().api.requestPasswordReset({
        body: { email: user.email },
        headers,
      });
    }

    user.invitedAt = new Date();
    await user.save();
    return true;
  } catch (error) {
    // Учётка уже создана, и ронять всё из-за письма нельзя: человека заведут
    // заново с тем же адресом и получат конфликт. Приглашение можно повторить.
    logger.log("error", "Не удалось отправить приглашение", {
      email: user.email,
      error: error.message,
    });
    return false;
  }
};

module.exports = { invite, INVITE_TTL_MS };
