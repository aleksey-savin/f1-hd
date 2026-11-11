import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RiArrowDownLine, RiHistoryLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import Segmented from "@/components/app/Segmented";
import { Checkbox } from "@/components/ui/checkbox";
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
  viewKey = conversationId,
  renderActions,
  firstUnreadId,
  selectedMessageIds,
  onSelectMessage,
  showAll = false,
  onShowAllChange,
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
  canRetry: boolean | ((message: MessageRow) => boolean);
  onRetry: (id: string) => void;
  className?: string;
  viewKey?: string;
  renderActions?: (message: MessageRow) => ReactNode;
  firstUnreadId?: string;
  selectedMessageIds?: string[];
  onSelectMessage?: (id: string, selected: boolean) => void;
  showAll?: boolean;
  onShowAllChange?: (value: boolean) => void;
}) => {
  const now = useMinuteTick();
  const rows = useMemo(
    () => threadRows(messages, { kind, timeZone, now }),
    [messages, kind, timeZone, now],
  );
  const scroller = useRef<HTMLDivElement | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
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
    if (previous.conversationId !== viewKey) {
      node.scrollTop = node.scrollHeight;
    } else if (previous.firstId !== firstId && previous.lastId === lastId) {
      // Приехала история сверху — держим то, что человек видел
      node.scrollTop += node.scrollHeight - previous.height;
    } else if (previous.lastId !== lastId && previous.nearBottom) {
      node.scrollTop = node.scrollHeight;
    }
    snapshot.current = {
      conversationId: viewKey,
      firstId,
      lastId,
      height: node.scrollHeight,
      nearBottom:
        node.scrollHeight - node.scrollTop - node.clientHeight < STICK_PX,
    };
  }, [viewKey, messages]);

  const onScroll = () => {
    const node = scroller.current;
    if (!node) return;
    snapshot.current.nearBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight < STICK_PX;
    snapshot.current.height = node.scrollHeight;
    setNearBottom(snapshot.current.nearBottom);
  };

  // Строка неопознанного собеседника — после первой метки дня
  let noteShown = false;

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      {onShowAllChange && (
        <div className="flex-none border-b border-border-soft bg-card px-3 py-2">
          <Segmented
            ariaLabel="Просмотр переписки"
            value={showAll ? "all" : "context"}
            onChange={(value) => onShowAllChange(value === "all")}
            options={[
              { value: "context", label: "Текущая тема" },
              { value: "all", label: "Вся история", icon: <RiHistoryLine aria-hidden /> },
            ]}
            className="w-full [&_button]:min-h-11"
          />
        </div>
      )}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain"
      >
        <div
          className={cn(
            "mt-auto flex shrink-0 flex-col",
            compact ? "px-3 pt-3 pb-3" : "px-5 pt-3 pb-4",
          )}
        >
          {hasOlder && (
            <div className="mb-2 text-center">
              <Button
                variant="outline"
                size="sm"
                className="bg-card pointer-coarse:min-h-11"
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
                <SystemLine
                  key={row.key}
                  message={row.message}
                  compact={compact}
                />
              );
            }
            return (
              <div key={row.key}>
                {row.message.id === firstUnreadId && (
                  <div className="my-2 flex items-center gap-2 text-xs font-semibold text-accent-text">
                    Новые
                    <span className="h-px flex-1 bg-primary/30" />
                  </div>
                )}
                <div className="flex items-start gap-2">
                  {onSelectMessage && (
                    <Checkbox
                      className="mt-4"
                      disabled={Boolean(row.message.deletedAt)}
                      aria-label={`Выбрать сообщение: ${row.message.text || "Вложение"}`}
                      checked={
                        selectedMessageIds?.includes(row.message.id) || false
                      }
                      onCheckedChange={(value) =>
                        onSelectMessage(row.message.id, value === true)
                      }
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <MessageBubble
                      message={row.message}
                      side={row.side}
                      gap={row.gap}
                      showAuthor={row.showAuthor}
                      showName={row.showName}
                      group={kind === "group"}
                      compact={compact}
                      timeZone={timeZone}
                      canRetry={typeof canRetry === "function" ? canRetry(row.message) : canRetry}
                      onRetry={onRetry}
                      actions={renderActions?.(row.message)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          {!rows.length && (
            <p className="my-6 text-center text-sm text-muted-foreground">
              Сообщений пока нет
            </p>
          )}
        </div>
      </div>
      {!nearBottom && (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="absolute right-3 bottom-3 rounded-full bg-card shadow-md"
          aria-label="К последним сообщениям"
          onClick={() => {
            const node = scroller.current;
            if (node) node.scrollTop = node.scrollHeight;
            setNearBottom(true);
          }}
        >
          <RiArrowDownLine />
        </Button>
      )}
    </div>
  );
};

export default MessagesPane;
