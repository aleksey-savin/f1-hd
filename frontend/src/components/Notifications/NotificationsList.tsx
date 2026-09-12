import { Link } from "react-router";

import { cn } from "@/lib/utils";
import useNotificationsStore from "@/store/notifications";
import type { NotificationItem } from "@/types/notification";
import { formatAgo } from "@/util/format-date";
import {
  actorInitials,
  actorName,
  notificationContext,
  notificationMeta,
  toneClass,
} from "@/util/notification-meta";

/**
 * Строки колокольчика — анатомия хроники: плитка с инициалами у комментария,
 * кружок с тоном у события; жирная строка, время, ниже текст и контекст
 * («№ заявки · тема»). Непрочитанная — основным цветом и точкой после
 * времени, прочитанная — приглушённая. Клик ведёт по ссылке строки и сразу
 * гасит её непрочитанность.
 */
type RowProps = {
  item: NotificationItem;
  first: boolean;
  onNavigate: () => void;
};

// Единственный комментарий с особым заголовком — ответ в закрытую заявку: в
// строке он становится предупреждением в контексте, а жирной строкой
// остаётся автор, как в хронике
const NEW_COMMENT_TITLE = "Новый комментарий";

const Row = ({ item, first, onNavigate }: RowProps) => {
  const markRead = useNotificationsStore((state) => state.markRead);
  const unread = !item.readAt;
  const isComment = item.kind === "comment";
  const meta = notificationMeta(item.kind);
  const Icon = meta.icon;
  const strong = unread ? "text-foreground" : "text-muted-foreground";
  const closedReply = isComment && item.title !== NEW_COMMENT_TITLE;
  const heading = isComment ? actorName(item.actor) || item.title : item.title;

  const handleClick = () => {
    if (unread) void markRead({ ids: [item._id] });
    onNavigate();
  };

  return (
    <Link
      to={item.link || "#"}
      onClick={handleClick}
      className={cn(
        "flex gap-2.5 py-3 text-foreground no-underline hover:text-foreground",
        !first && "border-t border-border-soft",
      )}
    >
      {isComment ? (
        <span className="grid size-7 flex-none place-items-center rounded-[25%] border border-border bg-accent text-xs font-semibold text-muted-foreground">
          {actorInitials(item.actor)}
        </span>
      ) : (
        <span
          className={cn(
            "grid size-7 flex-none place-items-center rounded-full border",
            toneClass(meta.tone),
          )}
        >
          <Icon size={15} aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2 text-sm">
          <b className={cn("truncate font-semibold", strong)}>{heading}</b>
          <span className="ms-auto flex-none text-xs text-faint tabular-nums">
            {formatAgo(item.createdAt)}
          </span>
          {unread && (
            <span
              aria-hidden
              className="inline-block size-1.5 flex-none rounded-full bg-primary align-middle"
            />
          )}
        </span>
        {item.text && (
          <span
            className={cn(
              "mt-0.5 line-clamp-2 block text-sm leading-relaxed",
              strong,
            )}
          >
            {item.text}
          </span>
        )}
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {closedReply && (
            <>
              <span className="text-warning">ответ в закрытую</span> ·{" "}
            </>
          )}
          {notificationContext(item)}
        </span>
      </span>
    </Link>
  );
};

type ListProps = { onNavigate: () => void };

const NotificationsList = ({ onNavigate }: ListProps) => {
  const items = useNotificationsStore((state) => state.items);
  const isLoaded = useNotificationsStore((state) => state.isLoaded);
  const nextBefore = useNotificationsStore((state) => state.nextBefore);
  const fetchList = useNotificationsStore((state) => state.fetchList);

  // Пока ждём первую порцию — ничего: пустое состояние соврало бы
  if (!isLoaded) return null;

  if (items.length === 0) {
    return (
      <p className="my-6 text-center text-sm text-muted-foreground">
        Уведомлений пока нет
      </p>
    );
  }

  return (
    <>
      {items.map((item, index) => (
        <Row
          key={item._id}
          item={item}
          first={index === 0}
          onNavigate={onNavigate}
        />
      ))}
      {nextBefore && (
        <div className="border-t border-border-soft py-2.5 text-center text-sm">
          <button
            type="button"
            onClick={() => void fetchList({ more: true })}
            className="cursor-pointer appearance-none border-0 bg-transparent p-0 font-medium text-accent-text hover:underline"
          >
            Показать ещё
          </button>
        </div>
      )}
    </>
  );
};

export default NotificationsList;
