import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { isMobile } from "react-device-detect";
import { RiAttachment2, RiSendPlaneLine } from "react-icons/ri";

import { Eyebrow } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";
import {
  FileAttachment,
  PhotoAttachment,
} from "@/components/Conversation/MessageMedia";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { chronicleRows, commentMarker } from "@/util/chronicle-dialog";
import {
  NOTIFY_ROUTE,
  chronicleAuthorName,
  initialRoute,
} from "@/util/delivery-routes";

import useHttp from "../../hooks/use-http";
import { AuthedUserContext } from "../../store/authed-user-context";
import useViewTicketStore from "../../store/view-ticket";
import {
  displayTimeZone,
  formatDate,
  formatTime,
} from "../../util/format-date";
import {
  EVENT_TONE_CLASS,
  eventLabel,
  eventMeta,
  technicalSummary,
} from "../../util/ticket-events";
import AttachmentChip from "./View/AttachmentChip";
import ChannelMarker from "./ChannelMarker";
import ReplyRoute from "./ReplyRoute";

/**
 * Хроника заявки — переписка и события одной лентой, в виде диалога (канва
 * «Омниканальные диалоги», D4–D8; решение владельца 27.09). Один компонент для
 * сотрудника и заявителя.
 *
 * Порядок — мессенджерный: старые сверху, новые снизу, поле ответа прижато к
 * низу панели. Сторона смотрящего — справа: сотруднику справа вся команда,
 * слева клиентская сторона; заявителю справа его собственные сообщения, слева
 * команда по именам (util/chronicle-dialog). Внутренних заметок в HD нет —
 * заявитель видит каждый комментарий.
 *
 * События заявки — короткие строки по центру между репликами, в порядке
 * времени; «Переписка» их прячет. Служебные записи бэкенд сворачивает в
 * счётчик под своим событием (services/ticketEvents.js). Заявителю события
 * отбирает бэкенд (`feedForClient`), здесь отбора нет.
 */

// Лента держится низа, пока читатель у низа: пришедшая реплика не уводит
// того, кто листает вверх
const STICK_PX = 80;

const personName = (person) =>
  person && typeof person === "object"
    ? `${person.lastName || ""} ${person.firstName || ""}`.trim()
    : "";

const isImage = (attachment) =>
  Boolean(attachment.mimetype?.startsWith("image/"));

// Вложение комментария → вложение «Диалогов»: файл уже лежит в хранилище
const asMedia = (attachment) => ({
  name: attachment.name,
  originalName: attachment.originalName || attachment.name,
  mimetype: attachment.mimetype || "",
  size: 0,
  durationSec: null,
  status: "ready",
});

/**
 * Ответ, не доставленный в мессенджер (канва D4): «Не доставлено ·
 * Повторить» под пузырём; «Повторить» — тому, кто вправе отвечать
 * (`POST /api/messages/:id/retry`). Причина шлюза — в подсказке.
 */
const DeliveryFailure = ({ comment, canRetry, onRetried }) => {
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      await api(`/api/messages/${comment.channel.messageId}/retry`, {
        method: "POST",
      });
      onRetried(comment._id);
    } catch (error) {
      console.warn("Повтор отправки не удался:", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <p
      className="mt-1 mb-0 text-right text-xs text-destructive"
      title={comment.channel.error || undefined}
    >
      Не доставлено
      {canRetry && comment.channel.messageId && (
        <>
          {" · "}
          <button
            type="button"
            disabled={busy}
            onClick={retry}
            className="cursor-pointer appearance-none border-0 bg-transparent p-0 font-semibold text-destructive underline-offset-2 hover:underline disabled:opacity-50"
          >
            Повторить
          </button>
        </>
      )}
    </p>
  );
};

/** Цитата письма — свёрнутой строкой внутри пузыря (канва D4). */
const QuotedTail = ({ text }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-1 block cursor-pointer appearance-none border-0 bg-transparent p-0 text-xs text-faint hover:text-muted-foreground"
      >
        {open ? "▾ Скрыть цитату" : "▸ Показать цитату"}
      </button>
      {open && (
        <p className="mt-1 mb-0 border-s border-border ps-3 text-xs whitespace-pre-wrap text-muted-foreground">
          {text}
        </p>
      )}
    </>
  );
};

/**
 * Реплика: подпись автора и метка канала над пузырём, текст, вложения,
 * цитата письма, время. Фото — подложкой пузыря без внутренних полей, как в
 * «Диалогах»; прочие файлы — чипами.
 */
const Bubble = ({ row, viewer, canRetry, onRetried, realSender }) => {
  const { comment, side } = row;
  const out = side === "out";
  const name = row.showName
    ? chronicleAuthorName(comment, personName(comment.createdBy), realSender) || "—"
    : "";
  const marker = commentMarker(comment, { viewer, side });
  const attachments = comment.attachments ?? [];
  const photos = attachments.filter(isImage);
  const files = attachments.filter((attachment) => !isImage(attachment));
  const media = photos.length > 0;
  const failed =
    !viewer.isClient &&
    comment.channel?.direction === "out" &&
    comment.channel.status === "failed";

  return (
    <div
      className={cn("flex", out ? "justify-end" : "justify-start")}
      style={{ marginTop: row.gap }}
    >
      <div className="max-w-[88%] min-w-0">
        {(name || marker) && (
          <div
            className={cn(
              "mb-0.5 flex items-center gap-1.5 text-xs",
              out
                ? "me-1 justify-end text-muted-foreground"
                : "ms-1 font-semibold text-foreground",
            )}
          >
            {name && <span className="truncate">{name}</span>}
            {marker && (
              <ChannelMarker channel={marker.channel} label={marker.label} />
            )}
          </div>
        )}
        <div
          className={cn(
            "text-sm leading-5 break-words text-foreground",
            out
              ? "rounded-[14px_14px_4px_14px] bg-bubble-out"
              : "rounded-[14px_14px_14px_4px] bg-bubble-in",
            media ? "p-1 pb-1.5" : "px-3 pt-2 pb-1.5",
          )}
        >
          {photos.map((attachment) => (
            <div key={attachment.name} className="mb-1 last:mb-0">
              <PhotoAttachment
                attachment={asMedia(attachment)}
                kind="photo"
                compact={isMobile}
              />
            </div>
          ))}
          {comment.content && (
            <p
              className={cn("m-0 whitespace-pre-wrap", media && "px-2 pt-1.5")}
            >
              {comment.content}
            </p>
          )}
          {files.length > 0 && (
            <div className={cn("flex flex-wrap gap-x-1.5", media && "px-2")}>
              {files.map((attachment) => (
                <FileAttachment
                  key={attachment.name}
                  attachment={asMedia(attachment)}
                  kind="document"
                />
              ))}
            </div>
          )}
          {comment.quotedText && (
            <div className={cn(media && "px-2")}>
              <QuotedTail text={comment.quotedText} />
            </div>
          )}
          <div
            className={cn(
              "mt-0.5 text-right text-xs text-faint tabular-nums",
              media && "px-2",
            )}
            title={formatDate(comment.createdAt)}
          >
            {formatTime(comment.createdAt)}
          </div>
        </div>
        {failed && (
          <DeliveryFailure
            comment={comment}
            canRetry={canRetry}
            onRetried={onRetried}
          />
        )}
      </div>
    </div>
  );
};

/**
 * Событие заявки — строка по центру между репликами (канва D4): значок тоном
 * каталога, подпись и человек. Под ней — содержание события (причина
 * отказа), файлы, имя удалённого файла и свёрнутые служебные записи.
 */
const EventLine = ({ event, ticketNum }) => {
  const meta = eventMeta(event.kind);
  const Icon = meta.icon;
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState(null);
  const { sendRequest } = useHttp();
  const summary = technicalSummary(event.technical);
  const person = personName(event.user);

  const expand = () => {
    setExpanded((value) => !value);
    if (entries || !event.technical) return;
    const params = new URLSearchParams();
    if (event.technical.from) params.set("from", event.technical.from);
    if (event.technical.to) params.set("to", event.technical.to);
    sendRequest(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticketNum}/log?${params}`,
      },
      (data) => setEntries(data.entries ?? []),
    );
  };

  return (
    <div className="mt-3 mb-1.5">
      <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
        <span aria-hidden className="h-px min-w-4 flex-1 bg-border-soft" />
        <span
          className="inline-flex max-w-[85%] items-center gap-1.5 text-center"
          title={formatDate(event.createdAt)}
        >
          <Icon
            size={14}
            aria-hidden
            className={cn("flex-none", EVENT_TONE_CLASS[meta.tone])}
          />
          <span>{[eventLabel(event), person].filter(Boolean).join(" · ")}</span>
        </span>
        <span aria-hidden className="h-px min-w-4 flex-1 bg-border-soft" />
      </div>

      {/* Содержание события — причина отказа: ради неё запись и открывают.
          Разбирает фразу лога бэкенд (services/ticketEvents.js#detailOf) */}
      {event.detail && (
        <p className="mx-auto mt-1 mb-0 max-w-[85%] text-center text-xs whitespace-pre-wrap text-muted-foreground">
          {event.detail}
        </p>
      )}

      {/* Файлы события — чипами: файл открывается прямо из ленты. Больше двух
          сворачиваем, как везде */}
      {event.files?.length > 0 && event.kind !== "attachmentRemoved" && (
        <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
          {event.files.slice(0, 2).map((file) => (
            <AttachmentChip key={file.name} attachment={file} compact />
          ))}
          {event.files.length > 2 && (
            <span className="self-center text-xs text-faint">
              ещё {event.files.length - 2}
            </span>
          )}
        </div>
      )}
      {event.kind === "attachmentRemoved" && event.files?.[0] && (
        // Удалённый файл не открыть — только назвать
        <div className="mt-1 text-center text-xs text-faint">
          «{event.files[0].originalName || event.files[0].name}»
        </div>
      )}

      {summary && (
        <div className="mt-1 text-center">
          <button
            type="button"
            onClick={expand}
            className={cn(
              "inline-flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 text-xs hover:underline",
              event.technical.failed > 0 ? "text-warning" : "text-faint",
            )}
          >
            {expanded ? "▾" : "▸"} {summary}
          </button>
          {expanded && (
            <ul className="mx-auto mt-1.5 mb-0 max-w-[85%] list-none space-y-1 border-s border-border ps-3 text-left">
              {(entries ?? []).map((entry) => (
                <li key={entry._id} className="text-xs text-muted-foreground">
                  <span className="text-faint tabular-nums">
                    {formatTime(entry.createdAt)}
                  </span>{" "}
                  {entry.event}
                </li>
              ))}
              {entries?.length === 0 && (
                <li className="text-xs text-faint">Записей нет</li>
              )}
              {!entries && <li className="text-xs text-faint">Загрузка…</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * `messaging` — «Диалоги» для сотрудника с правом читать их (модуль включён):
 * `{ canReply, routes, onRoutesChanged }`. Без него (и у заявителя) выбора
 * «Ответить через» нет, а метки каналов у реплик остаются.
 */
const Chronicle = ({
  ticket,
  events = [],
  canComment,
  seenAt = null,
  messaging = null,
}) => {
  const { comments, updateComments } = useViewTicketStore();
  const authedUser = useContext(AuthedUserContext);
  const { sendRequest, isLoading, error } = useHttp();
  const viewer = {
    id: String(authedUser?._id ?? ""),
    isClient: Boolean(authedUser?.isEndUser),
  };

  const [mode, setMode] = useState("comments");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState([]);
  // Причина отказа сервера (например, «занят заявкой №56790»): по коду её не
  // угадать, useHttp отдаёт только statusText
  const [serverMessage, setServerMessage] = useState(null);
  const fileInput = useRef(null);
  // Хроник на странице две (колонка xl и последняя секция на узком экране):
  // у каждой свой id поля файла, иначе «Файл» видимой открывал поле скрытой
  const fileInputId = useId();
  const textarea = useRef(null);
  const scroller = useRef(null);
  const divider = useRef(null);
  const stick = useRef(true);
  const placed = useRef("");
  const forceBottom = useRef(false);

  // «Ответить через»: по умолчанию — маршрут, который предложил сервер
  // (привязанный чат, иначе канал последнего сообщения клиента). Выбор
  // человека переживает перечитывание маршрутов, пока он доступен; другая
  // заявка — выбор заново
  const routes = messaging?.routes ?? null;
  const showRoutes = Boolean(messaging?.canReply && routes?.routes.length);
  const [route, setRoute] = useState(NOTIFY_ROUTE);
  const routeChosen = useRef(false);
  useEffect(() => {
    routeChosen.current = false;
  }, [ticket._id]);
  useEffect(() => {
    setRoute((current) => {
      const stillThere =
        current === NOTIFY_ROUTE ||
        (routes?.routes ?? []).some(
          (item) => item.conversationId === current && item.available,
        );
      return routeChosen.current && stillThere ? current : initialRoute(routes);
    });
  }, [routes]);
  const pickRoute = (next) => {
    routeChosen.current = true;
    setRoute(next);
  };

  const markRetried = (commentId) =>
    updateComments(
      comments.map((comment) =>
        comment._id === commentId
          ? {
              ...comment,
              channel: { ...comment.channel, status: "queued", error: undefined },
            }
          : comment,
      ),
    );

  // Черновик из панели ИИ («Спросить заявителя»): дописываем к тому, что уже
  // набрано, забираем себе и очищаем канал — отправляет человек, не мы
  const commentDraft = useViewTicketStore((state) => state.commentDraft);
  const clearCommentDraft = useViewTicketStore(
    (state) => state.clearCommentDraft,
  );
  useEffect(() => {
    if (!commentDraft) return;
    setContent((previous) =>
      previous.trim() ? `${previous.trimEnd()}\n${commentDraft}` : commentDraft,
    );
    clearCommentDraft();
    textarea.current?.focus();
    textarea.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [commentDraft, clearCommentDraft]);

  const submit = (submitEvent) => {
    submitEvent.preventDefault();
    if (!content.trim()) return;

    const formData = new FormData();
    formData.append("intent", "addComment");
    formData.append("content", content);
    formData.append("ticketId", ticket._id);
    for (const file of files) formData.append("attachments", file);
    const viaMessenger = showRoutes && route !== NOTIFY_ROUTE;
    if (viaMessenger) formData.append("deliverVia", route);
    setServerMessage(null);

    sendRequest(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/comments/add/`,
        method: "POST",
        isFormData: true,
        body: formData,
      },
      (data) => {
        if (!data.comment) {
          setServerMessage(data.message || null);
          return;
        }
        // Ответ через мессенджер привязывает личный чат — маршруты другие
        if (viaMessenger) messaging?.onRoutesChanged?.();
        setContent("");
        setFiles([]);
        if (fileInput.current) fileInput.current.value = "";
        // Своё отправленное лента показывает всегда, даже если читатель
        // листал вверх
        forceBottom.current = true;
        updateComments([
          {
            ...data.comment,
            createdBy: {
              _id: authedUser._id,
              lastName: authedUser.lastName,
              firstName: authedUser.firstName,
              profileImagePath: authedUser.profileImagePath,
              isEndUser: Boolean(authedUser.isEndUser),
            },
          },
          ...comments,
        ]);
      },
    );
  };

  const rows = chronicleRows({
    comments,
    events: mode === "all" ? events : [],
    viewer,
    applicantId: ticket.applicant?._id ?? null,
    seenAt,
    timeZone: displayTimeZone(),
  });

  // Где лента открывается: при открытии заявки и смене вида — у черты
  // «Новые» (первая непрочитанная вверху панели), без неё — в конце. Дальше
  // лента держится низа, пока читатель у низа
  const anchorKey = `${ticket._id}:${mode}`;
  const lastKey = rows.length > 0 ? rows[rows.length - 1].key : "";
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (placed.current !== anchorKey) {
      placed.current = anchorKey;
      const mark = divider.current;
      node.scrollTop = mark
        ? mark.getBoundingClientRect().top -
          node.getBoundingClientRect().top +
          node.scrollTop -
          8
        : node.scrollHeight;
      stick.current =
        node.scrollHeight - node.scrollTop - node.clientHeight < STICK_PX;
      return;
    }
    if (forceBottom.current || stick.current) {
      node.scrollTop = node.scrollHeight;
      forceBottom.current = false;
      stick.current = true;
    }
  }, [anchorKey, lastKey, rows.length]);

  const onScroll = () => {
    const node = scroller.current;
    if (!node) return;
    stick.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < STICK_PX;
  };

  const canRetry = Boolean(messaging?.canReply);

  return (
    <>
      {/* Метка — на канве над панелью и с переключателем в `action`, как у
          любой секции страницы */}
      <Eyebrow
        action={
          <Segmented
            ariaLabel="Что показывать в хронике"
            options={[
              { value: "comments", label: "Переписка" },
              { value: "all", label: "Всё" },
            ]}
            value={mode}
            onChange={setMode}
          />
        }
      >
        Хроника
      </Eyebrow>

      {/* Панель по высоте ленты, но не выше экрана: длинная лента листается
          внутри, поле ответа прижато к низу */}
      <div className="flex max-h-[max(24rem,calc(100dvh-186px))] flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div
          ref={scroller}
          onScroll={onScroll}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            isMobile ? "p-3" : "px-5 pt-3 pb-4",
          )}
        >
          <div className="flex min-h-full flex-col justify-end">
            {rows.length === 0 && (
              <p className="m-auto text-center text-sm text-muted-foreground">
                {mode === "comments"
                  ? "Переписки пока нет"
                  : "По заявке пока ничего не происходило"}
              </p>
            )}
            {rows.map((row) => {
              if (row.type === "day") {
                return (
                  <div
                    key={row.key}
                    className="flex items-center gap-2.5 pt-3 pb-1 text-xs font-bold tracking-wider text-faint uppercase first:pt-0"
                  >
                    {row.label}
                    <span aria-hidden className="h-px flex-1 bg-border-soft" />
                  </div>
                );
              }
              if (row.type === "new") {
                return (
                  <div
                    key={row.key}
                    ref={divider}
                    className="flex items-center gap-2.5 pt-3 pb-1 text-xs font-bold tracking-wider text-accent-text uppercase"
                  >
                    Новые
                    <span className="font-semibold tracking-normal tabular-nums">
                      · {row.count}
                    </span>
                    <span aria-hidden className="h-px flex-1 bg-primary/35" />
                  </div>
                );
              }
              if (row.type === "event") {
                return (
                  <EventLine
                    key={row.key}
                    event={row.event}
                    ticketNum={ticket.num}
                  />
                );
              }
              return (
                <Bubble
                  key={row.key}
                  row={row}
                  viewer={viewer}
                  canRetry={canRetry}
                  onRetried={markRetried}
                  // Отправитель может оказаться сотрудником без учётки HD —
                  // его контакты клиенту не показываем нигде (как и в
                  // Ticket/View/Sections#mailSender), поэтому realSender идёт
                  // только сотруднику
                  realSender={viewer.isClient ? "" : ticket.realSender}
                />
              );
            })}
          </div>
        </div>

        {canComment && (
          <form
            onSubmit={submit}
            className={cn(
              "flex-none border-t border-border-soft",
              isMobile ? "px-3 pt-2 pb-3" : "px-4 py-3",
            )}
          >
            <Textarea
              ref={textarea}
              rows={2}
              value={content}
              aria-label={viewer.isClient ? "Сообщение" : "Комментарий"}
              placeholder={
                viewer.isClient ? "Написать сообщение…" : "Написать комментарий…"
              }
              onChange={(changeEvent) => setContent(changeEvent.target.value)}
              // Поле растёт с текстом, но ленту не съедает: потолок — 160 px
              // на десктопе и 128 на телефоне (канва: 64 и 56 px пустым)
              className={cn(
                "resize-none",
                isMobile ? "max-h-32 min-h-14 text-base leading-5" : "max-h-40",
              )}
            />
            <div className="mt-2 flex items-center gap-2">
              {showRoutes && (
                <ReplyRoute data={routes} value={route} onChange={pickRoute} />
              )}
              <input
                ref={fileInput}
                id={fileInputId}
                type="file"
                multiple
                className="hidden"
                onChange={(changeEvent) =>
                  setFiles([...(changeEvent.target.files ?? [])])
                }
              />
              {isMobile ? (
                // Телефон (канва D6, D8): ряд короче — файл и отправка значками
                <Button
                  asChild
                  variant="outline"
                  size="icon-sm"
                  className="relative"
                >
                  <label
                    htmlFor={fileInputId}
                    aria-label="Файл"
                    className="cursor-pointer"
                  >
                    <RiAttachment2 />
                    {files.length > 0 && (
                      <span className="absolute -top-1 -right-1 inline-grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-xs leading-4 font-bold text-primary-foreground">
                        {files.length}
                      </span>
                    )}
                  </label>
                </Button>
              ) : (
                <Button asChild variant="outline" size="xs">
                  <label htmlFor={fileInputId} className="cursor-pointer">
                    <RiAttachment2 />
                    {files.length > 0 ? `Файлов: ${files.length}` : "Файл"}
                  </label>
                </Button>
              )}
              {isMobile ? (
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label="Отправить"
                  className="ms-auto"
                  disabled={isLoading || !content.trim()}
                >
                  <RiSendPlaneLine />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="xs"
                  className="ms-auto"
                  disabled={isLoading || !content.trim()}
                >
                  <RiSendPlaneLine />
                  {isLoading ? "Отправка…" : "Отправить"}
                </Button>
              )}
            </div>
            {/* Без строки отказ выглядел как «ничего не произошло»: кнопка
                отжималась, текст оставался, и человек не знал, ушёл ли он.
                Сбрасывается следующей отправкой (useHttp) */}
            {error && (
              <p className="mt-2 mb-0 text-sm text-destructive">
                {error.status === 409 && serverMessage
                  ? serverMessage
                  : sendErrorText(error.status)}
              </p>
            )}
          </form>
        )}
      </div>
    </>
  );
};

// Текст отказа — по коду, а не из ответа: у 500 и валидации сообщение служебное
// и английское, а у 403 оно про «просмотр страницы». Без кода — обрыв сети или
// не-JSON ответ (например, nginx на слишком большой файл)
const sendErrorText = (status) => {
  if (status === 403) return "Нет прав писать в эту заявку.";
  if (status === 404) return "Заявка не найдена: возможно, её удалили.";
  return "Не удалось отправить комментарий. Текст остался в поле — попробуйте ещё раз.";
};

export default Chronicle;
