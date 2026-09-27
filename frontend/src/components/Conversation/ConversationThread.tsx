import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { isMobile } from "react-device-detect";
import { RiAddLine, RiArrowLeftSLine, RiMoreLine } from "react-icons/ri";

import FormOutlet from "@/components/app/FormOutlet";
import HealthRow from "@/components/app/HealthRow";
import { useDeferredRevalidate } from "@/components/app/use-refresh-route";
import { Button } from "@/components/ui/button";
import useMinuteTick from "@/hooks/use-minute-tick";
import { api } from "@/lib/api";
import { useCan } from "@/store/authed-user";
import useConversationsStore from "@/store/conversations";
import useToastStore from "@/store/toast-store";
import type { ConversationCard, MessagesPage } from "@/types/conversation";
import { newCounterpartNote } from "@/util/conversation-format";
import {
  defaultDraftMessageIds,
  hasNewInbound,
} from "@/util/conversation-thread";
import { displayTimeZone } from "@/util/format-date";

import Composer from "./Composer";
import ContextPane, { type ContextHandlers } from "./ContextPane";
import ContextSheet from "./ContextSheet";
import DecisionPrompt from "./DecisionPrompt";
import MessagesPane from "./MessagesPane";
import ThreadHeader, { TicketChip } from "./ThreadHeader";
import ThreadMenu, { useThreadActions } from "./ThreadMenu";
import {
  answerNoTicket,
  assignConversation,
  bindConversation,
  failureText,
  markHandled,
  unbindConversation,
} from "./conversation-actions";
import { useThread } from "./use-thread";

export type ThreadData = { card: ConversationCard; page: MessagesPage };

/**
 * Один диалог: переписка и колонка собеседника (канва A1), на телефоне —
 * экран-переписка и шторка «Контакт и действия» (B2, B3). Данные — загрузчик
 * маршрута (карточка + первая страница ленты); лента живёт в useThread,
 * карточка перечитывается, когда в ленте что-то изменилось, и после каждого
 * действия. Формы поверх диалога («Создать заявку», «Новый пользователь») —
 * вложенные маршруты в шторке (FormOutlet).
 */
const ConversationThread = () => {
  const { card, page } = useLoaderData() as ThreadData;
  const { conversation, channel } = card;
  const conversationId = conversation.id;
  const navigate = useNavigate();
  const revalidate = useDeferredRevalidate();
  const can = useCan();
  const canReply = can({ conversation: ["reply"] });
  const canManage = can({ conversation: ["manage"] });
  const now = useMinuteTick();
  const timeZone = displayTimeZone();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Отметка «прочитано»: при открытии и на каждое новое входящее, пока
  // вкладка видна. Строка списка гаснет сразу, не дожидаясь пульса
  const markSeen = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    api(`/api/conversations/${conversationId}/seen`, { method: "POST" })
      .then(() => useConversationsStore.getState().markRead(conversationId))
      .catch((error) => console.warn("Отметка «прочитано» не удалась:", error));
  }, [conversationId]);

  const known = useRef<Set<string>>(new Set());
  const thread = useThread(conversationId, page, (changed) => {
    // Изменилась лента — могли измениться и ожидание, и привязка, и статус
    void revalidate();
    if (hasNewInbound(changed, known.current)) markSeen();
  });

  useEffect(() => {
    known.current = new Set(thread.messages.map((message) => message.id));
  }, [thread.messages]);

  useEffect(() => {
    markSeen();
  }, [markSeen]);

  /** После своего действия: карточка, лента и список — сразу, не ждать пульса. */
  const refresh = useCallback(() => {
    void revalidate();
    thread.poll().catch(() => {});
    void useConversationsStore.getState().silentRefresh();
  }, [revalidate, thread]);

  const handlers: ContextHandlers = {
    onBind: (num) => void bindConversation(conversationId, num).then((ok) => ok && refresh()),
    onUnbind: () => void unbindConversation(conversationId).then((ok) => ok && refresh()),
    onAssign: (userId) =>
      void assignConversation(conversationId, userId).then((ok) => ok && refresh()),
    onLinked: refresh,
  };

  const createTicket = () => {
    const params = new URLSearchParams({
      conversation: conversationId,
      messages: defaultDraftMessageIds(thread.messages).join(","),
    });
    setSheetOpen(false);
    navigate(`tickets/add?${params}`);
  };

  const retry = (messageId: string) =>
    void thread.retry(messageId).catch((error) =>
      useToastStore
        .getState()
        .showToast("danger", failureText(error, "Не удалось повторить отправку")),
    );

  // «Создать заявку» — у личного чата без живой привязки. Группа (выбор
  // сообщений — этап P2) и форма сайта (P5) заявку отсюда не заводят
  const canCreateTicket = conversation.kind === "direct" && !conversation.ticket;

  const composer = !canReply ? null : conversation.network === "site" ? (
    <HealthRow
      state="info"
      title="Ответ на форму сайта появится вместе с почтовым ответом"
      className="flex-none"
    />
  ) : channel && !channel.isActive ? (
    <HealthRow
      state="info"
      title="Канал отключён — ответить через него нельзя"
      className="flex-none"
    />
  ) : (
    <Composer
      network={conversation.network}
      ticketNum={conversation.ticket?.num ?? null}
      awaiting={Boolean(conversation.awaitingSince)}
      phone={isMobile}
      onSend={async (draft) => {
        await thread.send(draft);
        refresh();
      }}
      onHandled={() => markHandled(conversationId).then((ok) => ok && refresh())}
    />
  );

  const decision = conversation.decision && (
    <DecisionPrompt
      ticketNum={conversation.decision.ticketNum}
      canManage={canManage}
      onNewTicket={createTicket}
      onNoTicket={() =>
        void answerNoTicket(conversationId).then((ok) => ok && refresh())
      }
    />
  );

  const messagesPane = (
    <MessagesPane
      conversationId={conversationId}
      messages={thread.messages}
      kind={conversation.kind}
      timeZone={timeZone}
      compact={isMobile}
      note={
        conversation.unknown && conversation.kind === "direct"
          ? newCounterpartNote(conversation.network)
          : undefined
      }
      hasOlder={thread.hasOlder}
      loadingOlder={thread.loadingOlder}
      onLoadOlder={() =>
        void thread.loadOlder().catch((error) =>
          useToastStore
            .getState()
            .showToast(
              "danger",
              failureText(error, "Не удалось загрузить более старые сообщения"),
            ),
        )
      }
      canRetry={canReply}
      onRetry={retry}
    />
  );

  const context = (big: boolean) => (
    <ContextPane
      card={card}
      canManage={canManage}
      big={big}
      now={now}
      timeZone={timeZone}
      handlers={handlers}
    />
  );

  const phoneActions = useThreadActions(card, { canManage, onChanged: refresh });
  // Собеседник не опознан (не группа) — ContextPane рисует «Скрыть диалог»
  // прямо в WhoIsThis; тот же пункт списком действий внизу шторки был бы
  // виден дважды подряд. Но WhoIsThis умеет только скрывать: у уже скрытого
  // диалога пункт списка — «Вернуть в очереди», единственная кнопка возврата
  // на телефоне, и её не прячем
  const whoIsThisShown = conversation.kind !== "group" && !card.contact;
  const sheetActions =
    whoIsThisShown && !conversation.hidden
      ? phoneActions.filter((item) => item.key !== "hide")
      : phoneActions;

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-none border-b border-border-soft bg-card">
          <nav aria-label="Навигация" className="px-3 pt-2.5">
            <Link
              to="/conversations"
              className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground no-underline"
            >
              <RiArrowLeftSLine size={16} aria-hidden />
              Диалоги
            </Link>
          </nav>
          <ThreadHeader card={card} now={now} compact>
            {conversation.ticket ? (
              <TicketChip num={conversation.ticket.num} small />
            ) : (
              canCreateTicket && (
                <Button size="xs" onClick={createTicket}>
                  <RiAddLine />
                  Создать заявку
                </Button>
              )
            )}
            <Button
              variant="outline"
              size="icon-xs"
              aria-label="Контакт и действия"
              title="Контакт и действия"
              onClick={() => setSheetOpen(true)}
            >
              <RiMoreLine />
            </Button>
          </ThreadHeader>
        </div>
        {messagesPane}
        {decision}
        {composer}
        <ContextSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={conversation.title || "Собеседник"}
        >
          {context(true)}
          {sheetActions.length > 0 && (
            <div className="mt-5 flex flex-col gap-1 border-t border-border-soft pt-3">
              {sheetActions.map((item) =>
                item.to ? (
                  <Button
                    key={item.key}
                    asChild
                    variant="ghost"
                    className="w-full justify-start"
                  >
                    <Link to={item.to}>{item.label}</Link>
                  </Button>
                ) : (
                  <Button
                    key={item.key}
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => {
                      setSheetOpen(false);
                      item.run?.();
                    }}
                  >
                    {item.label}
                  </Button>
                ),
              )}
            </div>
          )}
        </ContextSheet>
        <FormOutlet />
      </div>
    );
  }

  return (
    <>
      <section aria-label="Переписка" className="flex min-w-0 flex-1 flex-col">
        <ThreadHeader card={card} now={now}>
          {conversation.ticket ? (
            <TicketChip
              num={conversation.ticket.num}
              state={card.ticket?.state ?? null}
            />
          ) : (
            canCreateTicket && (
              <Button size="sm" onClick={createTicket}>
                <RiAddLine />
                Создать заявку
              </Button>
            )
          )}
          <ThreadMenu card={card} canManage={canManage} onChanged={refresh} />
        </ThreadHeader>
        {messagesPane}
        {decision}
        {composer}
      </section>
      <aside
        aria-label="Контакт и заявка"
        className="w-80 flex-none overflow-y-auto border-l border-border-soft px-5 py-4"
      >
        {context(false)}
      </aside>
      <FormOutlet />
    </>
  );
};

export default ConversationThread;
