const fs = require("fs");
const crypto = require("crypto");

const { Ticket } = require("../models/ticket");

const TelegramBot = require("node-telegram-bot-api");
const Preferences = require("../models/preferences");
const User = require("../models/user");
const {
  detectTicketCategory,
} = require("../services/ticketCategoryService");

const logger = require("../utils/logger");

const TOKEN = process.env.TG_TOKEN;

function sleep(milliseconds) {
  const date = Date.now();
  let currentDate = null;
  do {
    currentDate = Date.now();
  } while (currentDate - date < milliseconds);
}

const formatDate = (date, timezone) => {
  return new Date(date).toLocaleDateString("ru", {
    timeZone: timezone || "Asia/Vladivostok",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Inline-кнопка со ссылкой на заявку. Telegram отклоняет кнопки с localhost/невалидным
// URL (BUTTON_URL_INVALID) и роняет всю отправку — в dev (ADDRESS=localhost) не добавляем.
const ticketButton = (num) => {
  const base = process.env.ADDRESS || "";
  const isLocal = /\/\/(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(base);
  if (!/^https?:\/\//i.test(base) || isLocal) {
    return undefined;
  }
  return {
    inline_keyboard: [[{ text: "Подробнее", url: `${base}/tickets/${num}` }]],
  };
};

const bot = new TelegramBot(TOKEN, {
  polling: true,
});

bot.on("polling_error", (error) =>
  logger.log("error", `Bot polling error`, {
    error: error.message,
    stack: error.stack,
  }),
);

let commands = [];
let keyboard = [];

exports.launchTgBot = async () => {
  try {
    const prefs = await Preferences.findOne({});
    const globalChat = prefs.notify.byTelegram.chatId;

    //------------------- API REQUESTS FUNCTIONS --------------------

    const authorizeBot = async (msg, userId) => {
      try {
        const response = await fetch(
          `http://backend:8080/api/tg/auth?api_token=${process.env.TG_API_TOKEN}&chatId=${msg.chat.id}&userId=${userId}`,
          { method: "POST" },
        );

        return response;
      } catch (error) {
        logger.log("error", `Failed to authorize bot`, {
          error: error.message,
          stack: error.stack,
        });
      }
    };

    const getTickets = async (msg) => {
      try {
        if (msg.chat.id.toString() !== globalChat) {
          logger.log("info", `Fetching tickets`);
          const response = await fetch(
            `http://backend:8080/api/tg/tickets/all-opened?api_token=${process.env.TG_API_TOKEN}&chat_id=${msg.chat.id}`,
          );
          const responseJSON = await response.json();

          return responseJSON.tickets;
        }
        return [];
      } catch (error) {
        logger.log("error", `Failed to fetch tickets`, {
          error: error.message,
          stack: error.stack,
        });
      }
    };

    const getCompanies = async (msg) => {
      try {
        const response = await fetch(
          `http://backend:8080/api/tg/tickets/all-opened?api_token=${process.env.TG_API_TOKEN}&chat_id=${msg.chat.id}`,
        );
        const { tickets } = await response.json();

        if (!tickets) {
          return [];
        }

        let companies = [];
        for (let ticket of tickets) {
          if (!companies.includes(ticket.company.alias)) {
            companies.push(ticket.company.alias);
          }
        }

        return companies;
      } catch (error) {
        logger.log("error", `Failed to fetch companies`, {
          error: error.message,
          stack: error.stack,
        });
      }
    };

    const addTicket = async (msg) => {
      try {
        const description =
          msg.reply_to_message.text || msg.reply_to_message.caption;

        let attachment = {};

        if (msg.reply_to_message.photo) {
          const fileId =
            msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1]
              .file_id;

          const fileName = `${crypto.randomUUID()}.jpeg`;
          const fileStream = bot.getFileStream(fileId);
          fileStream
            .pipe(fs.createWriteStream(`./uploads/${fileName}`))
            .on("close", () => {
              logger.log("info", `File downloaded`);
            });

          attachment = { name: fileName };
        }

        const user = await User.findOne({
          "telegramBot.chatId": msg.chat.id.toString(),
        });

        const now = new Date();

        const ticket = new Ticket({
          title:
            description.length > 50
              ? description.substring(0, 50) + "..."
              : description,
          description: description,
          attachments: attachment.name ? [attachment] : [],
          applicantId: user._id,
          company: user.company,
          deadline: now.setTime(
            now.getTime() + prefs.deadline * 60 * 60 * 1000,
          ),
          state: "Новая",
          source: "Telegram",
          createdBy: user._id,
          updatedBy: user._id,
          notifications: {
            lastAction: "new ticket",
            pending: true,
          },
        });

        await ticket.save();

        // Автоопределение категории заявки в фоне (если ИИ включён в настройках).
        // Читаем настройки заново, чтобы учитывать актуальное состояние тумблера.
        const freshPrefs = await Preferences.findOne({});
        if (freshPrefs?.ai?.isActive) {
          detectTicketCategory(ticket._id).catch((error) =>
            logger.log("error", "Background telegram category detection failed", {
              ticketId: ticket._id.toString(),
              error: error.message,
            }),
          );
        }

        return;
      } catch (error) {
        logger.log("error", `Failed to create ticket`, {
          error: error.message,
          stack: error.stack,
        });
      }
    };

    //------------------- PROCESSING INCOMING MESSAGES -------------------
    bot.on(
      "text",
      async (msg) => {
        try {
          // проверяем, что чат привязан к учётке пользователя
          const user = await User.findOne({
            "telegramBot.chatId": msg.chat.id.toString(),
          });

          if (
            !user &&
            !msg.text.startsWith("/start") &&
            msg.chat.id != globalChat
          ) {
            bot.sendMessage(
              msg.chat.id,
              "Похоже, что бот не привязан к вашей учётной записи😔",
              { parse_mode: "MarkdownV2" },
            );
            return;
          }

          if (msg.text.startsWith("/start")) {
            if (msg.text.length > 6) {
              const userId = msg.text.slice(7);

              authorizeBot(msg, userId);

              await bot.sendMessage(msg.chat.id, `🥳 Всё получилось!`);
            }

            if (msg.chat.id.toString() !== globalChat) {
              commands = [
                {
                  command: "start",
                  description: "🤖 Запустить бота",
                },
                {
                  command: "id",
                  description: "📍 Узнать ID чата",
                },
                {
                  command: "ticket_list",
                  description: "📖 Список текущих заявок",
                },
                {
                  command: "add_new_ticket",
                  description: "⭐️ Новая заявка",
                },
              ];

              keyboard = [["⭐️ Новая заявка"], ["📖 Список текущих заявок"]];
              bot.setMyCommands(commands);

              await bot.sendMessage(
                msg.chat.id,
                "Привет👋 Воспользуйтесь меню или просто отправьте сообщение или фото с описанием, чтобы создать заявку",
                {
                  parse_mode: "MarkdownV2",
                  reply_markup: {
                    keyboard: keyboard,
                    resize_keyboard: true,
                  },
                },
              );
            } else {
              commands = [
                {
                  command: "start",
                  description: "🤖 Запустить бота",
                },
                {
                  command: "id",
                  description: "📍 Узнать ID чата",
                },
              ];
              keyboard = [];
              bot.setMyCommands(commands);

              await bot.sendMessage(
                msg.chat.id,
                "Привет👋 Отлично, уведомления по заявкам теперь будут отправляться в эту группу",
                {
                  parse_mode: "MarkdownV2",
                  reply_markup: {
                    keyboard: keyboard,
                    resize_keyboard: true,
                  },
                },
              );
            }
          } else if (msg.text.startsWith("/id")) {
            await bot.sendMessage(
              msg.chat.id,
              "ID чата: " + "`" + msg.chat.id + "`",
              {
                parse_mode: "MarkdownV2",
              },
            );
          } else if (
            msg.text == "📖 Список текущих заявок" ||
            msg.text.startsWith("/ticket_list")
          ) {
            if (msg.chat.id.toString() === globalChat) {
              await bot.sendMessage(
                msg.chat.id,
                "Данный функционал недоступен для групп",
              );
              return;
            }

            const tickets = (await getTickets(msg)) || [];

            if (tickets.length === 0) {
              await bot.sendMessage(msg.chat.id, "Нет активных заявок");
              return;
            }
            const buttonTitle = (ticket) => {
              const isOverdue = new Date(ticket.deadline) < new Date();

              const isMine = ticket.responsibles
                .map((resp) => resp._id.toString())
                .includes(user._id.toString());

              const isToday = (date) => {
                const today = new Date();
                return (
                  date.getDate() === today.getDate() &&
                  date.getMonth() === today.getMonth() &&
                  date.getFullYear() === today.getFullYear()
                );
              };

              const forToday = isToday(new Date(ticket.deadline));

              return user.isEndUser
                ? `${ticket.num} | ${ticket.title}`
                : `${isMine ? "✋ " : ""}${isOverdue ? "🔴 " : ""}${
                    forToday ? "🕗 " : ""
                  }${ticket.num} | ${ticket.company.alias} | ${ticket.title}`;
            };

            const replyText = user.isEndUser
              ? `Всего в списке: ${tickets.length}`
              : `🔴 - просрочена\n\n✋ - вы в списке ответственных\n\n🕗 - на сегодня`;

            await bot.sendMessage(msg.chat.id, replyText, {
              reply_markup: {
                inline_keyboard: tickets.map((ticket) => [
                  {
                    text: buttonTitle(ticket),
                    callback_data: `${ticket.num}`,
                  },
                ]),
              },
              reply_to_message_id: msg.message_id,
            });

            // await bot.deleteMessage(msg.chat.id, msg.message_id);
          } else if (
            msg.text == "⭐️ Новая заявка" ||
            msg.text.startsWith("/add_new_ticket")
          ) {
            if (msg.chat.id.toString() === globalChat) {
              await bot.sendMessage(
                msg.chat.id,
                "Данный функционал недоступен для групп",
              );
              return;
            }

            await bot.sendMessage(
              msg.chat.id,
              `Опишите проблему или задачу. Можно скинуть фото, но обязательно с описанием`,
              {
                reply_to_message_id: msg.message_id,
              },
            );
          } else {
            if (msg.chat.id.toString() !== globalChat) {
              await bot.sendMessage(msg.chat.id, "Отправить заявку?", {
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: "Да",
                        callback_data: `addNewTicket`,
                      },
                      {
                        text: "Нет",
                        callback_data: "cancel",
                      },
                    ],
                  ],
                },
                reply_to_message_id: msg.message_id,
              });
            }
          }
        } catch (error) {
          logger.log("error", `Failed to process incoming text`, {
            error: error.message,
            stack: error.stack,
          });
        }
      }, // text processing end
    );

    bot.on("photo", async (msg) => {
      try {
        // проверяем, что чат привязан к учётке пользователя
        const user = await User.findOne({
          "telegramBot.chatId": msg.chat.id.toString(),
        });

        if (!user) {
          bot.sendMessage(
            msg.chat.id,
            "Похоже, что бот не привязан к вашей учётной записи😔",
          );
          return;
        }

        if (!msg.caption) {
          bot.sendMessage(
            msg.chat.id,
            "Фото обязательно должно быть с описанием",
          );
        } else {
          await bot.sendMessage(msg.chat.id, "Отправить заявку?", {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Да",
                    callback_data: `addNewTicket`,
                  },
                  {
                    text: "Нет",
                    callback_data: "cancel",
                  },
                ],
              ],
            },
            reply_to_message_id: msg.message_id,
          });
        }
      } catch (error) {
        logger.log("error", `Failed to process incoming photo`, {
          error: error.message,
          stack: error.stack,
        });
      }
    });

    //-------------------- PROCESSING CALLBACK QUERIES -------------------
    bot.on("callback_query", async (ctx) => {
      try {
        const companies = await getCompanies(ctx.message);
        const tickets = await getTickets(ctx.message);

        if (companies.includes(ctx.data)) {
          const tickets = await getTickets(ctx.message);
          const companyTickets = tickets.filter(
            (ticket) => ticket.company.alias === ctx.data,
          );

          await bot.sendMessage(
            ctx.message.chat.id,
            `Текущие заявки компании ${ctx.data}`,
            {
              reply_markup: {
                inline_keyboard: companyTickets.map((ticket) => [
                  {
                    text: `${ticket.num} ${ticket.title}`,
                    callback_data: `${ticket.num}`,
                  },
                ]),
              },
              reply_to_message_id: ctx.message.message_id,
            },
          );
          await bot.deleteMessage(ctx.message.chat.id, ctx.message.message_id);
          await bot.deleteMessage(
            ctx.message.reply_to_message.chat.id,
            ctx.message.reply_to_message.message_id,
          );
        }

        if (
          tickets
            .map((ticket) => ticket.num.toString())
            .includes(ctx.data.toString())
        ) {
          const ticket = tickets.find(
            ({ num }) => num.toString() === ctx.data.toString(),
          );
          const { num, title, company, applicant, deadline, state } = ticket;
          const responsibles = ticket.responsibles
            .map((resp) => ` ${resp.lastName} ${resp.firstName}`)
            .toString();
          const timezone = prefs.timezone;

          const user = await User.findOne({
            "telegramBot.chatId": ctx.message.chat.id.toString(),
          });

          const isOverdue = new Date(deadline) < new Date();

          const message = user.isEndUser
            ? // для Клиентов
              `<b>Заявка ${num}</b>\n<b>Тема: ${title}</b>\nДедлайн: ${formatDate(
                deadline,
                timezone,
              )}\n<b>Статус: ${state}</b>`
            : // не для Клиентов
              `<b>Заявка ${num}</b>\n<b>Тема: ${title}</b>\nКомпания: ${
                company.alias
              }\nИнициатор: ${applicant.lastName} ${
                applicant.firstName
              }\nКонтактный номер: <a href='tel:${applicant.phone}'>${
                applicant.phone
              }</a>\nОтветственные:${responsibles}\n<b>Дедлайн: ${formatDate(
                deadline,
                timezone,
              )}</b>${isOverdue ? " 🔴" : ""}\n<b>Статус: ${state}</b>`;

          const detailsButton = ticketButton(num);
          const sendOptions = {
            parse_mode: "HTML",
            disable_web_page_preview: true,
          };
          if (detailsButton) sendOptions.reply_markup = detailsButton;

          await bot.sendMessage(ctx.message.chat.id, message, sendOptions);

          await bot.deleteMessage(ctx.message.chat.id, ctx.message.message_id);
        }

        if (ctx.data === "addNewTicket") {
          addTicket(ctx.message);

          await bot.deleteMessage(ctx.message.chat.id, ctx.message.message_id);

          await bot.sendMessage(
            ctx.message.chat.id,
            "Отлично!👌 В течение минуты пришлём уведомление о создании заявки и будем держать Вас в курсе о ходе её выполнения.",
          );
        }

        if (ctx.data === "cancel") {
          await bot.deleteMessage(ctx.message.chat.id, ctx.message.message_id);
          return;
        }
      } catch (error) {
        logger.log("error", `Failed to process callback query`, {
          error: error.message,
          stack: error.stack,
        });
      }
    });
  } catch (error) {
    logger.log("error", `Failed to launch bot`, {
      error: error.message,
      stack: error.stack,
    });
  }
};

//-------------------- SENDING NOTIFICATIONS --------------------

exports.tgSendMessage = async (channelId, msg, replyMarkup) => {
  try {
    sleep(2000);
    const options = {
      disable_web_page_preview: true,
      parse_mode: "HTML",
    };
    if (replyMarkup) options.reply_markup = replyMarkup;
    const message = await bot.sendMessage(channelId, msg, options);
    logger.log("info", `Message sent to Telegram`);
    return message;
  } catch (error) {
    logger.log("error", `Failed to send message to Telegram`, {
      error: error.message,
      stack: error.stack,
    });
  }
};
