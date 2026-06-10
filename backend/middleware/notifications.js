const jwt = require("jsonwebtoken");
const pad = require("pad");

const logger = require("../utils/logger");

const Notification = require("../models//notification");
const { Ticket } = require("../models//ticket");
const Comment = require("../models//comment");
const Preferences = require("../models//preferences");
const User = require("../models//user");
const Work = require("../models/work");

const NOTIFICATION_BATCH_SIZE = 100;

const isTransientMongoNetworkError = (error) =>
  error?.code === "ECONNRESET" ||
  error?.message?.includes("ECONNRESET") ||
  error?.message?.includes("socket has been ended");

const withMongoRetry = async (operation, context) => {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientMongoNetworkError(error)) {
      throw error;
    }

    logger.log("warn", `Retrying ${context} after MongoDB socket error`, {
      error: error.message,
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    return operation();
  }
};

const notificationsEnabled = (prefs) =>
  prefs?.notify?.byEmail?.isActive || prefs?.notify?.byTelegram?.isActive;

// Inline-кнопка Telegram со ссылкой на заявку (заменяет текстовые <a href> в уведомлениях).
// Telegram отклоняет inline-кнопки с невалидным URL (localhost/127.* и пустой ADDRESS)
// ошибкой BUTTON_URL_INVALID, что роняет всю отправку. В таких случаях (например, в dev)
// кнопку не добавляем — сообщение уходит без неё.
const ticketButton = (num) => {
  const base = process.env.ADDRESS || "";
  const isLocal = /\/\/(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(base);
  if (!/^https?:\/\//i.test(base) || isLocal) {
    return undefined;
  }
  return {
    inline_keyboard: [
      [{ text: "Подробнее", url: `${base}/tickets/${num}` }],
    ],
  };
};

exports.createTicketNotifications = async () => {
  const prefs = await withMongoRetry(
    () => Preferences.findOne({}),
    "loading preferences for ticket notifications",
  );
  if (!notificationsEnabled(prefs)) {
    logger.log(
      "debug",
      "Skipping ticket notifications because notifications are disabled",
    );
    return;
  }

  const tickets = await withMongoRetry(
    () =>
      Ticket.find({
        "notifications.pending": true,
        // Не уведомляем, пока ИИ распознаёт звонок: дождёмся итога и заголовка,
        // иначе в уведомление попадёт заглушка вместо сформированных ИИ данных.
        // $ne: "pending" также пропускает заявки без поля aiSpeech (портал/почта).
        "aiSpeech.status": { $ne: "pending" },
      })
        .sort({ updatedAt: 1 })
        .limit(NOTIFICATION_BATCH_SIZE)
        .populate("applicantId"),
    "loading pending ticket notifications",
  );

  const notifyTg = (user, state) =>
    prefs.notify?.byTelegram?.isActive &&
    user?.telegramBot?.isActive &&
    user?.notify?.byTelegram?.[state] &&
    prefs.notify?.personal?.[state];

  const notifyTgGroup =
    prefs.notify?.byTelegram?.sendToGroup &&
    prefs.notify?.byTelegram?.isActive;

  const notifyEmail = (user, state) =>
    // В dev почтовые уведомления подавляем, чтобы не слать письма реальным
    // пользователям; telegram при этом работает (тест-бот безопасен).
    process.env.NODE_ENV !== "development" &&
    prefs.notify?.byEmail?.isActive &&
    user?.notify?.byEmail?.[state] &&
    prefs.notify?.personal?.[state];

  for (let ticket of tickets) {
    const lastAction = ticket.notifications.lastAction;
    const applicantId = ticket.applicantId?._id;

    if (!applicantId) {
      logger.log("warn", "Skipping ticket notification without applicant", {
        ticketId: ticket._id,
        ticketNum: ticket.num,
      });
      ticket.notifications.pending = false;
      await ticket.save();
      continue;
    }

    const applicant = await User.findById(applicantId);

    if (!applicant) {
      ticket.notifications.pending = false;
      await ticket.save();
      continue;
    }

    switch (lastAction) {
      case "new ticket":
        //--------------------------------------------------
        //-------------------- TELEGRAM --------------------
        //--------------------------------------------------

        // notifying global
        try {
          if (notifyTgGroup) {
            const newTicketNotification = new Notification({
              instrument: "telegram",
              ticketId: ticket._id,
              to: {
                chatId: prefs.notify.byTelegram.chatId,
                globalChat: true,
              },
              text: `⭐️ <b>Новая заявка ${ticket.num}</b>\n<b>Тема: ${ticket.title}</b>\nКомпания: ${ticket.company.alias}\nИнициатор: ${ticket.applicantId.lastName} ${ticket.applicantId.firstName}\n<b>Статус: ${ticket.state}</b>\n#ticket_${ticket.num}`,
              replyMarkup: ticketButton(ticket.num),
            });
            await newTicketNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create new ticket notification to telegram group",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        // notifying applicant
        try {
          if (notifyTg(applicant, "newTicket")) {
            const newTicketNotification = new Notification({
              instrument: "telegram",
              ticketId: ticket._id,
              to: {
                chatId: applicant.telegramBot.chatId,
                applicant: `${applicant.lastName} ${applicant.firstName}`,
              },
              text: `⭐️ <b>Новая заявка ${ticket.num}</b>\n<b>Тема: ${ticket.title}</b>\n#ticket_${ticket.num}`,
              replyMarkup: ticketButton(ticket.num),
            });
            await newTicketNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create new ticket notification to applicant's telegram",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        // notifying responsibles
        try {
          for (let responsible of ticket.responsibles) {
            const resp = await User.findById(responsible._id);

            if (
              notifyTg(resp, "respStateUpdate") &&
              !responsible.isNotified?.telegram
            ) {
              const newTicketNotification = new Notification({
                instrument: "telegram",
                ticketId: ticket._id,
                to: {
                  chatId: resp.telegramBot.chatId,
                  responsible: `${resp.lastName} ${resp.firstName}`,
                },
                text: `🟢 <b>Вы добавлены в список ответственных заявки ${ticket.num}</b>\n<b>Тема: ${ticket.title}</b>\nКомпания: ${ticket.company.alias}\nИнициатор: ${ticket.applicantId.lastName} ${ticket.applicantId.firstName}\n<b>Статус: ${ticket.state}</b>\n#ticket_${ticket.num}`,
                replyMarkup: ticketButton(ticket.num),
              });
              await newTicketNotification.save();

              responsible.isNotified.telegram = true;
              await ticket.save();
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create new ticket notification to responsible's group",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        //-----------------------------------------------
        //-------------------- EMAIL --------------------
        //-----------------------------------------------

        // notifying applicant
        try {
          if (
            notifyEmail(applicant, "newTicket") &&
            !applicant.isServiceAccount
          ) {
            const newTicketNotification = new Notification({
              instrument: "email",
              ticketId: ticket._id,
              to: {
                email: applicant.email,
                applicant: `${applicant.lastName} ${applicant.firstName}`,
              },
              title: `[F1-HD-${ticket.num}] Создана новая Заявка`,
              text: `
                            <div>
                                <h3>Создана новая Заявка №${ticket.num}.</h3>
                                <p>${applicant.firstName},</p>
                                <p>
                                    По вашему обращению создана заявка №${ticket.num}. Мы передадим
                                    её специалисту и сообщим Вам, как только он примет её в работу.
                                </p>
                                <p>
                                    Если у Вас есть вопросы или дополнительная
                                    информация, пожалуйста, позвоните нам по номеру
                                    ${prefs.contacts.tel} или отправьте ответное
                                    письмо(только не меняйте тему).
                                </p>
                                <p>Подробнее: ${process.env.ADDRESS}/tickets/${ticket.num}</p>
                                <p>
                                    С уважением,<br></br>Команда F1Lab
                                </p>
                            </div>
                        `,
            });
            await newTicketNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create new ticket notification to applicant's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        // notifying responsibles
        try {
          for (let resp of ticket.responsibles) {
            const user = await User.findById(resp._id);
            if (notifyEmail(user, "respStateUpdate")) {
              const newTicketNotification = new Notification({
                instrument: "email",
                ticketId: ticket._id,
                to: {
                  email: user.email,
                  responsible: `${user.lastName} ${user.firstName}`,
                },
                title: `[F1-HD-${ticket.num}] Вы назначенны ответственным(ой) за Заявку`,
                text: `
                                    <div>
                                        <h3>Вы назначены ответственным(ой) за Заявку ${ticket.num}.</h3>
                                        <ul>
                                            <li>Компания: ${ticket.company.alias}</li>
                                            <li>Инициатор: ${ticket.applicantId.lastName} ${ticket.applicantId.firstName}</li>
                                            <li>Тема: ${ticket.title}</li>
                                            <li>Описание: ${ticket.description}</li>
                                            <li>Статус: ${ticket.state}</li>
                                            <li>Ссылка: ${process.env.ADDRESS}/tickets/${ticket.num}</li>
                                        </ul>
                                    </div>
                                `,
              });
              await newTicketNotification.save();

              await ticket.save();
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create new ticket notification to responsible's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        ticket.notifications.pending = false;
        await ticket.save();

        break;

      case "process ticket":
        //--------------------------------------------------
        //-------------------- TELEGRAM --------------------
        //--------------------------------------------------

        // notifying responsibles
        try {
          for (let responsible of ticket.responsibles) {
            const resp = await User.findById(responsible._id);

            if (
              notifyTg(resp, "respStateUpdate") &&
              !responsible.isNotified?.telegram
            ) {
              const newTicketNotification = new Notification({
                instrument: "telegram",
                ticketId: ticket._id,
                to: {
                  chatId: resp.telegramBot.chatId,
                  responsible: `${resp.lastName} ${resp.firstName}`,
                },
                text: `🟢 <b>Вы добавлены в список ответственных заявки ${ticket.num}</b>\n<b>Тема: ${ticket.title}</b>\nКомпания: ${ticket.company.alias}\nИнициатор: ${ticket.applicantId.lastName} ${ticket.applicantId.firstName}\n<b>Статус: ${ticket.state}</b>\n#ticket_${ticket.num}`,
                replyMarkup: ticketButton(ticket.num),
              });
              await newTicketNotification.save();

              responsible.isNotified.telegram = true;
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create process ticket notification to applicant's telegram",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        //-----------------------------------------------
        //-------------------- EMAIL --------------------
        //-----------------------------------------------

        // notifying responsibles
        try {
          for (let resp of ticket.responsibles) {
            const user = await User.findById(resp._id);
            if (
              notifyEmail(user, "respStateUpdate") &&
              !resp.isNotified?.email
            ) {
              const newTicketNotification = new Notification({
                instrument: "email",
                ticketId: ticket._id,
                to: {
                  email: user.email,
                  responsible: `${user.lastName} ${user.firstName}`,
                },
                title: `[F1-HD-${ticket.num}] Вы назначены ответственным(ой) за Заявку`,
                text: `
                                    <div>
                                        <h3>Вы назначены ответственным(ой) за Заявку ${ticket.num}.</h3>
                                        <ul>
                                            <li>Компания: ${ticket.company.alias}</li>
                                            <li>Инициатор: ${ticket.applicantId.lastName} ${ticket.applicantId.firstName}</li>
                                            <li>Тема: ${ticket.title}</li>
                                            <li>Описание: ${ticket.description}</li>
                                            <li>Статус: ${ticket.state}</li>
                                            <li>Ссылка: ${process.env.ADDRESS}/tickets/${ticket.num}</li>
                                        </ul>
                                    </div>
                                `,
              });
              await newTicketNotification.save();

              resp.isNotified.email = true;
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create process ticket notification to responsible's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        ticket.notifications.pending = false;
        await ticket.save();

        break;

      case "take ticket to work":
        //--------------------------------------------------
        //-------------------- TELEGRAM --------------------
        //--------------------------------------------------

        // notifying applicant
        try {
          if (notifyTg(applicant, "ticketStateUpdate")) {
            const newTicketNotification = new Notification({
              instrument: "telegram",
              ticketId: ticket._id,
              to: {
                chatId: applicant.telegramBot?.chatId,
                applicant: `${applicant.lastName} ${applicant.firstName}`,
              },
              text: `📌 <b>Заявка ${ticket.num} принята в работу</b>\nТема: ${ticket.title}\n#ticket_${ticket.num}`,
              replyMarkup: ticketButton(ticket.num),
            });
            await newTicketNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create take ticket to work notification to applicant's telegram",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        //-----------------------------------------------
        //-------------------- EMAIL --------------------
        //-----------------------------------------------

        // notifying applicant
        try {
          if (
            notifyEmail(applicant, "ticketStateUpdate") &&
            !ticket.applicantId.isServiceAccount
          ) {
            const newTicketNotification = new Notification({
              instrument: "email",
              ticketId: ticket._id,
              to: {
                email: ticket.applicantId.email,
                applicant: `${applicant.lastName} ${applicant.firstName}`,
              },
              title: `[F1-HD-${ticket.num}] Заявка ${ticket.num} принята в работу. ${ticket.title}`,
              text: `
                        <div>
                            <h3>Заявка №${ticket.num} принята в работу.</h3>
                            <p>${ticket.applicantId.firstName},</p>
                            <p>
                                Мы уже работаем над Вашей заявкой и постараемся,
                                чтобы всё прошло гладко и без задержек.
                            </p>
                            <p>
                                Если у Вас есть вопросы или дополнительная
                                информация, пожалуйста, позвоните нам по номеру
                                ${prefs.contacts.tel} или отправьте ответное
                                письмо(только не меняйте тему).
                            </p>
                            <p>Подробнее: ${process.env.ADDRESS}/tickets/${ticket.num}</p>
                            <p>
                                С уважением,<br></br>Команда F1Lab
                            </p>
                        </div>
                        `,
            });
            await newTicketNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create take ticket to work notification to applicant's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        ticket.notifications.pending = false;
        await ticket.save();

        break;

      case "request help":
        //--------------------------------------------------
        //-------------------- TELEGRAM --------------------
        //--------------------------------------------------

        // notifying responsibles
        try {
          for (let resp of ticket.responsibles) {
            const user = await User.findById(resp._id);
            if (
              notifyTg(user, "respStateUpdate") &&
              !resp.isNotified.telegram
            ) {
              const newTicketNotification = new Notification({
                instrument: "telegram",
                ticketId: ticket._id,
                to: {
                  chatId: user.telegramBot?.chatId,
                  responsible: `${user.lastName} ${user.firstName}`,
                },
                text: `🟢 <b>Вы добавлены в список ответственных заявки ${ticket.num}</b>\n<b>Тема: ${ticket.title}</b>\nКомпания: ${ticket.company.alias}\nИнициатор: ${ticket.applicantId.lastName} ${ticket.applicantId.firstName}\n<b>Статус: ${ticket.state}</b>\n#ticket_${ticket.num}`,
                replyMarkup: ticketButton(ticket.num),
              });
              await newTicketNotification.save();

              resp.isNotified.telegram = true;
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create request help notification to responsible's telegram",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        //-----------------------------------------------
        //-------------------- EMAIL --------------------
        //-----------------------------------------------

        // notifying responsibles
        try {
          for (let resp of ticket.responsibles) {
            const user = await User.findById(resp._id);
            if (
              notifyEmail(user, "respStateUpdate") &&
              !resp.isNotified?.email
            ) {
              const newTicketNotification = new Notification({
                instrument: "email",
                ticketId: ticket._id,
                to: {
                  email: user.email,
                  responsible: `${user.lastName} + ${user.firstName}`,
                },
                title: `[F1-HD-${ticket.num}] Вы назначены ответственным(ой) за Заявку`,
                text: `
                                <div>
                                    <h3>Вы назначены ответственным(ой) за Заявку ${ticket.num}.</h3>
                                    <ul>
                                        <li>Компания: ${ticket.company.alias}</li>
                                        <li>Инициатор: ${ticket.applicantId.lastName} ${ticket.applicantId.firstName}</li>
                                        <li>Тема: ${ticket.title}</li>
                                        <li>Описание: ${ticket.description}</li>
                                        <li>Статус: ${ticket.state}</li>
                                        <li>Ссылка: ${process.env.ADDRESS}/tickets/${ticket.num}</li>
                                    </ul>
                                </div>
                            `,
              });
              await newTicketNotification.save();

              resp.isNotified.email = true;
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create request help notification to responsible's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        ticket.notifications.pending = false;
        await ticket.save();

        break;

      case "reject ticket":
        //--------------------------------------------------
        //-------------------- TELEGRAM --------------------
        //--------------------------------------------------

        // notifying global if ticket is in state "New" again
        try {
          if (ticket.state === "Новая" && notifyTgGroup) {
            const newTicketNotification = new Notification({
              instrument: "telegram",
              ticketId: ticket._id,
              to: {
                chatId: prefs.notify.byTelegram.chatId,
                globalChat: true,
              },
              text: `‼️ <b>Заявка ${ticket.num} возвращена в статус "Новая"</b>\nТема: ${ticket.title}\nКомпания: ${ticket.company.alias}\nИнициатор: ${ticket.applicantId.lastName} ${ticket.applicantId.firstName}\n#ticket_${ticket.num}`,
              replyMarkup: ticketButton(ticket.num),
            });
            await newTicketNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create reject ticket notification to telegram group",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        // notifying responsibles
        try {
          const userRejected = await User.findById(
            ticket.rejected[ticket.rejected.length - 1].by,
          );
          for (let resp of ticket.responsibles) {
            const user = await User.findById(resp._id);

            if (notifyTg(user, "respStateUpdate")) {
              const newTicketNotification = new Notification({
                instrument: "telegram",
                ticketId: ticket._id,
                to: {
                  chatId: user.telegramBot?.chatId,
                  responsible: `${user.lastName} ${user.firstName}`,
                },
                text: `🟠 <b>${userRejected.firstName} ${
                  userRejected.lastName
                } убрал(а) себя из списка ответственных заявки ${
                  ticket.num
                }</b>\n<b>Причина: ${
                  ticket.rejected[ticket.rejected.length - 1].reason
                }</b>\n<b>Тема: ${ticket.title}</b>\nКомпания: ${
                  ticket.company.alias
                }\nИнициатор: ${ticket.applicantId.lastName} ${
                  ticket.applicantId.firstName
                }\n<b>Статус: ${ticket.state}</b>\n#ticket_${ticket.num}`,
                replyMarkup: ticketButton(ticket.num),
              });
              await newTicketNotification.save();
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create reject ticket notification to responsible's telegram",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        //-----------------------------------------------
        //-------------------- EMAIL --------------------
        //-----------------------------------------------

        try {
          // notifying managers
          const managers = await User.find({
            "permissions.canAdministrateTickets": true,
            isActive: true,
          });

          for (let user of managers) {
            const rejectedUser = await User.findById(
              ticket.rejected[ticket.rejected.length - 1].by,
            );
            if (notifyEmail(user, "respStateUpdate")) {
              const newTicketNotification = new Notification({
                instrument: "email",
                ticketId: ticket._id,
                to: {
                  email: user.email,
                  manager: `${user.lastName} ${user.firstName}`,
                },
                title: `[F1-HD-${ticket.num}] Пользователь отказался от выполнения Заявки ${ticket.num}`,
                text: `
                                <div>
                                    <h3>Пользователь отказался от выполнения Заявки ${
                                      ticket.num
                                    }.</h3>
                                    <ul>
                                        <li>Имя: ${rejectedUser.lastName} ${
                                          rejectedUser.firstName
                                        }</li>
                                        <li>Причина: ${
                                          ticket.rejected[
                                            ticket.rejected.length - 1
                                          ].reason
                                        }</li>
                                        <li>Компания: ${
                                          ticket.company.alias
                                        }</li>
                                        <li>Инициатор: ${
                                          ticket.applicantId.lastName
                                        } ${ticket.applicantId.firstName}</li>
                                        <li>Тема: ${ticket.title}</li>
                                        <li>Описание: ${ticket.description}</li>
                                        <li>Статус: ${ticket.state}</li>
                                        <li>Ссылка: ${
                                          process.env.ADDRESS
                                        }/tickets/${ticket.num}</li>
                                    </ul>
                                </div>
                            `,
              });
              await newTicketNotification.save();
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create reject ticket notification to manager's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        // notifying responsibles
        try {
          for (let resp of ticket.responsibles) {
            const rejectedUser = await User.findById(
              ticket.rejected[ticket.rejected.length - 1].by,
            );

            const user = await User.findById(resp._id);

            if (notifyEmail(user, "respStateUpdate")) {
              const newTicketNotification = new Notification({
                instrument: "email",
                ticketId: ticket._id,
                to: {
                  email: user.email,
                  manager: `${user.lastName} ${user.firstName}`,
                },
                title: `[F1-HD-${ticket.num}] Пользователь отказался от выполнения Заявки ${ticket.num}`,
                text: `
                                <div>
                                    <h3>Пользователь отказался от выполнения Заявки ${
                                      ticket.num
                                    }.</h3>
                                    <ul>
                                        <li>Имя: ${rejectedUser.lastName} ${
                                          rejectedUser.firstName
                                        }</li>
                                        <li>Причина: ${
                                          ticket.rejected[
                                            ticket.rejected.length - 1
                                          ].reason
                                        }</li>
                                        <li>Компания: ${
                                          ticket.company.alias
                                        }</li>
                                        <li>Инициатор: ${
                                          ticket.applicantId.lastName
                                        } ${ticket.applicantId.firstName}</li>
                                        <li>Тема: ${ticket.title}</li>
                                        <li>Описание: ${ticket.description}</li>
                                        <li>Статус: ${ticket.state}</li>
                                        <li>Ссылка: ${
                                          process.env.ADDRESS
                                        }/tickets/${ticket.num}</li>
                                    </ul>
                                </div>
                            `,
              });
              await newTicketNotification.save();
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create reject ticket notification to responsible's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        ticket.notifications.pending = false;
        await ticket.save();

        break;

      case "close ticket":
        //--------------------------------------------------
        //-------------------- TELEGRAM --------------------
        //--------------------------------------------------

        // notifying global
        try {
          if (notifyTgGroup) {
            const newTicketNotification = new Notification({
              instrument: "telegram",
              ticketId: ticket._id,
              to: {
                chatId: prefs.notify.byTelegram?.chatId,
                globalChat: true,
              },
              text: `✅ <b>Закрыта заявка ${ticket.num}</b>\nТема: ${ticket.title}\nКомпания: ${ticket.company.alias}\nИнициатор: ${ticket.applicantId.lastName} ${ticket.applicantId.firstName}\n<b>Комментарий: ${ticket.closingComment}</b>\n#ticket_${ticket.num}`,
              replyMarkup: ticketButton(ticket.num),
            });
            await newTicketNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to close ticket notification to telegram group",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        // notifying applicant
        try {
          if (notifyTg(applicant, "ticketStateUpdate")) {
            const newTicketNotification = new Notification({
              instrument: "telegram",
              ticketId: ticket._id,
              to: {
                chatId: applicant.telegramBot.chatId,
                applicant: `${applicant.lastName} ${applicant.firstName}`,
              },
              text: `✅ <b>Закрыта заявка ${ticket.num}</b>\nТема: ${ticket.title}\nКомпания: ${ticket.company.alias}\nИнициатор: ${ticket.applicantId.lastName} ${ticket.applicantId.firstName}\n<b>Комментарий: ${ticket.closingComment}</b>\n#ticket_${ticket.num}`,
              replyMarkup: ticketButton(ticket.num),
            });
            await newTicketNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to close ticket notification to applicant's telegram",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        // notifying responsibles
        try {
          for (let responsible of ticket.responsibles) {
            const user = await User.findById(responsible._id);

            if (notifyTg(user, "ticketStateUpdate")) {
              const newTicketNotification = new Notification({
                instrument: "telegram",
                ticketId: ticket._id,
                to: {
                  chatId: user.telegramBot?.chatId,
                  responsible: `${user.lastName} ${user.firstName}`,
                },
                text: `✅ <b>Закрыта заявка ${ticket.num}</b>\nТема: ${ticket.title}\nКомпания: ${ticket.company.alias}\nИнициатор: ${ticket.applicantId.lastName} ${ticket.applicantId.firstName}\n<b>Комментарий: ${ticket.closingComment}</b>\n#ticket_${ticket.num}`,
                replyMarkup: ticketButton(ticket.num),
              });
              await newTicketNotification.save();
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to close ticket notification to responsible's telegram",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        //-----------------------------------------------
        //-------------------- EMAIL --------------------
        //-----------------------------------------------

        // notifying applicant
        try {
          if (
            notifyEmail(applicant, "ticketStateUpdate") &&
            !ticket.applicantId.isServiceAccount
          ) {
            const newTicketNotification = new Notification({
              instrument: "email",
              ticketId: ticket._id,
              to: {
                email: ticket.applicantId.email,
                applicant: `${applicant.lastName} ${applicant.firstName}`,
              },
              title: `[F1-HD-${ticket.num}] Заявка ${ticket.num} выполнена. ${ticket.title}`,
              text: `
                        <div>
                            <h3>Заявка №${ticket.num} выполнена.</h3>
                            <p>${ticket.applicantId.firstName},</p>
                            <p>
                                Мы закончили работы по Заявке №${ticket.num}, тема: ${ticket.title}.
                            </p>
                            <p>Комментарий: ${ticket.closingComment}</p>
                            <p>
                                Если у Вас есть вопросы или дополнительная
                                информация, пожалуйста, позвоните нам по номеру
                                ${prefs.contacts.tel} или отправьте ответное
                                письмо(только не меняйте тему).
                            </p>
                            <p>Подробнее: ${process.env.ADDRESS}/tickets/${ticket.num}</p>
                            <p>
                                С уважением,<br></br>Команда F1Lab
                            </p>
                        </div>
                    `,
            });
            await newTicketNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create close ticket notification to applicant's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        // notifying responsibles
        try {
          for (let resp of ticket.responsibles) {
            const user = await User.findById(resp._id);
            if (notifyEmail(user, "ticketStateUpdate")) {
              const newTicketNotification = new Notification({
                instrument: "email",
                ticketId: ticket._id,
                to: {
                  email: user.email,
                  responsible: `${user.lastName} ${user.firstName}`,
                },
                title: `[F1-HD-${ticket.num}] Заявка ${ticket.num} выполнена. ${ticket.title}`,
                text: `
                            <div>
                                <h3>Заявка №${ticket.num} выполнена.</h3>
                                <p>${user.firstName},</p>
                                <p>
                                    Закончены работы по Заявке №${ticket.num}, тема: ${ticket.title}.
                                </p>
                                <p>Комментарий: ${ticket.closingComment}</p>
                                <p>Подробнее: ${process.env.ADDRESS}/tickets/${ticket.num}</p>
                            </div>
                        `,
              });
              await newTicketNotification.save();
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create close ticket notification to responsible's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        ticket.notifications.pending = false;
        await ticket.save();

        break;

      case "back to work":
        //--------------------------------------------------
        //-------------------- TELEGRAM --------------------
        //--------------------------------------------------

        // notifying global
        try {
          if (notifyTgGroup) {
            const newTicketNotification = new Notification({
              instrument: "telegram",
              ticketId: ticket._id,
              to: {
                chatId: prefs.notify.byTelegram?.chatId,
                globalChat: true,
              },
              text: `‼️ <b>Заявка ${ticket.num} возвращена в статус "В работе"</b>\nТема: ${ticket.title}\nКомпания: ${ticket.company.alias}\nИнициатор: ${ticket.applicantId.lastName} ${ticket.applicantId.firstName}\n<b>Комментарий: ${ticket.returningComment}</b>\n#ticket_${ticket.num}`,
              replyMarkup: ticketButton(ticket.num),
            });
            await newTicketNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create back ticket to work notification to global telegram group",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        // notifying responsibles
        try {
          for (let responsible of ticket.responsibles) {
            const user = await User.findById(responsible._id);

            if (notifyTg(user, "ticketStateUpdate")) {
              const newTicketNotification = new Notification({
                instrument: "telegram",
                ticketId: ticket._id,
                to: {
                  chatId: user.telegramBot?.chatId,
                  responsible: `${user.lastName} ${user.firstName}`,
                },
                text: `‼️ <b>Заявка ${ticket.num} возвращена в статус "В работе"</b>\nТема: ${ticket.title}\nКомпания: ${ticket.company.alias}\nИнициатор: ${ticket.applicantId.lastName} ${ticket.applicantId.firstName}\n<b>Комментарий: ${ticket.returningComment}</b>\n#ticket_${ticket.num}`,
                replyMarkup: ticketButton(ticket.num),
              });
              await newTicketNotification.save();
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create back ticket to work notification to responsible's telegram",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        // notifying applicant
        try {
          if (notifyTg(applicant, "ticketStateUpdate")) {
            const newTicketNotification = new Notification({
              instrument: "telegram",
              ticketId: ticket._id,
              to: {
                chatId: applicant.telegramBot?.chatId,
                applicant: `${applicant.lastName} ${applicant.firstName}`,
              },
              text: `‼️ <b>Заявка ${ticket.num} возвращена в статус "В работе"</b>\nТема: ${ticket.title}\nКомпания: ${ticket.company.alias}\nИнициатор: ${ticket.applicantId.lastName} ${ticket.applicantId.firstName}\n<b>Комментарий: ${ticket.returningComment}</b>\n#ticket_${ticket.num}`,
              replyMarkup: ticketButton(ticket.num),
            });
            await newTicketNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create back ticket to work notification to applicant's telegram",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        //-----------------------------------------------
        //-------------------- EMAIL --------------------
        //-----------------------------------------------

        // notifying applicant
        try {
          if (
            notifyEmail(applicant, "ticketStateUpdate") &&
            !ticket.applicantId.isServiceAccount
          ) {
            const newTicketNotification = new Notification({
              instrument: "email",
              ticketId: ticket._id,
              to: {
                email: ticket.applicantId.email,
                applicant: `${applicant.lastName} ${applicant.firstName}`,
              },
              title: `[F1-HD-${ticket.num}] Заявка ${ticket.num} возвращена в работу`,
              text: `
                        <div>
                            <h3>Заявка №${ticket.num} возвращена в работу.</h3>
                            <p>${ticket.applicantId.firstName},</p>
                            <p>
                                Заявка №${ticket.num} возвращена в работу, тема: ${ticket.title}.
                            </p>
                            <p>Комментарий: ${ticket.returningComment}</p>
                            <p>
                                Если у Вас есть вопросы или дополнительная
                                информация, пожалуйста, позвоните нам по номеру
                                ${prefs.contacts.tel} или отправьте ответное
                                письмо(только не меняйте тему).
                            </p>
                            <p>Подробнее: ${process.env.ADDRESS}/tickets/${ticket.num}</p>
                            <p>
                                С уважением,<br></br>Команда F1Lab
                            </p>
                        </div>
                        `,
            });
            await newTicketNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create back ticket to work notification to applicant's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        // notifying responsibles
        try {
          for (let resp of ticket.responsibles) {
            const user = await User.findById(resp._id);
            if (notifyEmail(user, "ticketStateUpdate")) {
              const newTicketNotification = new Notification({
                instrument: "email",
                ticketId: ticket._id,
                to: {
                  email: user.email,
                  responsible: `${user.lastName} ${user.firstName}`,
                },
                title: `[F1-HD-${ticket.num}] Заявка ${ticket.num} выполнена. ${ticket.title}`,
                text: `
                            <div>
                                <h3>Заявка №${ticket.num} выполнена.</h3>
                                <p>${user.firstName},</p>
                                <p>
                                Заявка №${ticket.num} возвращена в работу, тема: ${ticket.title}.
                            </p>
                            <p>Комментарий: ${ticket.returningComment}</p>
                                <p>Подробнее: ${process.env.ADDRESS}/tickets/${ticket.num}</p>
                            </div>
                        `,
              });
              await newTicketNotification.save();
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create back ticket to work notification to responsible's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        ticket.notifications.pending = false;
        await ticket.save();

        break;

      default:
        // Снимаем pending даже для lastAction без ветки уведомлений,
        // чтобы заявки не копились в очереди бесконечно.
        logger.log("warn", "Ticket notification: unhandled lastAction", {
          ticketNum: ticket.num,
          lastAction,
        });
        ticket.notifications.pending = false;
        await ticket.save();
        break;
    }
  }
};

exports.createCommentNotifications = async () => {
  const prefs = await withMongoRetry(
    () => Preferences.findOne({}),
    "loading preferences for comment notifications",
  );
  if (!notificationsEnabled(prefs)) {
    logger.log(
      "debug",
      "Skipping comment notifications because notifications are disabled",
    );
    return;
  }

  const comments = await withMongoRetry(
    () =>
      Comment.find({
        "notifications.pending": true,
      })
        .sort({ updatedAt: 1 })
        .limit(NOTIFICATION_BATCH_SIZE)
        .populate("createdBy"),
    "loading pending comment notifications",
  );

  const notifyTg = (user, state) =>
    prefs.notify?.byTelegram?.isActive &&
    user?.telegramBot?.isActive &&
    user?.notify?.byTelegram?.[state] &&
    prefs.notify?.personal?.[state];

  const notifyTgGroup =
    prefs.notify?.byTelegram?.sendToGroup &&
    prefs.notify?.byTelegram?.isActive;

  const notifyEmail = (user, state) =>
    // В dev почтовые уведомления подавляем, чтобы не слать письма реальным
    // пользователям; telegram при этом работает (тест-бот безопасен).
    process.env.NODE_ENV !== "development" &&
    prefs.notify?.byEmail?.isActive &&
    user?.notify?.byEmail?.[state] &&
    prefs.notify?.personal?.[state];

  for (let comment of comments) {
    const lastAction = comment.notifications.lastAction;
    const authorId = String(comment.createdBy?._id || comment.createdBy);
    const ticket = await Ticket.findById(comment.ticketId);
    if (!ticket) {
      comment.notifications.pending = false;
      await comment.save();
      return;
    }

    const applicant = await User.findById(ticket.applicantId);

    switch (lastAction) {
      case "new comment":
        //--------------------------------------------------
        //-------------------- TELEGRAM --------------------
        //--------------------------------------------------

        // notifying applicant
        try {
          if (
            String(applicant?._id) !== authorId &&
            notifyTg(applicant, "ticketNewComment")
          ) {
            const newCommentNotification = new Notification({
              instrument: "telegram",
              commentId: comment._id,
              ticketId: ticket._id,
              to: {
                chatId: applicant.telegramBot?.chatId,
                applicant: `${applicant.lastName} ${applicant.firstName}`,
              },
              text: `💬 <b>Комментарий к заявке ${ticket.num}</b>\n<b>${comment.createdBy.lastName} ${comment.createdBy.firstName}:</b>\n<b>${comment.content}</b>\nКомпания: ${ticket.company.alias}\nТема заявки: ${ticket.title}\n#ticket_${ticket.num}`,
              replyMarkup: ticketButton(ticket.num),
            });
            await newCommentNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create new ticket comment notification to applicant's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        // notifying global
        try {
          if (notifyTgGroup) {
            const newCommentNotification = new Notification({
              instrument: "telegram",
              commentId: comment._id,
              ticketId: ticket._id,
              to: {
                chatId: prefs.notify.byTelegram.chatId,
                globalChat: true,
              },
              text: `💬 <b>Комментарий к заявке ${ticket.num}</b>\n<b>${comment.createdBy.lastName} ${comment.createdBy.firstName}:</b>\n<b>${comment.content}</b>\nКомпания: ${ticket.company.alias}\nТема заявки: ${ticket.title}\n#ticket_${ticket.num}`,
              replyMarkup: ticketButton(ticket.num),
            });
            await newCommentNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create new ticket comment notification to global telegram group",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        // notifying responsibles
        try {
          for (let responsible of ticket.responsibles) {
            const user = await User.findById(responsible._id);

            if (
              String(user?._id) !== authorId &&
              notifyTg(user, "ticketNewComment")
            ) {
              const newTicketNotification = new Notification({
                instrument: "telegram",
                ticketId: ticket._id,
                to: {
                  chatId: user.telegramBot.chatId,
                  responsible: `${user.lastName} ${user.firstName}`,
                },
                text: `💬 <b>Комментарий к заявке ${ticket.num}</b>\n<b>${comment.createdBy.lastName} ${comment.createdBy.firstName}:</b>\n<b>${comment.content}</b>\nКомпания: ${ticket.company.alias}\nТема заявки: ${ticket.title}\n#ticket_${ticket.num}`,
                replyMarkup: ticketButton(ticket.num),
              });
              await newTicketNotification.save();
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create new ticket comment notification to responsible's telegram",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        //-----------------------------------------------
        //-------------------- EMAIL --------------------
        //-----------------------------------------------

        // notifying applicant
        try {
          if (
            String(applicant?._id) !== authorId &&
            notifyEmail(applicant, "ticketNewComment")
          ) {
            const newCommentNotification = new Notification({
              instrument: "email",
              source: "comment",
              commentId: comment._id,
              ticketId: ticket._id,
              to: {
                email: applicant.email,
                applicant: `${applicant.lastName} ${applicant.firstName}`,
              },
              title: `[F1-HD-${ticket.num}] Новый комментарий к Заявке ${ticket.num}`,
              text: `<div>
                <h3>Новый комментарий.</h3>
                <p>
                К Заявке №${ticket.num}, ${ticket.title}, добавлен новый комментарий: ${comment.content}
                </p>
                <p>Подробнее: ${process.env.ADDRESS}/tickets/${ticket.num}</p>
                <p>
                    С уважением,<br></br>Команда F1Lab
                </p>
                </div>`,
            });
            await newCommentNotification.save();
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create new ticket comment notification to applicant's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        // notifying responsibles
        try {
          for (let resp of ticket.responsibles) {
            const user = await User.findById(resp._id);
            if (
              String(user?._id) !== authorId &&
              notifyEmail(user, "ticketNewComment")
            ) {
              const newCommentNotification = new Notification({
                instrument: "email",
                commentId: comment._id,
                ticketId: ticket._id,
                to: {
                  email: user.email,
                  responsible: `${user.lastName} ${user.firstName}`,
                },
                title: `[F1-HD-${ticket.num}] Новый комментарий к Заявке ${ticket.num}`,
                text: `<div>
                                <h3>Новый комментарий.</h3>
                                <p>
                                К Заявке №${ticket.num}, ${ticket.title}, добавлен новый комментарий: ${comment.content}
                                </p>
                                <p>Подробнее: ${process.env.ADDRESS}/tickets/${ticket.num}</p>
                                <p>
                                    С уважением,<br></br>Команда F1Lab
                                </p>
                                </div>`,
              });
              await newCommentNotification.save();
            }
          }
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create new ticket comment notification to responsible's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }

        comment.notifications.pending = false;
        await comment.save();

        break;
    }
  }
};

exports.createUserNotifications = async () => {
  const prefs = await withMongoRetry(
    () => Preferences.findOne({}),
    "loading preferences for user notifications",
  );

  if (!prefs?.notify?.byEmail?.isActive) {
    logger.log(
      "debug",
      "Skipping user notifications because email notifications are disabled",
    );
    return;
  }

  const users = await withMongoRetry(
    () =>
      User.find({
        "notifications.pending": true,
      })
        .sort({ updatedAt: 1 })
        .limit(NOTIFICATION_BATCH_SIZE),
    "loading pending user notifications",
  );

  for (let user of users) {
    try {
      const lastAction = user.notifications.lastAction;

      const decodedPassword = jwt.decode(
        user.notifications.password,
        process.env.JWT_SECRET,
      );

      switch (lastAction) {
        case "new user":
          //-----------------------------------------------
          //-------------------- EMAIL --------------------
          //-----------------------------------------------

          // notifying user
          try {
            const newUserNotification = new Notification({
              instrument: "email",
              to: {
                email: user.email,
              },
              title: `Создана учётная запись F1Lab Helpdesk`,
              text: `
                        <div>
                            <p>${user.firstName},</p>
                            <p>Мы создали для Вас учётную запись на портале F1Lab Helpdesk.</p>
                            <p>
                                Адрес: ${process.env.ADDRESS}/ <br>
                                Логин: ${user.email}<br>
                                Пароль: ${decodedPassword}
                            </p>
                            <p>Вы получили это письмо, т.к. являетесь сотрудником ${user.company.alias} или другой организации связанной с ${user.company.alias}.</p>
                            <p>
                                С уважением,<br></br>Команда F1Lab
                            </p>
                        </div>
                    `,
            });
            await newUserNotification.save();
            user.notifications.pending = false;
            user.notifications.password = "";

            await user.save();
            break;
          } catch (error) {
            logger.log(
              "notification",
              "Failed to create new user notification to user's email",
              {
                error: error.message,
                stack: error.stack,
              },
            );
          }
          break;

        case "verify account":
          //-----------------------------------------------
          //-------------------- EMAIL --------------------
          //-----------------------------------------------

          // notifying user
          try {
            const newUserNotification = new Notification({
              instrument: "email",
              to: {
                email: user.email,
              },
              title: `Создана учётная запись F1Lab Helpdesk`,
              text: `
                          <div>
                              <p>${user.firstName},</p>
                              <p>Вы создали учётную запись на портале F1Lab Helpdesk.</p>
                              <p>Для её активации пройдите по ссылке: ${process.env.ADDRESS}/verify/${lastAction.verifyToken}</p>
                              <p>Вы получили это письмо, т.к. являетесь сотрудником ${user.company.alias} или другой организации связанной с ${user.company.alias}.</p>
                              <p>
                                  С уважением,<br></br>Команда F1Lab
                              </p>
                          </div>
                      `,
            });
            await newUserNotification.save();
            user.notifications.pending = false;
            user.notifications.password = "";

            await user.save();
            break;
          } catch (error) {
            logger.log(
              "notification",
              "Failed to create email notification to verify user's account",
              {
                error: error.message,
                stack: error.stack,
              },
            );
          }
          break;

        case "change password":
          //-----------------------------------------------
          //-------------------- EMAIL --------------------
          //-----------------------------------------------

          // notifying user
          try {
            const changePasswordNotification = new Notification({
              instrument: "email",
              to: {
                email: user.email,
              },
              title: `Изменён пароль F1Lab Helpdesk`,
              text: `
                        <div>
                        <p>${user.firstName},</p>
                        <p>Пароль Вашей учётной записи на портале F1Lab Helpdesk был изменён.</p>
                        <p>
                            Адрес: ${process.env.ADDRESS}/ <br>
                            Логин: ${user.email}<br>
                            Новый пароль: ${decodedPassword}
                        </p>
                        <p>Вы получили это письмо, т.к. являетесь сотрудником ${user.company.alias} или другой организации связанной с ${user.company.alias}.</p>
                        <p>
                            С уважением,<br></br>Команда F1Lab
                        </p>
                    </div>
                    `,
            });
            await changePasswordNotification.save();
            user.notifications.pending = false;
            user.notifications.password = "";
            await user.save();
            break;
          } catch (error) {
            logger.log(
              "notification",
              "Failed to create email notification for user's password update",
              {
                error: error.message,
                stack: error.stack,
              },
            );
          }
          break;

        case "forgot-password":
          try {
            const resetUrl = `${process.env.ADDRESS}/reset-password/${user.notifications.resetToken}`;
            const resetPasswordNotification = new Notification({
              instrument: "email",
              to: {
                email: user.email,
              },
              title: `Восстановление доступу к порталу F1Lab Helpdesk`,
              text: `
                        <div>
                        <p>${user.firstName},</p>
                        <p>Сбросить пароль можно пройдя по <a href=${resetUrl} target=_blank>ссылке</a>.</p>
                        <p>Ссылка действительна 24 часа</p>
                        <p>С уважением,<br></br>Команда F1Lab</p>
                    </div>
                    `,
            });
            await resetPasswordNotification.save();
            user.notifications.pending = false;
            user.notifications.resetToken = "";
            await user.save();
            break;
          } catch (error) {
            logger.log(
              "notification",
              "Failed to create email notification to reset user's password",
              {
                error: error.message,
                stack: error.stack,
              },
            );
          }
      }
    } catch (error) {
      logger.log("notification", "Failed to process user notification", {
        userId: user._id,
        userEmail: user.email,
        lastAction: user.notifications?.lastAction,
        error: error.message,
        stack: error.stack,
      });
    }
  }
};

exports.createScheduledWorkNotifications = async () => {
  const prefs = await withMongoRetry(
    () => Preferences.findOne({}),
    "loading preferences for scheduled work notifications",
  );
  if (!notificationsEnabled(prefs)) {
    logger.log(
      "debug",
      "Skipping scheduled work notifications because notifications are disabled",
    );
    return;
  }

  const formatDateTime = (date) => {
    const timezone = prefs.timezone;
    return new Date(date).toLocaleDateString("ru", {
      timeZone: timezone || "Asia/Vladivostok",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const msToHMS = (ms) => {
    // 1- Convert to seconds:
    let seconds = ms / 1000;
    // 2- Extract hours:
    const hours = parseInt(seconds / 3600); // 3,600 seconds in 1 hour
    seconds = seconds % 3600; // seconds remaining after extracting hours
    // 3- Extract minutes:
    const minutes = parseInt(seconds / 60); // 60 seconds in 1 minute
    // 4- Keep only seconds not extracted to minutes:
    seconds = seconds % 60;

    const humanized =
      [pad(2, hours.toString(), "0"), pad(2, minutes.toString(), "0")].join(
        ":",
      ) + " ч.";

    return humanized;
  };

  const works = await withMongoRetry(
    () =>
      Work.find({
        $and: [
          { scheduled: true },
          { finishedAt: null },
          { "notifications.pending": true },
        ],
      })
        .sort({ updatedAt: 1 })
        .limit(NOTIFICATION_BATCH_SIZE),
    "loading pending scheduled work notifications",
  );

  const notifyTg = (user, state) =>
    prefs.notify?.byTelegram?.isActive &&
    user?.telegramBot?.isActive &&
    user?.notify?.byTelegram?.[state] &&
    prefs.notify?.personal?.[state];

  const notifyTgGroup =
    prefs.notify?.byTelegram?.sendToGroup &&
    prefs.notify?.byTelegram?.isActive;

  const notifyEmail = (user, state) =>
    // В dev почтовые уведомления подавляем, чтобы не слать письма реальным
    // пользователям; telegram при этом работает (тест-бот безопасен).
    process.env.NODE_ENV !== "development" &&
    prefs.notify?.byEmail?.isActive &&
    user?.notify?.byEmail?.[state] &&
    prefs.notify?.personal?.[state];

  for (let work of works) {
    const lastAction = work.notifications.lastAction;
    let applicants = [];
    let responsibles = [];
    let tickets = [];
    let company = "";
    for (let ticketId of work.tickets) {
      const ticket = await Ticket.findById(ticketId);
      if (ticket) {
        applicants.push(ticket.applicantId);
        for (let resp of ticket.responsibles) {
          if (!responsibles.includes(resp)) {
            responsibles.push(resp);
          }
        }
        tickets.push(ticket.num);
        company = ticket.company.alias;
      }
    }

    // получаем список получателей telegram-уведомлений и исключаем дублирующиеся
    let tgRecipients = [];

    if (notifyTgGroup) {
      tgRecipients.push(prefs.notify.byTelegram.chatId);
    }

    for (let userId of applicants) {
      const applicant = await User.findById(userId);
      if (
        notifyTg(applicant, "scheduledWorks") &&
        !tgRecipients.includes(applicant.telegramBot.chatId)
      ) {
        tgRecipients.push(applicant.telegramBot.chatId);
      }
    }

    for (let user of responsibles) {
      const responsible = await User.findById(user._id);
      if (
        notifyTg(responsible, "scheduledWorks") &&
        !tgRecipients.includes(responsible.telegramBot.chatId)
      ) {
        tgRecipients.push(responsible.telegramBot.chatId);
      }
    }

    // получаем список получателей email-уведомлений и исключаем дублирующиеся
    let emailRecipients = [];

    for (let user of applicants) {
      const applicant = await User.findById(user._id);
      if (
        notifyEmail(applicant, "scheduledWorks") &&
        !emailRecipients.includes(applicant.email)
      ) {
        emailRecipients.push(applicant.email);
      }
    }

    for (let user of responsibles) {
      const responsible = await User.findById(user._id);
      if (
        notifyEmail(responsible, "scheduledWorks") &&
        !emailRecipients.includes(responsible.email)
      ) {
        emailRecipients.push(responsible.email);
      }
    }

    if (lastAction === "new scheduled work") {
      //--------------------------------------------------
      //-------------------- TELEGRAM --------------------
      //--------------------------------------------------

      for (let recepient of tgRecipients) {
        try {
          const scheduledWorksNotification = new Notification({
            instrument: "telegram",
            workId: work._id,
            to: {
              chatId: recepient,
            },
            text: `<b>Запланированы работы по ${
              tickets.length === 1 ? "заявке" : "заявкам"
            } ${tickets.map(
              (ticket) =>
                ticket + (tickets[tickets.length - 1] === ticket ? "" : ", "),
            )}</b>\nКомпания: ${company}\nСпециалист: ${
              work.executor.lastName
            } ${work.executor.firstName}\nТип: ${
              work.visitRequired ? "выезд" : "удалённые работы"
            }\nНачало: ${formatDateTime(
              work.planningToStart,
            )}\nОжидаемая длительность: ${msToHMS(
              work.planningToFinish - work.planningToStart,
            )}\n${tickets.map(
              (ticket) =>
                `#ticket_${ticket}` +
                (tickets[tickets.length - 1] === ticket ? "" : " "),
            )}`,
          });
          await scheduledWorksNotification.save();
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create new scheduled work notification to recipient's telegram",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }
      }

      //--------------------------------------------------
      //-------------------- EMAIL --------------------
      //--------------------------------------------------
      for (let recepient of emailRecipients) {
        try {
          const newWorkNotification = new Notification({
            instrument: "email",
            workId: work._id,
            to: {
              email: recepient,
            },
            title: `Запланированы работы по ${
              tickets.length === 1 ? "заявке" : "заявкам"
            } ${tickets.map(
              (ticket) =>
                ticket + (tickets[tickets.length - 1] === ticket ? "" : ", "),
            )}`,
            text: `<div>
                            <h3>Запланированы работы.</h3>
                            <p>Мы запланировали работы по ${
                              tickets.length === 1 ? "заявке" : "заявкам"
                            } ${tickets.map(
                              (ticket) =>
                                `<a href=${
                                  process.env.ADDRESS
                                }/tickets/${ticket}>${ticket}<a> ${
                                  tickets[tickets.length - 1] === ticket
                                    ? "."
                                    : ", "
                                }`,
                            )}
                            </p>
                            <p>
                            <ul>
                              <li>Компания: <b>${company}</b></li>
                              <li>Специалист: <b>${work.executor.lastName} ${
                                work.executor.firstName
                              }</b></li>
                              <li>Тип: <b>${
                                work.visitRequired
                                  ? "выезд"
                                  : "удалённые работы"
                              }</b></li>
                              <li>Начало: <b>${formatDateTime(
                                work.planningToStart,
                              )}</b></li>
                              <li>Ожидаемая длительность: <b>${msToHMS(
                                work.planningToFinish - work.planningToStart,
                              )}</b></li>
                            </ul>
                            </p>
                            <p>С уважением,<br>Команда F1Lab</p>
                            </div>`,
          });
          await newWorkNotification.save();
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create new scheduled work notification to recipient's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }
      }
    }

    if (lastAction === "scheduled work updated") {
      //--------------------------------------------------
      //-------------------- TELEGRAM --------------------
      //--------------------------------------------------
      for (let recepient of tgRecipients) {
        try {
          const scheduledWorksNotification = new Notification({
            instrument: "telegram",
            workId: work._id,
            to: {
              chatId: recepient,
            },
            text: `<b>Обновлены данные запланированных работ по ${
              tickets.length === 1 ? "заявке" : "заявкам"
            } ${tickets.map(
              (ticket) =>
                ticket + (tickets[tickets.length - 1] === ticket ? "" : ", "),
            )}</b>\nКомпания: ${company}\nСпециалист: <b>${
              work.executor.lastName
            } ${work.executor.firstName}</b>\nТип: <b>${
              work.visitRequired ? "выезд" : "удалённые"
            }</b>\nНачало: <b>${formatDateTime(
              work.planningToStart,
            )}</b>\nОжидаемая длительность: <b>${msToHMS(
              work.planningToFinish - work.planningToStart,
            )}</b>\n${tickets.map(
              (ticket) =>
                `#ticket_${ticket}` +
                (tickets[tickets.length - 1] === ticket ? "" : " "),
            )}`,
          });
          await scheduledWorksNotification.save();
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create updated scheduled work notification to recipient's telegram",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }
      }

      //--------------------------------------------------
      //-------------------- EMAIL --------------------
      //--------------------------------------------------
      for (let recepient of emailRecipients) {
        try {
          const newWorkNotification = new Notification({
            instrument: "email",
            workId: work._id,
            to: {
              email: recepient,
            },
            title: `Обновлены данные запланированных работ по ${
              tickets.length === 1 ? "заявке" : "заявкам"
            } ${tickets.map(
              (ticket) =>
                ticket + (tickets[tickets.length - 1] === ticket ? "" : ", "),
            )}`,
            text: `<div>
                            <h3>Обновлены данные запланированных работ.</h3>
                            <p>
                            Мы обновили данные запланированных работ по ${
                              tickets.length === 1 ? "заявке" : "заявкам"
                            } ${tickets.map(
                              (ticket) =>
                                `<a href=${process.env.ADDRESS}/tickets/${ticket}>${ticket}<a> ${
                                  tickets[tickets.length - 1] === ticket
                                    ? "."
                                    : ", "
                                }`,
                            )}
          </p>
          <p>
              <ul>
                <li>Компания: <b>${company}</b></li>
                <li>Специалист: <b>${work.executor.lastName} ${
                  work.executor.firstName
                }</b></li>
                <li>Тип: <b>${
                  work.visitRequired ? "выезд" : "удалённые работы"
                }</b></li>
                <li>Начало: <b>${formatDateTime(work.planningToStart)}</b></li>
                <li>Ожидаемая длительность: <b>${msToHMS(
                  work.planningToFinish - work.planningToStart,
                )}</b></li>
              </ul>
              </p>
              <p>С уважением,<br>Команда F1Lab</p>
            </div>`,
          });
          await newWorkNotification.save();
        } catch (error) {
          logger.log(
            "notification",
            "Failed to create updated scheduled work notification to recipient's email",
            {
              error: error.message,
              stack: error.stack,
            },
          );
        }
      }
    }

    work.notifications.pending = false;
    await work.save();
  }
};
