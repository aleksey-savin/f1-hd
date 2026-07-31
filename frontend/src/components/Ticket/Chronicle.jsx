import { useContext, useEffect, useRef, useState } from "react";

import { RiAttachment2, RiSendPlaneLine } from "react-icons/ri";

import Segmented from "@/components/app/Segmented";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import useHttp from "../../hooks/use-http";
import { AuthedUserContext } from "../../store/authed-user-context";
import useViewTicketStore from "../../store/view-ticket";
import { getLocalStorageData } from "../../util/auth";
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

const ENTRY = "tw:flex tw:gap-2.5 tw:py-3";

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
    className="tw:mt-1.5 tw:me-1.5 tw:inline-flex tw:max-w-full tw:items-center tw:gap-1.5 tw:rounded-lg tw:border tw:border-border tw:px-2 tw:py-1 tw:text-xs tw:text-muted-foreground tw:no-underline tw:hover:bg-accent"
  >
    <RiAttachment2 size={13} aria-hidden />
    <span className="tw:truncate">
      {attachment.originalName || attachment.name}
    </span>
  </a>
);

const CommentEntry = ({ comment, divided }) => {
  const [showQuoted, setShowQuoted] = useState(false);
  const author = comment.createdBy;

  return (
    <div className={cn(ENTRY, divided && "tw:border-t tw:border-border-soft")}>
      <span className="tw:grid tw:size-7 tw:flex-none tw:place-items-center tw:rounded-full tw:border tw:border-border tw:bg-accent tw:text-xs tw:font-semibold tw:text-muted-foreground">
        {initials(author)}
      </span>
      <div className="tw:min-w-0 tw:flex-1">
        <div className="tw:flex tw:items-baseline tw:gap-2 tw:text-sm">
          <b className="tw:font-semibold">{personName(author) || "—"}</b>
          <span
            className="tw:ms-auto tw:flex-none tw:text-xs tw:text-faint tw:tabular-nums"
            title={formatDate(comment.createdAt)}
          >
            {formatTime(comment.createdAt)}
          </span>
        </div>
        <p className="tw:my-0.5 tw:text-sm tw:leading-relaxed tw:whitespace-pre-wrap">
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
              className="tw:mt-1 tw:cursor-pointer tw:appearance-none tw:border-0 tw:bg-transparent tw:p-0 tw:text-xs tw:text-faint tw:hover:text-muted-foreground"
            >
              {showQuoted
                ? "▾ Скрыть цитируемую переписку"
                : "▸ Показать цитируемую переписку"}
            </button>
            {showQuoted && (
              <p className="tw:mt-1 tw:mb-0 tw:border-s tw:border-border tw:ps-3 tw:text-xs tw:whitespace-pre-wrap tw:text-muted-foreground">
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
    const { token } = getLocalStorageData();
    const params = new URLSearchParams();
    if (event.technical.from) params.set("from", event.technical.from);
    if (event.technical.to) params.set("to", event.technical.to);
    sendRequest(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticketNum}/log?${params}`,
        headers: { Authorization: "Bearer " + token },
      },
      (data) => setEntries(data.entries ?? []),
    );
  };

  return (
    <div className={cn(ENTRY, divided && "tw:border-t tw:border-border-soft")}>
      <span
        className={cn(
          "tw:grid tw:size-7 tw:flex-none tw:place-items-center tw:rounded-full tw:border",
          EVENT_TONE_CLASS[meta.tone],
        )}
      >
        <Icon size={15} aria-hidden />
      </span>
      <div className="tw:min-w-0 tw:flex-1">
        <div className="tw:flex tw:items-baseline tw:gap-2 tw:text-sm">
          <b className="tw:font-semibold">{eventLabel(event)}</b>
          <span
            className="tw:ms-auto tw:flex-none tw:text-xs tw:text-faint tw:tabular-nums"
            title={formatDate(event.createdAt)}
          >
            {formatTime(event.createdAt)}
          </span>
        </div>
        {personName(event.user) && (
          <div className="tw:text-xs tw:text-muted-foreground">
            {personName(event.user)}
          </div>
        )}

        {/* Файлы события — чипами: по ним файл открывается прямо из ленты, не
            возвращаясь к описанию. Больше двух сворачиваем, как везде */}
        {event.files?.length > 0 && event.kind !== "attachmentRemoved" && (
          <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:gap-1.5">
            {event.files.slice(0, 2).map((file) => (
              <AttachmentChip key={file.name} attachment={file} compact />
            ))}
            {event.files.length > 2 && (
              <span className="tw:self-center tw:text-xs tw:text-faint">
                ещё {event.files.length - 2}
              </span>
            )}
          </div>
        )}
        {event.kind === "attachmentRemoved" && event.files?.[0] && (
          // Удалённый файл не открыть — только назвать
          <div className="tw:mt-1 tw:text-xs tw:text-faint">
            «{event.files[0].originalName || event.files[0].name}»
          </div>
        )}

        {summary && (
          <>
            <button
              type="button"
              onClick={expand}
              className={cn(
                "tw:mt-1.5 tw:inline-flex tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-1 tw:border-0 tw:bg-transparent tw:p-0 tw:text-xs tw:hover:underline",
                event.technical.failed > 0
                  ? "tw:text-warning"
                  : "tw:text-faint",
              )}
            >
              {expanded ? "▾" : "▸"} {summary}
            </button>
            {expanded && (
              <ul className="tw:mt-1.5 tw:mb-0 tw:list-none tw:space-y-1 tw:border-s tw:border-border tw:ps-3">
                {(entries ?? []).map((entry) => (
                  <li
                    key={entry._id}
                    className="tw:text-xs tw:text-muted-foreground"
                  >
                    <span className="tw:text-faint tw:tabular-nums">
                      {formatTime(entry.createdAt)}
                    </span>{" "}
                    {entry.event}
                  </li>
                ))}
                {entries?.length === 0 && (
                  <li className="tw:text-xs tw:text-faint">Записей нет</li>
                )}
                {!entries && (
                  <li className="tw:text-xs tw:text-faint">Загрузка…</li>
                )}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
};

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

    const { token } = getLocalStorageData();
    sendRequest(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/comments/add/`,
        method: "POST",
        headers: { Authorization: "Bearer " + token },
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
    <div className="tw:flex tw:max-h-[calc(100dvh-160px)] tw:flex-col tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card">
      <div className="tw:flex tw:items-center tw:gap-2 tw:border-b tw:border-border-soft tw:px-4 tw:py-2.5">
        <span className="tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
          Хроника
        </span>
        <span className="tw:ms-auto">
          <Segmented
            ariaLabel="Что показывать в хронике"
            options={[
              { value: "comments", label: "Переписка" },
              { value: "all", label: "Всё" },
            ]}
            value={mode}
            onChange={setMode}
          />
        </span>
      </div>

      {canComment && (
        <form
          onSubmit={submit}
          className="tw:border-b tw:border-border-soft tw:px-4 tw:py-3"
        >
          <Textarea
            ref={textarea}
            rows={2}
            value={content}
            placeholder="Написать комментарий…"
            onChange={(changeEvent) => setContent(changeEvent.target.value)}
          />
          <div className="tw:mt-2 tw:flex tw:items-center tw:gap-2">
            <input
              ref={fileInput}
              id="chronicle-files"
              type="file"
              multiple
              className="tw:hidden"
              onChange={(changeEvent) =>
                setFiles([...(changeEvent.target.files ?? [])])
              }
            />
            <Button asChild variant="outline" size="xs">
              <label htmlFor="chronicle-files" className="tw:cursor-pointer">
                <RiAttachment2 />
                {files.length > 0 ? `Файлов: ${files.length}` : "Файл"}
              </label>
            </Button>
            <Button
              type="submit"
              size="xs"
              className="tw:ms-auto"
              disabled={isLoading || !content.trim()}
            >
              <RiSendPlaneLine />
              {isLoading ? "Отправка…" : "Отправить"}
            </Button>
          </div>
        </form>
      )}

      <div className="tw:flex-1 tw:overflow-y-auto tw:px-4 tw:pb-3">
        {feed.length === 0 && (
          <p className="tw:my-6 tw:text-center tw:text-sm tw:text-muted-foreground">
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
                <div className="tw:flex tw:items-center tw:gap-2.5 tw:pt-3 tw:pb-1 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
                  {dayLabel(item.at)}
                  <span className="tw:h-px tw:flex-1 tw:bg-border-soft" />
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
