import { create } from "zustand";

import { api } from "@/lib/api";
import type {
  ConversationListResponse,
  ConversationQueue,
  ConversationRow,
  QueueCounts,
} from "@/types/conversation";

/**
 * Список «Диалогов» и счётчики очередей.
 *
 * Счётчики нужны не только списку: «Ждут ответа» стоит пилюлей у пункта меню и
 * значком у вкладки телефона. Поэтому они живут здесь, а обновляют их двое:
 * ответ списка (`load`/`silentRefresh`) и лёгкий `GET /api/conversations/counts`
 * (`refreshCounts`, его зовёт Conversation/CountsSync по теме пульса
 * «conversations»). Фоновые перечитывания сбои глотают — следующее изменение
 * подтянет данные (docs/live-updates.md).
 *
 * Очередь запоминается на устройстве: это удобство одного человека, а не
 * общее состояние.
 */

const QUEUE_KEY = "hd.conversations.queue";
const PAGE = 50;
// Фоновое перечитывание не тянет больше одной серверной страницы
const REFRESH_MAX = 100;

type BaseQueue = Exclude<ConversationQueue, "hidden">;
const BASE_QUEUES: BaseQueue[] = ["awaiting", "mine", "unbound", "all"];

const readQueue = (): BaseQueue => {
  try {
    const saved = localStorage.getItem(QUEUE_KEY);
    return BASE_QUEUES.find((queue) => queue === saved) ?? "awaiting";
  } catch {
    return "awaiting";
  }
};

const saveQueue = (queue: BaseQueue) => {
  try {
    localStorage.setItem(QUEUE_KEY, queue);
  } catch {
    // Хранилище недоступно (приватное окно) — очередь просто не запомнится
  }
};

type Filters = {
  queue: BaseQueue;
  q: string;
  company: string | null;
  /** Фильтр «Скрытые» — отдельная очередь сервера (`queue=hidden`). */
  hidden: boolean;
};

type ConversationsState = Filters & {
  items: ConversationRow[];
  counts: QueueCounts | null;
  nextBefore: string | null;
  status: "idle" | "loading" | "ready" | "error";
  loadingMore: boolean;
  setQueue: (queue: BaseQueue) => void;
  setSearch: (q: string) => void;
  setCompany: (company: string | null) => void;
  setHidden: (hidden: boolean) => void;
  resetFilters: () => void;
  load: () => Promise<void>;
  silentRefresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  refreshCounts: () => Promise<void>;
  /** Диалог открыт и отмечен прочитанным — непрочитанное в строке гаснет сразу. */
  markRead: (id: string) => void;
};

const listUrl = (
  filters: Filters,
  { limit, before }: { limit: number; before?: string | null },
) => {
  const params = new URLSearchParams({
    queue: filters.hidden ? "hidden" : filters.queue,
    limit: String(limit),
  });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.company) params.set("company", filters.company);
  if (before) params.set("before", before);
  return `/api/conversations?${params}`;
};

// Побеждает последний запрос: смена очереди посреди загрузки не должна
// нарисовать список предыдущей
let generation = 0;

const useConversationsStore = create<ConversationsState>()((set, get) => ({
  queue: readQueue(),
  q: "",
  company: null,
  hidden: false,
  items: [],
  counts: null,
  nextBefore: null,
  status: "idle",
  loadingMore: false,

  setQueue: (queue) => {
    saveQueue(queue);
    set({ queue, hidden: false });
    void get().load();
  },
  setSearch: (q) => {
    set({ q });
    void get().load();
  },
  setCompany: (company) => {
    set({ company });
    void get().load();
  },
  setHidden: (hidden) => {
    set({ hidden });
    void get().load();
  },
  resetFilters: () => {
    set({ company: null, hidden: false });
    void get().load();
  },

  load: async () => {
    const mine = ++generation;
    set({ status: "loading" });
    try {
      const data = await api<ConversationListResponse>(
        listUrl(get(), { limit: PAGE }),
      );
      if (mine !== generation) return;
      set({
        items: data.items,
        counts: data.counts,
        nextBefore: data.nextBefore,
        status: "ready",
      });
    } catch (error) {
      if (mine !== generation) return;
      console.warn("conversations: список не загрузился:", error);
      set({ status: "error" });
    }
  },

  silentRefresh: async () => {
    const mine = ++generation;
    const limit = Math.min(Math.max(get().items.length, PAGE), REFRESH_MAX);
    try {
      const data = await api<ConversationListResponse>(
        listUrl(get(), { limit }),
      );
      if (mine !== generation) return;
      set({
        items: data.items,
        counts: data.counts,
        nextBefore: data.nextBefore,
        status: "ready",
      });
    } catch (error) {
      if (mine !== generation) return;
      console.warn("conversations: пропущено обновление списка:", error);
      // Этот вызов обогнал ещё не завершённый load() (та же generation) —
      // без сброса список остался бы в "loading" навечно, как отказавший
      // сам load(). Обычный тихий отказ (статус уже "ready") — молчим и дальше
      if (get().status === "loading") set({ status: "error" });
    }
  },

  loadMore: async () => {
    const { nextBefore, loadingMore } = get();
    if (!nextBefore || loadingMore) return;
    const mine = generation;
    set({ loadingMore: true });
    try {
      const data = await api<ConversationListResponse>(
        listUrl(get(), { limit: PAGE, before: nextBefore }),
      );
      if (mine !== generation) return;
      set((state) => {
        const known = new Set(state.items.map((row) => row.id));
        return {
          items: [...state.items, ...data.items.filter((row) => !known.has(row.id))],
          counts: data.counts,
          nextBefore: data.nextBefore,
        };
      });
    } catch (error) {
      console.warn("conversations: следующая страница не загрузилась:", error);
    } finally {
      set({ loadingMore: false });
    }
  },

  refreshCounts: async () => {
    try {
      const data = await api<{ counts: QueueCounts }>(
        "/api/conversations/counts",
      );
      set({ counts: data.counts });
    } catch (error) {
      console.warn("conversations: пропущено обновление счётчиков:", error);
    }
  },

  markRead: (id) =>
    set((state) => ({
      items: state.items.map((row) =>
        row.id === id && row.unread ? { ...row, unread: 0 } : row,
      ),
    })),
}));

export default useConversationsStore;
