import { useShallow } from "zustand/react/shallow";

import Spinner from "@/components/app/Spinner";
import { Button } from "@/components/ui/button";
import useMinuteTick from "@/hooks/use-minute-tick";
import { useAuthedUser } from "@/store/authed-user";
import useConversationsStore from "@/store/conversations";
import { emptyListText } from "@/util/conversation-format";
import { displayTimeZone } from "@/util/format-date";

import ConversationRow from "./ConversationRow";

/**
 * Список «Диалогов»: строки, «Показать ещё» по курсору сервера, пустые
 * состояния по очереди. Живёт в своей прокрутке (панель слева на десктопе,
 * карточка-список на телефоне); данные — store/conversations.
 */
const ConversationList = ({
  selectedId = null,
  phone = false,
}: {
  selectedId?: string | null;
  phone?: boolean;
}) => {
  const { items, status, nextBefore, loadingMore, loadMore, queue, hidden, q } =
    useConversationsStore(
      useShallow((state) => ({
        items: state.items,
        status: state.status,
        nextBefore: state.nextBefore,
        loadingMore: state.loadingMore,
        loadMore: state.loadMore,
        queue: state.queue,
        hidden: state.hidden,
        q: state.q,
      })),
    );
  // «ждёт 12 мин» и время строк идут вместе с часами
  const now = useMinuteTick();
  const timeZone = displayTimeZone();
  const me = useAuthedUser();
  const myName = `${me.lastName ?? ""} ${me.firstName ?? ""}`.trim();

  if (!items.length) {
    if (status === "loading" || status === "idle") {
      return <Spinner className="min-h-40" size={32} />;
    }
    return (
      <p className="my-0 px-4 py-10 text-center text-sm text-muted-foreground">
        {status === "error"
          ? "Список не загрузился — обновите страницу"
          : emptyListText({ queue, hidden, q })}
      </p>
    );
  }

  return (
    <>
      {items.map((row, index) => (
        <ConversationRow
          key={row.id}
          row={row}
          first={index === 0}
          selected={row.id === selectedId}
          phone={phone}
          now={now}
          timeZone={timeZone}
          myName={myName}
        />
      ))}
      {nextBefore && (
        <div className="border-t border-border-soft p-3 text-center">
          <Button
            variant="ghost"
            size="sm"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Загрузка…" : "Показать ещё"}
          </Button>
        </div>
      )}
    </>
  );
};

export default ConversationList;
