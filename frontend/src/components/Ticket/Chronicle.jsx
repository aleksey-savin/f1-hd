import { useContext, useEffect, useRef, useState } from "react";

import { RiAttachment2, RiSendPlaneLine } from "react-icons/ri";

import { Eyebrow } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import useHttp from "../../hooks/use-http";
import { AuthedUserContext } from "../../store/authed-user-context";
import useViewTicketStore from "../../store/view-ticket";
import {
  businessDayKey,
  formatDate,
  formatDayMonthLong,
  formatTime,
} from "../../util/format-date";
import {
  EVENT_TONE_CLASS,
  eventLabel,
  eventMeta,
  technicalSummary,
} from "../../util/ticket-events";
import AttachmentChip from "./View/AttachmentChip";

/**
 * Хроника заявки — переписка и события одной лентой.
 *
 * Раньше комментарии жили в правой колонке, а события — во вкладке «Лог», и
 * связь «взял в работу → написал» приходилось восстанавливать по времени. Плюс
 * лог был нечитаем: у живой заявки 1506 записей, из них 1476 — «при отправке
 * email-уведомления». Служебные записи бэкенд сворачивает в счётчик под своим
 * событием (см. services/ticketEvents.js), а лента показывает только то, что
 * произошло с заявкой.
 *
 * Порядок — новыми вверх, поле ввода сверху: чаще нужно последнее, а не первое.
 */

const ENTRY = "flex gap-2.5 py-3";

const initials = (person) =>
  `${person?.lastName?.[0] ?? ""}${person?.firstName?.[0] ?? ""}`.toUpperCase() ||
  "?";

const personName = (person) =>
  person ? `${person.lastName || ""} ${person.firstName || ""}`.trim() : "";

const Attachment = ({ attachment }) => (
  <a
    href={`${import.meta.env.VITE_API_ADDRESS}/uploads/${attachment.name}`}
    target="_blank"
    rel="noreferrer"
    className="mt-1.5 me-1.5 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground no-underline hover:bg-accent"
  >
    <RiAttachment2 size={13} aria-hidden />
    <span className="truncate">
      {attachment.originalName || attachment.name}
    </span>
  </a>
);

const CommentEntry = ({ comment, divided }) => {
  const [showQuoted, setShowQuoted] = useState(false);
  const author = comment.createdBy;

  return (
    <div className={cn(ENTRY, divided && "border-t border-border-soft")}>
      <span className="grid size-7 flex-none place-items-center rounded-[25%] border border-border bg-accent text-xs font-semibold text-muted-foreground">
        {initials(author)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-sm">
          <b className="font-semibold">{personName(author) || "—"}</b>
          <span
            className="ms-auto flex-none text-xs text-faint tabular-nums"
            title={formatDate(comment.createdAt)}
          >
            {formatTime(comment.createdAt)}
          </span>
        </div>
        <p className="my-0.5 text-sm leading-relaxed whitespace-pre-wrap">
          {comment.content}
        </p>
        {comment.attachments?.map((attachment) => (
          <Attachment key={attachment.name} attachment={attachment} />
        ))}
        {comment.quotedText && (
          <>
            <button
              type="button"
              onClick={() => setShowQuoted((value) => !value)}
              className="mt-1 cursor-pointer appearance-none border-0 bg-transparent p-0 text-xs text-faint hover:text-muted-foreground"
            >
              {showQuoted
                ? "▾ Скрыть цитируемую переписку"
                : "▸ Показать цитируемую переписку"}
            </button>
            {showQuoted && (
              <p className="mt-1 mb-0 border-s border-border ps-3 text-xs whitespace-pre-wrap text-muted-foreground">
                {comment.quotedText}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const EventEntry = ({ event, ticketNum, divided }) => {
  const meta = eventMeta(event.kind);
  const Icon = meta.icon;
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState(null);
  const { sendRequest } = useHttp();
  const summary = technicalSummary(event.technical);

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
    <div className={cn(ENTRY, divided && "border-t border-border-soft")}>
      <span
        className={cn(
          "grid size-7 flex-none place-items-center rounded-full border",
          EVENT_TONE_CLASS[meta.tone],
        )}
      >
        <Icon size={15} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-sm">
          <b className="font-semibold">{eventLabel(event)}</b>
          <span
            className="ms-auto flex-none text-xs text-faint tabular-nums"
            title={formatDate(event.createdAt)}
          >
            {formatTime(event.createdAt)}
          </span>
        </div>
        {personName(event.user) && (
          <div className="text-xs text-muted-foreground">
            {personName(event.user)}
          </div>
        )}

        {/* Файлы события — чипами: по ним файл открывается прямо из ленты, не
            возвращаясь к описанию. Больше двух сворачиваем, как везде */}
        {event.files?.length > 0 && event.kind !== "attachmentRemoved" && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
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
          <div className="mt-1 text-xs text-faint">
            «{event.files[0].originalName || event.files[0].name}»
          </div>
        )}

        {summary && (
          <>
            <button
              type="button"
              onClick={expand}
              className={cn(
                "mt-1.5 inline-flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 text-xs hover:underline",
                event.technical.failed > 0 ? "text-warning" : "text-faint",
              )}
            >
              {expanded ? "▾" : "▸"} {summary}
            </button>
            {expanded && (
              <ul className="mt-1.5 mb-0 list-none space-y-1 border-s border-border ps-3">
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
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Лента рисует то, что приехало: какие события положены заявителю, решает
 * бэкенд (`services/ticketEvents` → `feedForClient`). Невидимое в интерфейсе,
 * но уехавшее в ответ — всё равно выданное, поэтому отбора здесь нет.
 */
const Chronicle = ({ ticket, events = [], canComment }) => {
  const { comments, updateComments } = useViewTicketStore();
  const authedUser = useContext(AuthedUserContext);
  const { sendRequest, isLoading } = useHttp();

  const [mode, setMode] = useState("comments");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState([]);
  const fileInput = useRef(null);
  const textarea = useRef(null);

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

    sendRequest(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/comments/add/`,
        method: "POST",
        isFormData: true,
        body: formData,
      },
      (data) => {
        if (!data.comment) return;
        setContent("");
        setFiles([]);
        if (fileInput.current) fileInput.current.value = "";
        updateComments([
          {
            ...data.comment,
            createdBy: {
              _id: authedUser._id,
              lastName: authedUser.lastName,
              firstName: authedUser.firstName,
              profileImagePath: authedUser.profileImagePath,
            },
          },
          ...comments,
        ]);
      },
    );
  };

  // Одна лента: комментарии и события сортируются вместе, новыми вверх
  const feed = [
    ...comments.map((comment) => ({
      type: "comment",
      at: comment.createdAt,
      key: `c-${comment._id}`,
      comment,
    })),
    ...(mode === "all"
      ? events.map((event) => ({
          type: "event",
          at: event.createdAt,
          key: `e-${event._id}`,
          event,
        }))
      : []),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  let lastDay = null;

  return (
    <>
      {/* Метка — на канве над панелью и с переключателем в `action`, как у
          любой секции страницы. Своей титульной полосы внутри панели у хроники
          больше нет: она была единственным таким заголовком на карточке, а
          панели при её высоте дорог каждый ряд */}
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

      <div className="flex max-h-[calc(100dvh-186px)] flex-col overflow-hidden rounded-xl border border-border bg-card">
        {canComment && (
          <form
            onSubmit={submit}
            className="border-b border-border-soft px-4 py-3"
          >
            <Textarea
              ref={textarea}
              rows={2}
              value={content}
              placeholder="Написать комментарий…"
              onChange={(changeEvent) => setContent(changeEvent.target.value)}
            />
            <div className="mt-2 flex items-center gap-2">
              <input
                ref={fileInput}
                id="chronicle-files"
                type="file"
                multiple
                className="hidden"
                onChange={(changeEvent) =>
                  setFiles([...(changeEvent.target.files ?? [])])
                }
              />
              <Button asChild variant="outline" size="xs">
                <label htmlFor="chronicle-files" className="cursor-pointer">
                  <RiAttachment2 />
                  {files.length > 0 ? `Файлов: ${files.length}` : "Файл"}
                </label>
              </Button>
              <Button
                type="submit"
                size="xs"
                className="ms-auto"
                disabled={isLoading || !content.trim()}
              >
                <RiSendPlaneLine />
                {isLoading ? "Отправка…" : "Отправить"}
              </Button>
            </div>
          </form>
        )}

        <div className="flex-1 overflow-y-auto px-4 pb-3">
          {feed.length === 0 && (
            <p className="my-6 text-center text-sm text-muted-foreground">
              {mode === "comments"
                ? "Переписки пока нет"
                : "По заявке пока ничего не происходило"}
            </p>
          )}
          {feed.map((item) => {
            const day = businessDayKey(item.at);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={item.key}>
                {showDay && (
                  <div className="flex items-center gap-2.5 pt-3 pb-1 text-xs font-bold tracking-wider text-faint uppercase">
                    {dayLabel(item.at)}
                    <span className="h-px flex-1 bg-border-soft" />
                  </div>
                )}
                {/* Разделитель между записями — только внутри дня: у первой
                  записи его роль играет линия самой метки дня */}
                {item.type === "comment" ? (
                  <CommentEntry comment={item.comment} divided={!showDay} />
                ) : (
                  <EventEntry
                    event={item.event}
                    ticketNum={ticket.num}
                    divided={!showDay}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

// «Сегодня» / «Вчера» / «27 июля» — метка дня над группой записей
const dayLabel = (date) => {
  const today = businessDayKey();
  const day = businessDayKey(date);
  if (day === today) return "Сегодня";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === businessDayKey(yesterday)) return "Вчера";
  return formatDayMonthLong(date);
};

export default Chronicle;
