import { config } from "../config.ts";
import type { BotConfig, BoardUser, TicketSummary, WorkStatus } from "../api/types.ts";

/**
 * Отрисовка сообщений. Здесь единственное место, которое знает про HTML
 * Telegram; всё остальное оперирует данными.
 */

/** Предел одного сообщения у Telegram. */
const TG_TEXT_LIMIT = 4096;

export const escapeHtml = (text: unknown): string =>
  String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const capitalize = (text: string): string =>
  text ? text[0]!.toUpperCase() + text.slice(1) : text;

export const formatDate = (value: string | Date, timezone: string): string =>
  new Date(value).toLocaleDateString("ru", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Кнопка «Подробнее». Telegram отклоняет кнопки с localhost или неполным URL
 * (BUTTON_URL_INVALID) и роняет ВСЮ отправку, поэтому в деве её просто нет.
 */
export const ticketButton = (num: number) => {
  const base = config.appUrl;
  const isLocal = /\/\/(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(base);
  if (!/^https?:\/\//i.test(base) || isLocal) {
    return undefined;
  }
  return {
    inline_keyboard: [[{ text: "Подробнее", url: `${base}/tickets/${num}` }]],
  };
};

/**
 * Клавиатура табло: выбираемые статусы по два в ряд плюс сброс.
 *
 * Табло одно на всех, персонализировать нечем — показываем только те статусы,
 * что ставятся руками. Отпуск, больничный и «не на работе» проставляет
 * автоматика, и кнопок для них быть не должно: нажатие всё равно отклонит
 * бэкенд. Каталог приезжает оттуда же, своей копии кодов у сервиса нет.
 */
export const boardKeyboard = (statuses: WorkStatus[]) => {
  const manual = statuses.filter((status) => status.manual && status.code !== "unset");
  const rows: { text: string; callback_data: string }[][] = [];

  for (let i = 0; i < manual.length; i += 2) {
    rows.push(
      manual.slice(i, i + 2).map((status) => ({
        text: `${status.emoji} ${status.label}`,
        callback_data: `ws:${status.code}`,
      })),
    );
  }

  const unset = statuses.find((status) => status.code === "unset");
  if (unset) {
    rows.push([
      { text: `${unset.emoji} сбросить статус`, callback_data: "ws:unset" },
    ]);
  }

  return { inline_keyboard: rows };
};

const boardText = (
  users: BoardUser[],
  botConfig: BotConfig,
  withNotes: boolean,
): string => {
  const lines = ["<b>Статусы сотрудников</b>"];

  for (const status of botConfig.workStatuses) {
    const group = users.filter(
      (user) => (user.workStatus?.code || "unset") === status.code,
    );
    if (group.length === 0) continue;

    lines.push("");
    lines.push(`${status.emoji} <b>${capitalize(status.label)} — ${group.length}</b>`);

    for (const user of group) {
      const name = escapeHtml(`${user.lastName || ""} ${user.firstName || ""}`.trim());
      const note =
        withNotes && user.workStatus?.note
          ? ` (${escapeHtml(user.workStatus.note)})`
          : "";
      lines.push(`• ${name}${note}`);
    }
  }

  /**
   * Футер — момент ПОСЛЕДНЕЙ смены статуса, а не «сейчас».
   *
   * Иначе текст различался бы на каждом тике, хеш никогда бы не совпадал, и
   * табло переписывалось бы раз в двадцать секунд круглосуточно.
   */
  const stamps = users
    .map((user) => user.workStatus?.updatedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((time) => Number.isFinite(time));

  if (stamps.length > 0) {
    lines.push("");
    lines.push(
      `<i>Обновлено: ${formatDate(new Date(Math.max(...stamps)), botConfig.timezone)}</i>`,
    );
  }

  return lines.join("\n");
};

/** Ступенчатая деградация под лимит: без заметок → усечение хвоста. */
export const renderBoard = (users: BoardUser[], botConfig: BotConfig): string => {
  let text = boardText(users, botConfig, true);
  if (text.length <= TG_TEXT_LIMIT) return text;

  text = boardText(users, botConfig, false);
  if (text.length <= TG_TEXT_LIMIT) return text;

  const suffix = "\n<i>…список усечён</i>";
  const lines = text.split("\n");
  while (lines.length && lines.join("\n").length + suffix.length > TG_TEXT_LIMIT) {
    lines.pop();
  }
  return lines.join("\n") + suffix;
};

/**
 * Карточка заявки. Клиенту показываем меньше: чужие исполнители, телефон
 * заявителя и название компании ему не нужны и не его.
 */
export const renderTicket = (
  ticket: TicketSummary,
  botConfig: BotConfig,
  forClient: boolean,
): string => {
  const lines = [
    `<b>Заявка ${ticket.num}</b>`,
    `<b>Тема: ${escapeHtml(ticket.title)}</b>`,
  ];

  if (!forClient) {
    lines.push(`Компания: ${escapeHtml(ticket.company?.alias || "—")}`);

    const applicant = ticket.applicant;
    if (applicant) {
      const name = `${applicant.lastName || ""} ${applicant.firstName || ""}`.trim();
      lines.push(`Заявитель: ${escapeHtml(name || "—")}`);
      if (applicant.phone) lines.push(`Телефон: ${escapeHtml(applicant.phone)}`);
    }

    // Подпись про местное время клиента приходит готовой с бэкенда: своей
    // логики часовых поясов у сервиса нет и заводить её не надо.
    if (ticket.clientTimeLabel) {
      lines.push(`У клиента сейчас: ${escapeHtml(ticket.clientTimeLabel)}`);
    }

    const responsibles = (ticket.responsibles || [])
      .map((person) => `${person.lastName || ""} ${person.firstName || ""}`.trim())
      .filter(Boolean);
    if (responsibles.length) {
      lines.push(`Исполнители: ${escapeHtml(responsibles.join(", "))}`);
    }
  }

  if (ticket.deadline) {
    const overdue = new Date(ticket.deadline) < new Date();
    const label = formatDate(ticket.deadline, botConfig.timezone);
    lines.push(`Дедлайн: ${label}${overdue ? " ⚠️ просрочен" : ""}`);
  }

  lines.push(`<b>Статус: ${escapeHtml(ticket.state)}</b>`);

  if (!forClient && ticket.latestComment?.content) {
    lines.push("");
    lines.push(`Последний комментарий: ${escapeHtml(ticket.latestComment.content)}`);
  }

  return lines.join("\n");
};

/** Список заявок кнопками: по одной в ряд, номер и тема. */
export const ticketListKeyboard = (tickets: TicketSummary[]) => ({
  inline_keyboard: tickets.map((ticket) => [
    {
      text: `${ticket.num} ${ticket.title}`.slice(0, 64),
      callback_data: `ticket:${ticket.num}`,
    },
  ]),
});

/** Компании кнопками — когда заявок много и их надо сгруппировать. */
export const companyKeyboard = (tickets: TicketSummary[]) => {
  const aliases = [
    ...new Set(
      tickets
        .map((ticket) => ticket.company?.alias)
        .filter((alias): alias is string => Boolean(alias)),
    ),
  ];
  return {
    inline_keyboard: aliases.map((alias) => [
      { text: alias, callback_data: `company:${alias}`.slice(0, 64) },
    ]),
  };
};
