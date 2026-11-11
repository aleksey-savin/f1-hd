import Crumbs, { type CrumbOrigin } from "@/components/app/Crumbs";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLoaderData, useNavigate, useLocation } from "react-router";
import { isMobile } from "react-device-detect";
import {
  RiAddLine,
  RiCloseLine,
  RiMoreLine,
} from "react-icons/ri";

import FormOutlet from "@/components/app/FormOutlet";
import HealthRow from "@/components/app/HealthRow";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import { useDeferredRevalidate } from "@/components/app/use-refresh-route";
import { Button } from "@/components/ui/button";
import useMinuteTick from "@/hooks/use-minute-tick";
import { ApiError, api } from "@/lib/api";
import { conversationReplyAllowed } from "@/util/conversation-access";
import useConversationsStore from "@/store/conversations";
import useToastStore from "@/store/toast-store";
import type {
  ConversationCard,
  ConversationReplySelection,
  MessageRow,
  MessagesPage,
} from "@/types/conversation";
import {
  conversationTickets,
  filterContextMessages,
  messageContextLabel,
  replySelection,
  reconcileReplySelection,
  canCreateTicketFromMessages,
  replyTarget,
} from "@/util/conversation-context";
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
import ReplyContextPicker from "./ReplyContextPicker";
import ThreadHeader from "./ThreadHeader";
import ThreadMenu from "./ThreadMenu";
import { useThread } from "./use-thread";
import {
  answerNoTicket,
  assignConversation,
  assignMessages,
  bindConversation,
  chooseReplyContext,
  failureText,
  markHandled,
  unbindConversation,
} from "./conversation-actions";

export type ThreadData = { card: ConversationCard; page: MessagesPage };
type Picker = { kind: "context" } | { kind: "messages"; ids: string[] };

/** A selected ticket is a staff reply context and filter, never a global chat owner. */
const ConversationThread = () => {
  const { card, page } = useLoaderData() as ThreadData;
  const { conversation, channel } = card;
  const conversationId = conversation.id;
  const navigate = useNavigate();
  const location = useLocation();
  const origin = (location.state as { from?: CrumbOrigin } | null)?.from;
  const revalidate = useDeferredRevalidate();
  const canReply = card.access?.reply === true;
  const canManage = card.access?.manage === true;
  const now = useMinuteTick();
  const timeZone = displayTimeZone();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [localSelection, setLocalSelection] =
    useState<ConversationReplySelection | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [contextClock, setContextClock] = useState(Date.now);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [unbindNum, setUnbindNum] = useState<number | null>(null);
  const pendingContext = useRef(false);
  const linked = conversationTickets(card);
  const baseSelection =
    pendingContext.current && localSelection
      ? localSelection
      : canReply
        ? reconcileReplySelection(
            localSelection,
            card,
            new Date(Math.max(now.getTime(), contextClock)),
          )
        : (localSelection ??
          replySelection(
            card,
            new Date(Math.max(now.getTime(), contextClock)),
          ));
  const selection: ConversationReplySelection =
    baseSelection.expiresAt &&
    Date.parse(baseSelection.expiresAt) <= Math.max(now.getTime(), contextClock)
      ? { mode: "choose", ticket: null, expiresAt: baseSelection.expiresAt }
      : baseSelection;

  const canSend = conversationReplyAllowed(card, selection);

  useEffect(() => {
    if (!canReply || pendingContext.current) return;
    setLocalSelection((current) => {
      if (!current) return current;
      const next = reconcileReplySelection(current, card);
      return next.mode === current.mode &&
        next.ticket?.id === current.ticket?.id &&
        next.expiresAt === current.expiresAt &&
        next.updatedAt === current.updatedAt
        ? current
        : next;
    });
  }, [card, canReply]);

  useEffect(() => {
    if (!selection.expiresAt || selection.mode === "choose") return undefined;
    const timer = setTimeout(
      () => setContextClock(Date.now()),
      Math.max(1, Date.parse(selection.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [selection.expiresAt, selection.mode]);

  const markSeen = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    api(`/api/conversations/${conversationId}/seen`, { method: "POST" })
      .then(() => useConversationsStore.getState().markRead(conversationId))
      .catch((error) => console.warn("Отметка «прочитано» не удалась:", error));
  }, [conversationId]);
  const known = useRef<Set<string>>(new Set());
  const firstUnread = useRef(
    conversation.unread > 0
      ? page.items
          .filter((message) => message.direction === "in")
          .slice(-conversation.unread)[0]?.id
      : undefined,
  );
  const thread = useThread(conversationId, page, (changed) => {
    void revalidate();
    if (hasNewInbound(changed, known.current)) markSeen();
  });
  useEffect(() => {
    known.current = new Set(thread.messages.map((message) => message.id));
  }, [thread.messages]);
  useEffect(() => {
    markSeen();
  }, [markSeen]);
  const refresh = () => {
    void revalidate();
    thread.poll().catch(() => {});
    void useConversationsStore.getState().silentRefresh();
  };
  const selectContext = async (ticketNum: number | null) => {
    if (pendingContext.current || (ticketNum === null && !card.access?.all)) return;
    const ticket =
      ticketNum === null ? null : linked.find((item) => item.num === ticketNum);
    if (ticketNum !== null && !ticket) return;
    const previous = selection;
    setLocalSelection({
      mode: ticket ? "ticket" : "free",
      ticket: ticket ?? null,
      expiresAt: null,
    });
    setSheetOpen(false);
    if (!canReply || (ticket && !ticket.canReply)) {
      setPicker(null);
      return;
    }
    pendingContext.current = true;
    setContextBusy(true);
    try {
      await chooseReplyContext(conversationId, ticketNum);
      const fresh = await api<ConversationCard>(
        `/api/conversations/${conversationId}`,
      );
      setLocalSelection(replySelection(fresh));
      setPicker(null);
      refresh();
    } catch (error) {
      setLocalSelection(previous);
      useToastStore
        .getState()
        .showToast(
          "danger",
          failureText(error, "Не удалось выбрать тему ответа"),
        );
    } finally {
      pendingContext.current = false;
      setContextBusy(false);
    }
  };
  const handlers: ContextHandlers = {
    onBind: (num) =>
      void bindConversation(conversationId, num).then((ok) => ok && refresh()),
    onUnbind: (num) => {
      if (num) setUnbindNum(num);
    },
    onAssign: (userId) =>
      void assignConversation(conversationId, userId).then(
        (ok) => ok && refresh(),
      ),
    onLinked: refresh,
  };
  const createTicket = (ids?: string[]) => {
    const params = new URLSearchParams({
      conversation: conversationId,
      messages: (ids ?? defaultDraftMessageIds(thread.messages)).join(","),
    });
    setSheetOpen(false);
    navigate(`tickets/add?${params}`);
  };
  const retry = (id: string) =>
    void thread
      .retry(id)
      .catch((error) =>
        useToastStore
          .getState()
          .showToast(
            "danger",
            failureText(error, "Не удалось повторить отправку"),
          ),
      );
  const chooseForMessages = async (ticketNum: number | null) => {
    if (picker?.kind !== "messages" || mappingBusy) return;
    setMappingBusy(true);
    try {
      if (await assignMessages(conversationId, picker.ids, ticketNum)) {
        setCheckedIds([]);
        setPicker(null);
        if (ticketNum === null && canReply) await selectContext(null);
        refresh();
      }
    } finally {
      setMappingBusy(false);
    }
  };
  const openMessagePicker = (ids: string[]) => {
    setPicker({ kind: "messages", ids });
    setSheetOpen(false);
  };
  const messageActions = (message: MessageRow) => {
    const showAssignment =
      linked.length > 1 || conversation.kind === "group" || !message.ticket;
    const nativeReply =
      canSend &&
      channel?.provider === "wazzup" &&
      !message.deletedAt &&
      !["queued", "failed"].includes(message.status);
    if (!showAssignment && !nativeReply) return undefined;
    return (
      <div
        className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${message.direction === "out" ? "justify-end" : "justify-start"}`}
      >
        {showAssignment &&
          (canManage ? (
            <button
              type="button"
              onClick={() => openMessagePicker([message.id])}
              className={`cursor-pointer appearance-none rounded border-0 bg-transparent p-0 text-left underline-offset-2 outline-none hover:underline focus-visible:ring-4 focus-visible:ring-ring/50 ${!message.ticket && message.attachMode !== "free" ? "text-warning-text" : "text-muted-foreground"}`}
            >
              {messageContextLabel(message, linked)}
            </button>
          ) : (
            <span className="text-muted-foreground">
              {messageContextLabel(message, linked)}
            </span>
          ))}
        {showAssignment && message.attachMode === "ai" && (
          <span
            className="text-faint"
            title="Распределено ИИ; менеджер может изменить привязку"
          >
            ИИ
          </span>
        )}
        {showAssignment &&
          !message.ticket &&
          !message.deletedAt &&
          canManage && (
            <button
              type="button"
              className="cursor-pointer appearance-none rounded border-0 bg-transparent p-0 text-accent-text hover:underline focus-visible:ring-4 focus-visible:ring-ring/50"
              onClick={() => createTicket([message.id])}
            >
              Создать заявку
            </button>
          )}
        {nativeReply && (
          <button
            type="button"
            className="cursor-pointer appearance-none rounded border-0 bg-transparent p-0 text-faint hover:underline focus-visible:ring-4 focus-visible:ring-ring/50"
            onClick={() => setReplyTo(message)}
          >
            Ответить
          </button>
        )}
      </div>
    );
  };
  const canCreateTicket =
    canManage && ["direct", "group"].includes(conversation.kind);
  const canCreateSelected = canCreateTicketFromMessages(
    thread.messages,
    checkedIds,
  );
  const contextPaused = Boolean(
    selection.expiresAt &&
      Date.parse(selection.expiresAt) <= Math.max(now.getTime(), contextClock),
  );
  const composer = !canReply || (selection.mode === "ticket" && !canSend) ? (
    <HealthRow state="info" title="У вас доступ только к чтению" />
  ) : conversation.network === "site" ? (
    <HealthRow
      state="info"
      title="Ответ на форму сайта появится вместе с почтовым ответом"
    />
  ) : channel && !channel.isActive ? (
    <HealthRow
      state="info"
      title="Канал отключён — ответить через него нельзя"
    />
  ) : (
    <Composer
      network={conversation.network}
      stickersAvailable={channel?.provider === "wazzup"}
      ticketNum={selection.ticket?.num ?? null}
      awaiting={canManage && Boolean(conversation.awaitingSince)}
      phone={isMobile}
      sendBlocked={!canSend || contextBusy}
      contextTitle={
        conversation.kind === "direct" &&
        (linked.length > 1 || selection.mode !== "ticket")
          ? selection.ticket?.title ||
            (selection.mode === "free"
              ? "Без заявки"
              : contextPaused
                ? "Переписка была приостановлена"
                : "Выберите тему для ответа")
          : undefined
      }
      onChooseContext={() => setPicker({ kind: "context" })}
      replyTo={
        replyTo
          ? {
              authorName: replyTo.author.name || conversation.title,
              text: replyTo.text,
            }
          : null
      }
      onCancelReply={() => setReplyTo(null)}
      onSend={async (draft) => {
        if (!canSend) throw new Error("Нет права отвечать по выбранной заявке");
        const target = replyTarget(selection);
        if (!target) throw new Error("Выберите тему ответа");
        try {
          await thread.send({ ...draft, ...target, replyToId: replyTo?.id });
          setReplyTo(null);
          refresh();
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            refresh();
          }
          throw error;
        }
      }}
      onHandled={() =>
        markHandled(conversationId).then((ok) => {
          if (ok) refresh();
        })
      }
    />
  );
  const decision = canManage && conversation.decision && (
    <DecisionPrompt
      ticketNum={conversation.decision.ticketNum}
      canManage={canManage}
      onNewTicket={() => createTicket()}
      onNoTicket={() =>
        void answerNoTicket(conversationId).then((ok) => ok && refresh())
      }
    />
  );
  const messagesPane = (
    <MessagesPane
      conversationId={conversationId}
      viewKey={`${conversationId}:${showAllMessages ? "all" : `${selection.mode}:${selection.ticket?.id || ""}`}`}
      showAll={showAllMessages}
      onShowAllChange={conversation.kind === "direct" ? setShowAllMessages : undefined}
      messages={filterContextMessages(
        thread.messages,
        selection,
        conversation.kind,
        showAllMessages,
      )}
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
        void thread
          .loadOlder()
          .catch((error) =>
            useToastStore
              .getState()
              .showToast(
                "danger",
                failureText(
                  error,
                  "Не удалось загрузить более старые сообщения",
                ),
              ),
          )
      }
      canRetry={(message) => conversationReplyAllowed(card, message.ticket
        ? { mode: "ticket", ticket: message.ticket }
        : { mode: "free" })}
      onRetry={retry}
      renderActions={messageActions}
      firstUnreadId={firstUnread.current}
      selectedMessageIds={checkedIds}
      onSelectMessage={
        conversation.kind === "group" && canManage
          ? (id, selected) =>
              setCheckedIds((current) =>
                selected
                  ? [...current, id]
                  : current.filter((item) => item !== id),
              )
          : undefined
      }
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
      selection={selection}
      onSelectContext={(num) => void selectContext(num)}
      onCreateTicket={() => createTicket()}
      onChooseContext={() => setPicker({ kind: "context" })}
      contextBusy={contextBusy}
      contextPaused={contextPaused}
      decision={decision}
      actions={
        <ThreadMenu card={card} canManage={canManage} onChanged={refresh} />
      }
    />
  );
  const selectedMessage =
    picker?.kind === "messages" && picker.ids.length === 1
      ? thread.messages.find((message) => message.id === picker.ids[0])
      : null;
  return (
    <>
      <section aria-label="Переписка" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!isMobile && origin && (
          <div className="border-b border-border-soft px-4 py-2 [&>nav]:mb-0">
            <Crumbs />
          </div>
        )}
        {isMobile && (
          <div className="flex-none border-b border-border-soft bg-card">
            <div className="px-3 pt-2.5 [&>nav]:mb-0">
              <Crumbs />
            </div>
            <ThreadHeader card={card} compact>
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
        )}
        {messagesPane}
        {conversation.kind === "group" && checkedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border-soft px-3 py-2 text-xs">
            <span>Выбрано: {checkedIds.length}</span>
            {canCreateTicket && (
              <Button
                size="xs"
                variant="outline"
                disabled={!canCreateSelected}
                onClick={() => createTicket(checkedIds)}
              >
                <RiAddLine />
                Создать заявку
              </Button>
            )}
            <Button
              size="xs"
              variant="outline"
              onClick={() => openMessagePicker(checkedIds)}
            >
              Добавить в заявку
            </Button>
            {!canCreateSelected && (
              <span className="basis-full text-muted-foreground">
                Для новой заявки выберите сообщения без заявки.
              </span>
            )}
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Снять выбор"
              onClick={() => setCheckedIds([])}
            >
              <RiCloseLine />
            </Button>
          </div>
        )}
        {composer}
      </section>
      {!isMobile && (
        <aside
          aria-label="Контакт и заявки"
          className="w-88 flex-none overflow-y-auto border-l border-border-soft px-4 py-4"
        >
          {context(false)}
        </aside>
      )}
      <ContextSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={conversation.title || "Собеседник"}
      >
        {context(true)}
      </ContextSheet>
      <ReplyContextPicker
        card={card}
        open={!!picker}
        onOpenChange={(open) => {
          if (!open) setPicker(null);
        }}
        onChoose={(num) =>
          void (picker?.kind === "messages"
            ? chooseForMessages(num)
            : selectContext(num))
        }
        selectedId={
          selectedMessage?.ticket?.id ||
          (selectedMessage?.attachMode === "free"
            ? "free"
            : picker?.kind === "messages"
              ? null
              : selection.mode === "free"
                ? "free"
                : (selection.ticket?.id ?? null))
        }
        messageText={selectedMessage?.text}
        assigning={picker?.kind === "messages"}
        busy={mappingBusy || contextBusy}
      />
      <ConfirmDialog
        open={unbindNum !== null}
        onOpenChange={(open) => {
          if (!open) setUnbindNum(null);
        }}
        title={`Отвязать заявку ${unbindNum}?`}
        description="Сообщения, уже отнесённые к заявке, сохранятся в её истории."
        confirmLabel="Отвязать"
        onConfirm={() => {
          if (unbindNum)
            void unbindConversation(conversationId, unbindNum).then((ok) => {
              if (ok) {
                setLocalSelection(null);
                refresh();
              }
            });
          setUnbindNum(null);
        }}
      />
      <FormOutlet />
    </>
  );
};
export default ConversationThread;
