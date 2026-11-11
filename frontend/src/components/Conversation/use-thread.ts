import { useCallback, useEffect, useRef, useState } from "react";

import useLiveTopic from "@/hooks/use-live-topic";
import { ApiError, api } from "@/lib/api";
import usePulseStore from "@/store/pulse";
import type {
  MessageRow,
  MessagesChanges,
  MessagesPage,
} from "@/types/conversation";
import {
  PAGE_SIZE,
  changesQuery,
  mergeMessages,
  nextCursor,
} from "@/util/conversation-thread";

// Опрос изменений дочитывает полные страницы подряд, но не бесконечно
const MAX_DRAIN_ROUNDS = 10;
// Открытая переписка просит пульс чаще: сообщение клиента видно за 3 с,
// а не за 10 (спека «Live»)
const THREAD_CADENCE_MS = 3_000;

type Cursor = { since: string; afterId: string | null };

/**
 * Лента одного диалога: первая страница из загрузчика маршрута, дальше —
 * изменения по `changedSince` (контракт docs/messaging.md §7), когда пульс
 * говорит, что тема «conversations» сдвинулась. Своего таймера нет: частоту
 * задаёт пульс, которому открытая переписка заказывает 3 с.
 *
 * `onChanged` получает изменившиеся сообщения — страница по ним решает,
 * перечитать ли карточку и отметить ли прочитанным.
 */
export const useThread = (
  conversationId: string,
  initial: MessagesPage,
  onChanged?: (changed: MessageRow[]) => void,
) => {
  const [messages, setMessages] = useState<MessageRow[]>(initial.items);
  const [hasOlder, setHasOlder] = useState(initial.items.length >= PAGE_SIZE);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursor = useRef<Cursor>({ since: initial.serverTime, afterId: null });
  const currentId = useRef(conversationId);
  const removedIds = useRef(new Set<string>());
  const pollingId = useRef<string | null>(null);
  const accessRevoked = useRef(false);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  // Другой диалог в том же компоненте (переход по строке списка) — лента с
  // нуля; тот же диалог с новыми данными загрузчика — слить
  useEffect(() => {
    if (currentId.current !== conversationId) {
      currentId.current = conversationId;
      removedIds.current.clear();
      accessRevoked.current = false;
      setMessages(initial.items);
      setHasOlder(initial.items.length >= PAGE_SIZE);
      cursor.current = { since: initial.serverTime, afterId: null };
      return;
    }
    setMessages((current) =>
      mergeMessages(
        current,
        initial.items,
        [...removedIds.current],
        accessRevoked.current,
      ),
    );
  }, [conversationId, initial]);

  const poll = useCallback(async () => {
    const id = conversationId;
    if (pollingId.current === id || accessRevoked.current) return [];
    pollingId.current = id;
    try {
      let changed: MessageRow[] = [];
      let revoked = false;
      for (let round = 0; round < MAX_DRAIN_ROUNDS; round += 1) {
        const page = await api<MessagesChanges>(
          `/api/conversations/${id}/messages?${changesQuery(cursor.current)}`,
        );
        // Пока ждали ответ, открыли другой диалог — чужое в ленту не льём
        if (currentId.current !== id) return [];
        for (const message of page.items) removedIds.current.delete(message.id);
        for (const removed of page.removedIds ?? [])
          removedIds.current.add(removed);
        revoked ||= Boolean(page.removedIds?.length);
        const revokedIds = [...removedIds.current];
        changed = mergeMessages(changed, page.items, revokedIds);
        // Apply every page before advancing its cursor, including removal-only
        // pages; a later network failure must not lose an already-read revocation.
        setMessages((current) =>
          mergeMessages(current, page.items, revokedIds, accessRevoked.current),
        );
        const next = nextCursor(page);
        cursor.current = { since: next.since, afterId: next.afterId };
        if (!next.drain) break;
      }
      if (changed.length || revoked) {
        onChangedRef.current?.(changed);
      }
      return changed;
    } catch (error) {
      if (currentId.current !== id) return [];
      if (error instanceof ApiError && error.status === 404) {
        accessRevoked.current = true;
        setMessages([]);
        setHasOlder(false);
        onChangedRef.current?.([]);
        return [];
      }
      throw error;
    } finally {
      if (pollingId.current === id) pollingId.current = null;
    }
  }, [conversationId]);

  useLiveTopic("conversations", poll);

  useEffect(
    () => usePulseStore.getState().requestCadence(THREAD_CADENCE_MS),
    [],
  );

  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const params = new URLSearchParams({
        before: oldest.sentAt,
        beforeSeq: String(oldest.seq),
        limit: String(PAGE_SIZE),
      });
      const page = await api<MessagesPage>(
        `/api/conversations/${conversationId}/messages?${params}`,
      );
      if (currentId.current !== conversationId) return;
      setMessages((current) =>
        mergeMessages(
          current,
          page.items,
          [...removedIds.current],
          accessRevoked.current,
        ),
      );
      setHasOlder(page.items.length >= PAGE_SIZE);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, messages, loadingOlder]);

  /** Ответ из «Диалогов»: текст и файлы уходят multipart, строка — сразу в ленту. */
  const send = useCallback(
    async ({
      text,
      files,
      ticketNum,
      withoutTicket,
      replyToId,
      stickerId,
    }: {
      text: string;
      files: File[];
      ticketNum?: number;
      withoutTicket?: boolean;
      replyToId?: string;
      stickerId?: string;
    }) => {
      const body = new FormData();
      body.append("text", text);
      if (stickerId) body.append("stickerId", stickerId);
      if (ticketNum !== undefined) body.append("ticketNum", String(ticketNum));
      if (withoutTicket) body.append("withoutTicket", "true");
      if (replyToId) body.append("replyToId", replyToId);
      for (const file of files) body.append("attachments", file);
      const { message } = await api<{ message: MessageRow }>(
        `/api/conversations/${conversationId}/messages`,
        { method: "POST", body },
      );
      setMessages((current) =>
        mergeMessages(
          current,
          [message],
          [...removedIds.current],
          accessRevoked.current,
        ),
      );
      return message;
    },
    [conversationId],
  );

  /** Повтор неотправленного ответа — статус «в очереди» возвращается сразу. */
  const retry = useCallback(async (messageId: string) => {
    const { message } = await api<{ message: MessageRow }>(
      `/api/messages/${messageId}/retry`,
      { method: "POST" },
    );
    setMessages((current) =>
      mergeMessages(
        current,
        [message],
        [...removedIds.current],
        accessRevoked.current,
      ),
    );
  }, []);

  return { messages, hasOlder, loadingOlder, loadOlder, poll, send, retry };
};
