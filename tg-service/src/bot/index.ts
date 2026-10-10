import { Bot, GrammyError, HttpError } from "grammy";
import type { Context, NextFunction } from "grammy";

import {
  claimPairing,
  createTicket,
  decideMikrotikChange,
  fetchActor,
  fetchMikrotikChangeMessage,
  fetchOpenTickets,
  setupStatusBoard,
  setWorkStatus,
} from "../api/backend.ts";
import { BackendError } from "../api/client.ts";
import type { BotConfig, TicketSummary } from "../api/types.ts";
import { config } from "../config.ts";
import { logger } from "../logger.ts";
import { clearDialog, getDialog, setDialog } from "../store/dialog.ts";
import {
  companyKeyboard,
  renderTicket,
  statusKeyboard,
  ticketButton,
  ticketListKeyboard,
} from "./render.ts";
import { handleMikrotikChange } from "./mikrotikChange.ts";

/**
 * Разговор с людьми.
 *
 * Главное правило и главное отличие от прежнего бота: КТО ДЕЙСТВУЕТ — это
 * всегда `ctx.from.id`, никогда `ctx.chat.id`. В личном чате они совпадают, и
 * на этом совпадении прежний код держался целиком; в группе `chat.id` — это
 * комната, поэтому любой её участник заводил заявки и читал чужие от имени той
 * учётки, к которой группу однажды привязали.
 *
 * Второе правило: сервис ничего не решает про права. Он пересказывает, кто
 * пишет, и показывает ответ бэкенда — включая отказы.
 */

const MY_STATUS = "🚦 Мой статус";

/**
 * Меню в личном чате. «Мой статус» — только сотрудникам со статусами
 * присутствия; клиент его не видит (решает бэкенд, `GET /api/bot/me`).
 */
const TICKET_BUTTONS = [
  [{ text: "⭐️ Новая заявка" }],
  [{ text: "📖 Список текущих заявок" }],
];

const mainKeyboard = (withStatus: boolean) => ({
  keyboard: withStatus ? [...TICKET_BUTTONS, [{ text: MY_STATUS }]] : TICKET_BUTTONS,
  resize_keyboard: true,
});

/**
 * Меню команд. Было у прежнего бота и потерялось при переписывании — без него
 * синей кнопки «Меню» в чате нет вовсе, и команды приходится помнить наизусть.
 */
const PRIVATE_COMMANDS = [
  { command: "start", description: "🤖 Запустить бота" },
  { command: "id", description: "📍 Узнать ID чата" },
  { command: "ticket_list", description: "📖 Список текущих заявок" },
  { command: "add_new_ticket", description: "⭐️ Новая заявка" },
];

const privateCommands = (withStatus: boolean) =>
  withStatus
    ? [...PRIVATE_COMMANDS, { command: "status", description: MY_STATUS }]
    : PRIVATE_COMMANDS;

/**
 * Доступны ли человеку статусы. Любой отказ — не привязан, клиент, сбой сети —
 * значит «нет»: лишняя кнопка у клиента хуже, чем её временное отсутствие у
 * сотрудника, которому достаточно повторить /start.
 */
const canSetStatus = async (actor: number | undefined): Promise<boolean> => {
  if (!actor) return false;
  const info = await fetchActor(actor).catch(() => null);
  return info?.canSetWorkStatus === true;
};

/** В групповом чате уведомлений заявки не заводят — там бот только вещает. */
const GROUP_COMMANDS = [
  { command: "start", description: "🤖 Запустить бота" },
  { command: "id", description: "📍 Узнать ID чата" },
];

/** Ответ на ошибку бэкенда: 4xx — это сообщение человеку, остальное — сбой. */
const explain = (error: unknown): string => {
  if (error instanceof BackendError) {
    if (error.status >= 400 && error.status < 500) {
      return error.message;
    }
    return "Сервер сейчас недоступен, попробуйте позже";
  }
  return "Что-то пошло не так, попробуйте позже";
};

type ConfigSource = () => BotConfig | null;

export const createBot = (getConfig: ConfigSource): Bot => {
  const bot = new Bot(config.botToken);

  /**
   * Единая обработка: необработанный отказ в хендлере grammy иначе всплывает
   * в polling-цикл. Прежний бот ловил только `polling_error` и молча терял всё
   * остальное.
   */
  bot.catch((error) => {
    const cause = error.error;
    if (cause instanceof GrammyError) {
      logger.warn("Telegram rejected the request", { description: cause.description });
    } else if (cause instanceof HttpError) {
      logger.warn("Telegram network is unreachable", cause);
    } else {
      logger.error("Unhandled handler error", cause);
    }
  });

  // --- привязка -------------------------------------------------------------

  bot.command("start", async (ctx) => {
    // `ctx.match` — то, что после команды. Прежний бот резал `slice(7)` и в
    // группе отдавал бэкенду «имябота <код>».
    const code = String(ctx.match || "").trim();

    if (code) {
      try {
        const result = await claimPairing(code, ctx.chat.id);
        const withStatus = await canSetStatus(ctx.from?.id);
        await ctx.reply(
          `🥳 ${result.message}${result.firstName ? `\nВы вошли как ${result.firstName}` : ""}`,
          { reply_markup: mainKeyboard(withStatus) },
        );
      } catch (error) {
        // Отвечаем ПО ОТВЕТУ бэкенда: просроченная или использованная ссылка —
        // обычное дело, и молчать о ней нельзя.
        await ctx.reply(explain(error));
      }
      return;
    }

    /**
     * Приветствие. Тексты и меню — прежнего бота, дословно: их читают люди, и
     * переписывать их «покрасивее» я права не имел. В групповом чате
     * уведомлений меню заявок не нужно — там бот только вещает.
     */
    const isGlobalChat =
      String(ctx.chat.id) === String(getConfig()?.telegram.chatId || "");
    const withStatus = !isGlobalChat && (await canSetStatus(ctx.from?.id));

    await ctx.api
      .setMyCommands(isGlobalChat ? GROUP_COMMANDS : privateCommands(withStatus), {
        scope: { type: "chat", chat_id: ctx.chat.id },
      })
      .catch(() => undefined);

    await ctx.reply(
      isGlobalChat
        ? "Привет👋 Отлично, уведомления по заявкам теперь будут отправляться в эту группу"
        : "Привет👋 Воспользуйтесь меню или просто отправьте сообщение или фото с описанием, чтобы создать заявку",
      isGlobalChat ? undefined : { reply_markup: mainKeyboard(withStatus) },
    );
  });

  bot.command("id", async (ctx) => {
    await ctx.reply(`ID этого чата: <code>${ctx.chat.id}</code>`, {
      parse_mode: "HTML",
    });
  });

  /**
   * Включить табло присутствия в этой группе.
   *
   * Кто вправе — решает бэкенд. Прежний бот читал `isAdmin` прямо из документа
   * пользователя, то есть держал своё суждение о правах в обход ролей; здесь
   * сервис только сообщает, КТО нажал и ГДЕ, а отказ показывает как есть.
   */
  bot.command("status_board", async (ctx) => {
    if (ctx.chat.type === "private") {
      await ctx.reply("Табло включается в группе команды, а не в личном чате");
      return;
    }

    const actor = ctx.from?.id;
    if (!actor) return;

    try {
      const result = await setupStatusBoard(
        actor,
        ctx.chat.id,
        ctx.message?.message_thread_id,
      );
      await ctx.reply(
        `${result.message}. Появится здесь в течение минуты и будет закреплено.`,
      );
    } catch (error) {
      await ctx.reply(explain(error));
    }
  });

  // --- заявки ---------------------------------------------------------------

  /**
   * Заявки — только в личном чате. В группе бот-администратор получает ВСЕ
   * сообщения (режим приватности на администраторов не действует), и без
   * этого фильтра предлагал завести заявку на каждую реплику команды.
   */
  const dm = bot.chatType("private");

  const sendTicketList = async (ctx: Context) => {
    const actor = ctx.from?.id;
    if (!actor) return;

    let tickets: TicketSummary[];
    try {
      tickets = (await fetchOpenTickets(actor)).tickets;
    } catch (error) {
      await ctx.reply(explain(error));
      return;
    }

    if (tickets.length === 0) {
      await ctx.reply("Нет активных заявок");
      return;
    }

    // Много заявок — сначала компании, иначе клавиатура не помещается.
    if (tickets.length > 20) {
      await ctx.reply("Выберите компанию", {
        reply_markup: companyKeyboard(tickets),
      });
      return;
    }

    await ctx.reply("Текущие заявки", {
      reply_markup: ticketListKeyboard(tickets),
    });
  };

  dm.command("ticket_list", sendTicketList);
  dm.hears("📖 Список текущих заявок", sendTicketList);

  const askForTicket = async (ctx: Context) => {
    await ctx.reply("Опишите проблему одним сообщением. Можно приложить фото.");
  };

  dm.command("add_new_ticket", askForTicket);
  dm.hears("⭐️ Новая заявка", askForTicket);

  // --- свой статус ------------------------------------------------------------

  const askForStatus = async (ctx: Context, next: NextFunction) => {
    // Клиенту функции как будто нет: текст уходит дальше — в обычное
    // предложение завести заявку, а команда без ответа, как любая чужая.
    if (!(await canSetStatus(ctx.from?.id))) {
      await next();
      return;
    }

    const botConfig = getConfig();
    if (!botConfig) {
      await ctx.reply("Настройки ещё не загружены, повторите через несколько секунд");
      return;
    }
    await ctx.reply("Выберите статус", {
      reply_markup: statusKeyboard(botConfig.workStatuses),
    });
  };

  dm.command("status", askForStatus);
  dm.hears(MY_STATUS, askForStatus);

  // --- свободный текст и фото → предложение завести заявку -------------------

  const offerTicket = async (
    ctx: Context,
    description: string,
    photoFileId?: string,
  ) => {
    const actor = ctx.from?.id;
    if (!actor || !description.trim()) return;

    setDialog(actor, {
      step: "confirm-ticket",
      payload: { description: description.trim(), ...(photoFileId ? { photoFileId } : {}) },
    });

    await ctx.reply("Завести заявку по этому сообщению?", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Да", callback_data: "newticket:yes" },
            { text: "Нет", callback_data: "newticket:no" },
          ],
        ],
      },
    });
  };

  dm.on("message:text", async (ctx) => {
    // Команды и кнопки разобраны выше; сюда доходит только свободный текст.
    if (ctx.message.text.startsWith("/")) return;
    await offerTicket(ctx, ctx.message.text);
  });

  dm.on("message:photo", async (ctx) => {
    /**
     * Фото ОБЯЗАНО быть с описанием — правило прежнего бота, и оно про дело:
     * заявка из одной картинки без слов исполнителю ничего не сообщает. Я его
     * молча снял, подставляя «Фото без описания», — то есть заводил заведомо
     * бесполезные заявки.
     */
    if (!ctx.message.caption?.trim()) {
      await ctx.reply("Фото обязательно должно быть с описанием");
      return;
    }
    // Последний размер — самый крупный.
    const photo = ctx.message.photo.at(-1);
    await offerTicket(ctx, ctx.message.caption, photo?.file_id);
  });

  // --- нажатия --------------------------------------------------------------

  bot.on("callback_query:data", async (ctx) => {
    const actor = ctx.from.id;
    const data = ctx.callbackQuery.data;

    /**
     * Статус отвечает на нажатие сам и один раз: Telegram принимает только
     * первый ответ, и при общем раннем ответе ниже отказ бэкенда («только
     * сотрудникам») молча терялся.
     */
    if (data.startsWith("ws:")) {
      // Кнопки остались на старых табло в группе — там статус не меняем.
      if (ctx.chat?.type !== "private") {
        await ctx
          .answerCallbackQuery({ text: "Статус меняется в личном чате с ботом", show_alert: true })
          .catch(() => undefined);
        return;
      }

      const code = data.slice(3);
      let result;
      try {
        result = await setWorkStatus(actor, code);
      } catch (error) {
        await ctx
          .answerCallbackQuery({ text: explain(error), show_alert: true })
          .catch(() => undefined);
        return;
      }
      await ctx.answerCallbackQuery().catch(() => undefined);

      const botConfig = getConfig();
      const current = botConfig?.workStatuses.find(
        (status) => status.code === (result.workStatus?.code ?? code),
      );
      if (!botConfig || !current) return;

      // Повторный выбор того же статуса — «message is not modified», не ошибка.
      await ctx
        .editMessageText(`Ваш статус: ${current.emoji} ${current.label}`, {
          reply_markup: statusKeyboard(botConfig.workStatuses),
        })
        .catch(() => undefined);
      return;
    }

    /**
     * Решение по запросу ИИ-агента: тоже отвечает само и один раз — отказ
     * бэкенда («это решение не за вами») показывается алертом.
     */
    if (data.startsWith("mc:")) {
      await handleMikrotikChange(ctx, actor, data, {
        fetchMessage: fetchMikrotikChangeMessage,
        decide: decideMikrotikChange,
        explain,
        // Сеть, таймаут и 5xx: исход решения неизвестен
        isUncertain: (error) =>
          error instanceof BackendError && (error.status === 0 || error.status >= 500),
        warn: (message, meta) => logger.warn(message, meta),
      });
      return;
    }

    // Отвечаем Telegram сразу: без этого у кнопки крутится часик.
    await ctx.answerCallbackQuery().catch(() => undefined);

    if (data === "newticket:no") {
      clearDialog(actor);
      // Вопрос убираем: ответ на него дан, а висящие кнопки предлагают нажать
      // ещё раз. Так делал и прежний бот — молча, без «хорошо, не создаю».
      await ctx.deleteMessage().catch(() => undefined);
      return;
    }

    if (data === "newticket:yes") {
      const dialog = getDialog(actor);
      if (!dialog) {
        await ctx.reply("Не помню, о какой заявке речь. Пришлите описание ещё раз.");
        return;
      }
      clearDialog(actor);
      await ctx.deleteMessage().catch(() => undefined);
      await submitTicket(ctx, actor, dialog.payload);
      return;
    }

    if (data.startsWith("company:")) {
      const alias = data.slice("company:".length);
      try {
        const { tickets } = await fetchOpenTickets(actor);
        const forCompany = tickets.filter((ticket) => ticket.company?.alias === alias);
        await ctx.reply(`Заявки компании ${alias}`, {
          reply_markup: ticketListKeyboard(forCompany),
        });
      } catch (error) {
        await ctx.reply(explain(error));
      }
      return;
    }

    if (data.startsWith("ticket:")) {
      const num = Number(data.slice("ticket:".length));
      const botConfig = getConfig();
      if (!botConfig) {
        await ctx.reply("Настройки ещё не загружены, повторите через несколько секунд");
        return;
      }
      try {
        const { tickets } = await fetchOpenTickets(actor);
        const ticket = tickets.find((candidate) => candidate.num === num);
        if (!ticket) {
          await ctx.reply("Заявка больше не в работе");
          return;
        }
        /**
         * Что показать клиенту, а что сотруднику, решается по составу ответа:
         * бэкенд отдаёт клиенту только его заявки и без чужих контактов.
         * Признак «клиент» отдельно не спрашиваем — лишний запрос ради ветки
         * оформления.
         */
        const forClient = !ticket.applicant?.phone && !ticket.responsibles?.length;
        await ctx.reply(renderTicket(ticket, botConfig, forClient), {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...(ticketButton(ticket.num) ? { reply_markup: ticketButton(ticket.num) } : {}),
        });
      } catch (error) {
        await ctx.reply(explain(error));
      }
    }
  });

  /** Заведение заявки: файл забираем у Telegram и отдаём бэкенду, минуя S3. */
  const submitTicket = async (
    ctx: Context,
    actor: number,
    payload: { description: string; photoFileId?: string },
  ) => {
    const form = new FormData();
    form.append("description", payload.description);
    // Обязательные для контроллера поля: `responsibles` он разбирает
    // JSON.parse без проверки, и без него запрос падает разбором.
    form.append("responsibles", "[]");
    form.append("state", "Новая");
    form.append("source", "Telegram");

    if (payload.photoFileId) {
      try {
        const file = await ctx.api.getFile(payload.photoFileId);
        const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
        const response = await fetch(url);
        if (response.ok) {
          /**
           * ТИП ФАЙЛА СТАВИМ САМИ.
           *
           * `response.blob()` с файлового сервера Telegram приходит без типа,
           * то есть `application/octet-stream`, а бэкенд пропускает такой MIME
           * только для `.conf` — заявка с фото падала с «Недопустимое
           * расширение файла». Настоящий тип виден в `file_path`, который
           * Telegram отдаёт с расширением.
           */
          const ext = (file.file_path?.split(".").pop() || "jpg").toLowerCase();
          const isPng = ext === "png";
          const bytes = await response.arrayBuffer();

          form.append(
            "attachments",
            new Blob([bytes], { type: isPng ? "image/png" : "image/jpeg" }),
            `telegram-photo.${isPng ? "png" : "jpg"}`,
          );
        }
      } catch (error) {
        // Заявка важнее вложения: без фото она всё равно полезна.
        logger.warn("Could not fetch the photo from Telegram", error);
      }
    }

    try {
      await createTicket(actor, form);
      /**
       * Ответ человеку, а не отчёт машины.
       *
       * Текст прежнего бота, возвращён дословно: «Заявка 57007 создана» —
       * это констатация для того, кто и так нажал «Да», и она молчит о
       * главном: что будет дальше. Номер, тема и кнопка приедут следом
       * обычным уведомлением о новой заявке — повторять их здесь незачем.
       */
      await ctx.reply(
        "Отлично!👌 В течение минуты пришлём уведомление о создании заявки и будем держать Вас в курсе о ходе её выполнения.",
      );
    } catch (error) {
      // Причина обязана быть в журнале: человеку показывается общая фраза, и
      // без этой строки «Сервер сейчас недоступен» ничем не отличается от
      // «упал разбор формы» — что и стоило двух кругов догадок.
      logger.error("Failed to create a ticket", {
        actor,
        withPhoto: Boolean(payload.photoFileId),
        status: error instanceof BackendError ? error.status : null,
        payload: error instanceof BackendError ? error.payload : null,
        error: error instanceof Error ? error.message : String(error),
        cause:
          error instanceof Error && error.cause instanceof Error
            ? error.cause.message
            : null,
      });
      await ctx.reply(explain(error));
    }
  };

  return bot;
};
