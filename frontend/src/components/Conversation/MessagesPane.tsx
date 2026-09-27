import { useLayoutEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import useMinuteTick from "@/hooks/use-minute-tick";
import { cn } from "@/lib/utils";
import type { ConversationKind, MessageRow } from "@/types/conversation";
import { threadRows } from "@/util/conversation-thread";

import MessageBubble from "./MessageBubble";
import SystemLine from "./SystemLine";

// Ближе к низу, чем столько px, — человек читает последнее, и новое
// сообщение прокручивает ленту само; выше — читает историю, не мешаем
const STICK_PX = 80;

/**
 * Лента диалога: старые сверху, новые снизу, у короткой ленты сообщения
 * прижаты к полю ответа (канва A1). Своя прокрутка; «Показать раньше» —
 * страница истории, без прыжка ленты.
 */
const MessagesPane = ({
  conversationId,
  messages,
  kind,
  timeZone,
  compact = false,
  note,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  canRetry,
  onRetry,
  className,
}: {
  conversationId: string;
  messages: MessageRow[];
  kind: ConversationKind;
  timeZone: string;
  compact?: boolean;
  /** Строка перед первым сообщением (неопознанный собеседник, канва C2). */
  note?: string;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  canRetry: boolean;
  onRetry: (id: string) => void;
  className?: string;
}) => {
  const now = useMinuteTick();
  const rows = useMemo(
    () => threadRows(messages, { kind, timeZone, now }),
    [messages, kind, timeZone, now],
  );
  const scroller = useRef<HTMLDivElement | null>(null);
  const snapshot = useRef({
    conversationId: "",
    firstId: "",
    lastId: "",
    height: 0,
    nearBottom: true,
  });

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const previous = snapshot.current;
    const firstId = messages[0]?.id ?? "";
    const lastId = messages[messages.length - 1]?.id ?? "";
    if (previous.conversationId !== conversationId) {
      node.scrollTop = node.scrollHeight;
    } else if (previous.firstId !== firstId && previous.lastId === lastId) {
      // Приехала история сверху — держим то, что человек видел
      node.scrollTop += node.scrollHeight - previous.height;
    } else if (previous.lastId !== lastId && previous.nearBottom) {
      node.scrollTop = node.scrollHeight;
    }
    snapshot.current = {
      conversationId,
      firstId,
      lastId,
      height: node.scrollHeight,
      nearBottom:
        node.scrollHeight - node.scrollTop - node.clientHeight < STICK_PX,
    };
  }, [conversationId, messages]);

  const onScroll = () => {
    const node = scroller.current;
    if (!node) return;
    snapshot.current.nearBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight < STICK_PX;
    snapshot.current.height = node.scrollHeight;
  };

  // Строка неопознанного собеседника — после первой метки дня
  let noteShown = false;

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}
    >
      <div
        className={cn(
          "mt-auto flex flex-col",
          compact ? "px-3 pt-3 pb-3" : "px-5 pt-3 pb-4",
        )}
      >
        {hasOlder && (
          <div className="mb-2 text-center">
            <Button
              variant="ghost"
              size="xs"
              disabled={loadingOlder}
              onClick={onLoadOlder}
            >
              {loadingOlder ? "Загрузка…" : "Показать раньше"}
            </Button>
          </div>
        )}
        {rows.map((row) => {
          if (row.type === "day") {
            const withNote = Boolean(note) && !noteShown;
            noteShown = noteShown || withNote;
            return (
              <div key={row.key}>
                <div className="flex items-center gap-2.5 py-1 text-xs font-bold tracking-wider text-faint uppercase">
                  {row.label}
                  <span aria-hidden className="h-px flex-1 bg-border-soft" />
                </div>
                {withNote && <SystemLine note={note} />}
              </div>
            );
          }
          if (row.type === "system") {
            return (
              <SystemLine key={row.key} message={row.message} compact={compact} />
            );
          }
          return (
            <MessageBubble
              key={row.key}
              message={row.message}
              side={row.side}
              gap={row.gap}
              showAuthor={row.showAuthor}
              showName={row.showName}
              group={kind === "group"}
              compact={compact}
              timeZone={timeZone}
              canRetry={canRetry}
              onRetry={onRetry}
            />
          );
        })}
        {!rows.length && (
          <p className="my-6 text-center text-sm text-muted-foreground">
            Сообщений пока нет
          </p>
        )}
      </div>
    </div>
  );
};

export default MessagesPane;
