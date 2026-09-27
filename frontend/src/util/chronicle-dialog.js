/**
 * «Хроника» заявки как диалог (канва D4–D8, решение владельца 27.09): чья
 * реплика с какой стороны, чья подпись и какая метка канала над пузырём, где
 * метки дней и черта «Новые». Чистые функции — тесты рядом:
 * `node --test src/util/chronicle-dialog.test.js`.
 *
 * Сторона смотрящего — справа. Сотруднику справа вся команда (своё — без
 * подписи), слева клиентская сторона: заявитель, его коллеги, собеседник из
 * мессенджера. Заявителю справа только его собственные сообщения, команда —
 * слева, по именам. Внутренних заметок в HD нет: клиент видит каждый
 * комментарий, поэтому и сторона считается одинаково честно для обоих.
 */
import { dayLabel } from "./conversation-format.js";

/**
 * @typedef {{ _id?: string, firstName?: string, lastName?: string, isEndUser?: boolean, isServiceAccount?: boolean } | string | null | undefined} CommentAuthor
 * @typedef {{ network?: string, direction?: "in" | "out", authorName?: string, status?: string }} ChannelBlock
 * @typedef {{ _id: string, createdAt: string | Date, createdBy?: CommentAuthor, content?: string, quotedText?: string, source?: string, channel?: ChannelBlock | null }} ChronicleComment
 * @typedef {{ _id: string, createdAt: string | Date, kind?: string }} ChronicleEvent
 * @typedef {{ id: string, isClient: boolean }} Viewer
 * @typedef {{ type: "day", key: string, label: string }} DayRow
 * @typedef {{ type: "new", key: string, count: number }} NewRow
 * @typedef {{ type: "event", key: string, event: ChronicleEvent }} EventRow
 * @typedef {{ type: "comment", key: string, comment: ChronicleComment, side: "in" | "out", gap: number, showName: boolean }} CommentRow
 * @typedef {DayRow | NewRow | EventRow | CommentRow} ChronicleRow
 * @typedef {{ channel: { network: string, direction: "in" | "out", status?: string }, label?: string }} Marker
 */

// Отступ над пузырём, px: после метки дня, «Новых» и события — 6; та же
// сторона и тот же автор — 4; та же сторона, другой автор — 8; смена стороны — 12
export const GAP = { afterLabel: 6, sameAuthor: 4, sameSide: 8, sideSwitch: 12 };

/** id автора: у старых комментариев он лежит вложенным снимком `{ _id, … }`. */
export const authorIdOf = (author) =>
  author == null
    ? ""
    : typeof author === "object"
      ? String(author._id ?? "")
      : String(author);

/**
 * Сторона реплики для смотрящего: "out" — справа, "in" — слева.
 *
 * Письмо от незарегистрированного отправителя автор в БД — служебная учётка
 * `Preferences.defaultApplicant` (`isServiceAccount`, `isEndUser: false`), но
 * это чужой человек, а не сотрудник: у записи нет блока канала (не зеркало
 * мессенджера), и такую сторону решаем ДО общих правил, одинаково для любого
 * смотрящего.
 *
 * Иначе клиенту справа только написанное им самим — письмом, в карточке или
 * из мессенджера; ответ команды мессенджером («out» в блоке канала) — чужой.
 * Сотруднику сторону сперва задаёт блок канала (зеркало входящего — клиент,
 * ответ — команда, в том числе «с телефона»), потом сам автор: свой — справа,
 * по признаку `isEndUser`. Автора без признака (старый снимок, удалённая
 * учётка) судим по заявителю: заявитель — слева, остальные — справа; автора
 * нет совсем — слева.
 * @param {ChronicleComment} comment
 * @param {{ viewer: Viewer, applicantId?: string | null }} context
 * @returns {"in" | "out"}
 */
export const commentSide = (comment, { viewer, applicantId = null }) => {
  const authorId = authorIdOf(comment.createdBy);
  const direction = comment.channel?.direction;
  const author = comment.createdBy;
  if (
    !comment.channel &&
    author &&
    typeof author === "object" &&
    author.isServiceAccount === true
  ) {
    return "in";
  }
  if (viewer.isClient) {
    return authorId && authorId === viewer.id && direction !== "out" ? "out" : "in";
  }
  if (direction === "in") return "in";
  if (direction === "out") return "out";
  if (!authorId) return "in";
  if (authorId === viewer.id) return "out";
  if (author && typeof author === "object" && typeof author.isEndUser === "boolean") {
    return author.isEndUser ? "in" : "out";
  }
  return applicantId && authorId === String(applicantId) ? "in" : "out";
};

/** Письмо: новые помечены `source`, старые узнаются по отрезанной цитате. */
export const isEmailComment = (comment) =>
  comment?.source === "email" || Boolean(comment?.quotedText);

/**
 * Метка канала над пузырём. Сотруднику — у каждой реплики с каналом (у ответа
 * мессенджером — со статусом доставки) и «письмо» у писем. Клиенту — только у
 * своих сообщений и без статуса: доставка ответов команды — не его забота.
 * @param {ChronicleComment} comment
 * @param {{ viewer: Viewer, side: "in" | "out" }} context
 * @returns {Marker | null}
 */
export const commentMarker = (comment, { viewer, side }) => {
  if (viewer.isClient && side !== "out") return null;
  const block = comment.channel?.network ? comment.channel : null;
  if (block) {
    return {
      channel: {
        network: String(block.network),
        direction: block.direction === "out" ? "out" : "in",
        ...(viewer.isClient || !block.status ? {} : { status: block.status }),
      },
    };
  }
  if (isEmailComment(comment)) {
    return { channel: { network: "mail", direction: "in" }, label: "письмо" };
  }
  return null;
};

// Кто говорит — для подписи и серий: неопознанный собеседник и ответы «с
// телефона» идут от служебной учётки, различает их подпись канала
const speakerOf = (comment) =>
  comment.channel?.authorName
    ? `name:${comment.channel.authorName}`
    : `id:${authorIdOf(comment.createdBy)}`;

/**
 * Нужна ли подпись автора (без учёта серии). Своё — без подписи. Сотруднику
 * справа — имя коллеги (и «F1Lab Поддержка · с телефона»); слева заявитель
 * без подписи — он назван в «Деталях», — а имя из подписи канала (неопознанный
 * собеседник) есть всегда. Клиенту команда слева — всегда по имени.
 */
const nameWanted = (comment, { viewer, side, applicantId }) => {
  const authorId = authorIdOf(comment.createdBy);
  const channelName = Boolean(comment.channel?.authorName);
  if (side === "out") {
    return !viewer.isClient && (channelName || authorId !== viewer.id);
  }
  if (viewer.isClient || channelName) return true;
  return !(applicantId && authorId === String(applicantId));
};

const dayKeyOf = (at, timeZone) =>
  new Date(at).toLocaleDateString("en-CA", { timeZone });

/**
 * Лента диалога: реплики и события по возрастанию времени; метка дня — при
 * смене дня; черта «Новые · N» — над первой чужой репликой новее водяного
 * знака визита (`seenAt` — знак ДО этого открытия, страница держит его весь
 * визит). События в «Новые» не входят: у записи хроники нет автора-
 * идентификатора, и своё же действие светилось бы новым. Нет знака (первый
 * визит) — нет и черты. Метка дня остаётся и над чертой: в мессенджерном
 * порядке без неё день новых реплик было бы не узнать.
 * @param {{ comments?: ChronicleComment[], events?: ChronicleEvent[], viewer: Viewer, applicantId?: string | null, seenAt?: string | Date | null, now?: Date, timeZone?: string }} input
 * @returns {ChronicleRow[]}
 */
export const chronicleRows = ({
  comments = [],
  events = [],
  viewer,
  applicantId = null,
  seenAt = null,
  now = new Date(),
  timeZone,
}) => {
  const watermark = seenAt ? new Date(seenAt).getTime() : 0;
  const isNew = (comment) =>
    watermark > 0 &&
    new Date(comment.createdAt).getTime() > watermark &&
    authorIdOf(comment.createdBy) !== viewer.id;
  const newCount = comments.filter(isNew).length;

  const items = [
    ...comments.map((comment) => ({ at: comment.createdAt, comment, event: null })),
    ...events.map((event) => ({ at: event.createdAt, comment: null, event })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  /** @type {ChronicleRow[]} */
  const rows = [];
  let lastDay = null;
  let dividerShown = false;
  /** @type {{ side: "in" | "out", speaker: string } | null} */
  let previous = null;

  for (const item of items) {
    const day = dayKeyOf(item.at, timeZone);
    if (day !== lastDay) {
      rows.push({ type: "day", key: `d-${day}`, label: dayLabel(item.at, { now, timeZone }) });
      lastDay = day;
      previous = null;
    }
    if (item.event) {
      rows.push({ type: "event", key: `e-${item.event._id}`, event: item.event });
      previous = null;
      continue;
    }
    const comment = item.comment;
    if (!dividerShown && isNew(comment)) {
      rows.push({ type: "new", key: "new", count: newCount });
      dividerShown = true;
      previous = null;
    }
    const side = commentSide(comment, { viewer, applicantId });
    const speaker = speakerOf(comment);
    const sameRun = previous !== null && previous.side === side && previous.speaker === speaker;
    const gap = !previous
      ? GAP.afterLabel
      : previous.side !== side
        ? GAP.sideSwitch
        : sameRun
          ? GAP.sameAuthor
          : GAP.sameSide;
    rows.push({
      type: "comment",
      key: `c-${comment._id}`,
      comment,
      side,
      gap,
      showName: !sameRun && nameWanted(comment, { viewer, side, applicantId }),
    });
    previous = { side, speaker };
  }
  return rows;
};
