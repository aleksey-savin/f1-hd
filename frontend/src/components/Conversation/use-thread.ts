import { useCallback, useEffect, useRef, useState } from "react";

import useLiveTopic from "@/hooks/use-live-topic";
import { api } from "@/lib/api";
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
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  // Другой диалог в том же компоненте (переход по строке списка) — лента с
  // нуля; тот же диалог с новыми данными загрузчика — слить
  useEffect(() => {
    if (currentId.current !== conversationId) {
      currentId.current = conversationId;
      setMessages(initial.items);
      setHasOlder(initial.items.length >= PAGE_SIZE);
      cursor.current = { since: initial.serverTime, afterId: null };
      return;
    }
    setMessages((current) => mergeMessages(current, initial.items));
  }, [conversationId, initial]);

  const poll = useCallback(async () => {
    const id = conversationId;
    let changed: MessageRow[] = [];
    for (let round = 0; round < MAX_DRAIN_ROUNDS; round += 1) {
      const page = await api<MessagesChanges>(
        `/api/conversations/${id}/messages?${changesQuery(cursor.current)}`,
      );
      // Пока ждали ответ, открыли другой диалог — чужое в ленту не льём
      if (currentId.current !== id) return [];
      changed = changed.concat(page.items);
      const next = nextCursor(page);
      cursor.current = { since: next.since, afterId: next.afterId };
      if (!next.drain) break;
    }
    if (changed.length) {
      setMessages((current) => mergeMessages(current, changed));
      onChangedRef.current?.(changed);
    }
    return changed;
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
      setMessages((current) => mergeMessages(current, page.items));
      setHasOlder(page.items.length >= PAGE_SIZE);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, messages, loadingOlder]);

  /** Ответ из «Диалогов»: текст и файлы уходят multipart, строка — сразу в ленту. */
  const send = useCallback(
    async ({ text, files }: { text: string; files: File[] }) => {
      const body = new FormData();
      body.append("text", text);
      for (const file of files) body.append("attachments", file);
      const { message } = await api<{ message: MessageRow }>(
        `/api/conversations/${conversationId}/messages`,
        { method: "POST", body },
      );
      setMessages((current) => mergeMessages(current, [message]));
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
    setMessages((current) => mergeMessages(current, [message]));
  }, []);

  return { messages, hasOlder, loadingOlder, loadOlder, poll, send, retry };
};
