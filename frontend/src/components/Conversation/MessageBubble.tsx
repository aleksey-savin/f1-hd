import {
  RiCheckboxLine,
  RiCheckDoubleLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiTimeLine,
} from "react-icons/ri";
import { Link } from "react-router";

import { cn } from "@/lib/utils";
import type { MessageRow } from "@/types/conversation";
import { timeOf } from "@/util/conversation-format";

import {
  FileAttachment,
  PhotoAttachment,
  VoiceAttachment,
  isPhotoMessage,
} from "./MessageMedia";

/**
 * Пузырь сообщения — мессенджерный порядок (решение владельца 24.09, канва A1,
 * вариант A): входящие слева на сером, наши справа на бирюзовом, время и
 * статус доставки в углу. Цитата — полосой сверху; номер заявки («№56801») —
 * только в группе, где сообщения разных заявок идут вперемешку.
 */

const StatusIcon = ({ status }: { status: MessageRow["status"] }) => {
  switch (status) {
    case "read":
      return (
        <span className="flex text-accent-text" title="Прочитано">
          <RiCheckDoubleLine size={16} aria-label="Прочитано" />
        </span>
      );
    case "delivered":
      return (
        <span className="flex" title="Доставлено">
          <RiCheckDoubleLine size={16} aria-label="Доставлено" />
        </span>
      );
    case "sent":
      return (
        <span className="flex" title="Отправлено">
          <RiCheckLine size={14} aria-label="Отправлено" />
        </span>
      );
    case "failed":
      return (
        <span className="flex text-destructive" title="Не доставлено">
          <RiErrorWarningLine size={14} aria-label="Не доставлено" />
        </span>
      );
    default:
      return (
        <span className="flex" title="В очереди">
          <RiTimeLine size={13} aria-label="В очереди" />
        </span>
      );
  }
};

const Body = ({
  message,
  compact,
}: {
  message: MessageRow;
  compact: boolean;
}) => {
  if (message.deletedAt) {
    return <p className="my-0 text-faint italic">Сообщение удалено</p>;
  }
  const photo = isPhotoMessage(message.kind, message.attachments);
  // Анкета формы сайта (карточка — P5): поля строками «Имя: …»
  const text =
    message.text ||
    (message.form?.fields ?? [])
      .map((field) => `${field.label}: ${field.value}`)
      .join("\n");
  return (
    <>
      {message.replyTo && (
        <div className="mb-1.5 border-l-2 border-primary/35 py-0.5 pl-2 text-xs">
          <div className="font-semibold text-accent-text">
            {message.replyTo.authorName}
          </div>
          <div
            className={cn(
              "truncate text-muted-foreground",
              compact ? "max-w-55" : "max-w-75",
            )}
          >
            {message.replyTo.text}
          </div>
        </div>
      )}
      {photo &&
        message.attachments.map((attachment, index) => (
          <PhotoAttachment
            key={`${attachment.name}-${index}`}
            attachment={attachment}
            kind="photo"
            compact={compact}
          />
        ))}
      {message.kind === "voice" &&
        message.attachments.map((attachment, index) => (
          <VoiceAttachment
            key={`${attachment.name}-${index}`}
            attachment={attachment}
            compact={compact}
          />
        ))}
      {text && (
        <p className={cn("my-0 whitespace-pre-wrap break-words", photo && "px-2 pt-1.5")}>
          {text}
        </p>
      )}
      {!photo &&
        message.kind !== "voice" &&
        message.attachments.map((attachment, index) => (
          <FileAttachment
            key={`${attachment.name}-${index}`}
            attachment={attachment}
            kind={message.kind}
          />
        ))}
    </>
  );
};

const MessageBubble = ({
  message,
  side,
  gap,
  showAuthor,
  showName,
  group,
  compact = false,
  timeZone,
  canRetry,
  onRetry,
}: {
  message: MessageRow;
  side: "in" | "out";
  gap: number;
  showAuthor: boolean;
  showName: boolean;
  group: boolean;
  compact?: boolean;
  timeZone: string;
  canRetry: boolean;
  onRetry: (id: string) => void;
}) => {
  const photo = !message.deletedAt && isPhotoMessage(message.kind, message.attachments);
  const time = (
    <div
      className={cn(
        "mt-0.5 flex items-center justify-end gap-1 text-xs text-faint tabular-nums",
        photo && "px-2",
      )}
    >
      {message.editedAt && !message.deletedAt && <span>изменено</span>}
      {timeOf(message.sentAt, timeZone)}
      {side === "out" && <StatusIcon status={message.status} />}
    </div>
  );

  return (
    <div
      className={cn("flex", side === "out" ? "justify-end" : "justify-start")}
      style={{ marginTop: gap }}
    >
      <div className={compact ? "max-w-72.5" : "max-w-105"}>
        {showAuthor && (
          <div className="mr-1 mb-0.5 text-right text-xs text-muted-foreground">
            {message.author.name}
          </div>
        )}
        {showName && (
          <div className="mb-0.5 ml-1 text-xs font-semibold">
            {message.author.name}
          </div>
        )}
        <div
          className={cn(
            "text-sm text-foreground",
            side === "out"
              ? "rounded-[14px] rounded-br-sm bg-bubble-out"
              : "rounded-[14px] rounded-bl-sm bg-bubble-in",
            photo ? "p-1 pb-1.5" : "px-3 pt-2 pb-1.5",
          )}
        >
          <Body message={message} compact={compact} />
          {time}
        </div>
        {group && message.ticket && (
          <div className="mt-1 ml-1">
            <Link
              to={`/tickets/${message.ticket.num}`}
              className="inline-flex h-5 items-center gap-1 rounded-md bg-accent px-1.75 text-xs font-semibold text-muted-foreground no-underline hover:text-foreground"
            >
              <RiCheckboxLine size={12} aria-hidden />№{message.ticket.num}
            </Link>
          </div>
        )}
        {side === "out" && message.status === "failed" && (
          <div className="mt-1 mr-1 flex items-center justify-end gap-2 text-xs text-destructive">
            {/* Сырой текст ошибки шлюза — сотруднику во всплывающей подсказке */}
            <span title={message.error || undefined}>Не доставлено</span>
            {canRetry && (
              <button
                type="button"
                onClick={() => onRetry(message.id)}
                className="cursor-pointer appearance-none border-0 bg-transparent p-0 font-semibold text-destructive underline-offset-2 hover:underline"
              >
                Повторить
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
