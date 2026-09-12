import { create } from "zustand";

import { api } from "@/lib/api";
import type {
  NotificationItem,
  NotificationsListResponse,
  NotificationsReadResponse,
  NotificationsSummary,
} from "@/types/notification";

/**
 * Колокольчик — уведомления «в приложении» текущего человека.
 *
 * Механика та же, что у рейла статусов (store/work-statuses): лёгкая сводка
 * `/api/notifications/summary` опрашивается фоном (usePolling в
 * Notifications/Bell, один на оболочку), список приезжает только когда панель
 * открыта. silentRefresh не трогает индикаторы и глотает сетевые сбои —
 * пропущенный цикл некритичен, следующий тик подтянет.
 *
 * Открыта ли панель, живёт здесь же: колокольчик и панель — разные
 * компоненты (поповер на десктопе, шторка на телефоне), а «прочитать» из
 * панели и «просмотрено» со страницы заявки обязаны двигать один счётчик.
 */
const PAGE = 30;

type ReadTarget = { ids: string[] } | { all: true };

type NotificationsState = {
  unreadCount: number;
  latestAt: string | null;
  items: NotificationItem[];
  isLoaded: boolean;
  isLoading: boolean;
  nextBefore: string | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  fetchSummary: () => Promise<void>;
  /** Фоновый опрос: без индикаторов, сбои сети глотает */
  silentRefresh: () => Promise<void>;
  fetchList: (options?: { more?: boolean }) => Promise<void>;
  markRead: (target: ReadTarget) => Promise<void>;
  /** Счётчик уже посчитал сервер (ответ «просмотрено» со страницы заявки) */
  applyUnreadCount: (unreadCount: number, ticketId?: string | null) => void;
};

let listSeq = 0;

const useNotificationsStore = create<NotificationsState>()((set, get) => ({
  unreadCount: 0,
  latestAt: null,
  items: [],
  isLoaded: false,
  isLoading: false,
  nextBefore: null,
  open: false,

  setOpen: (open) => {
    set({ open });
    if (open) void get().fetchList();
  },

  fetchSummary: async () => {
    const summary = await api<NotificationsSummary>(
      "/api/notifications/summary",
    );
    const changed =
      summary.unreadCount !== get().unreadCount ||
      summary.latestAt !== get().latestAt;
    set({ unreadCount: summary.unreadCount, latestAt: summary.latestAt });
    // Панель открыта, а набор изменился — перечитываем список: иначе новое
    // видно только по счётчику
    if (changed && get().open) await get().fetchList();
  },

  silentRefresh: async () => {
    try {
      await get().fetchSummary();
    } catch (error) {
      console.warn("notifications: пропущено обновление:", error);
    }
  },

  fetchList: async ({ more = false } = {}) => {
    const before = more ? get().nextBefore : null;
    if (more && !before) return;
    const requestId = ++listSeq;
    set({ isLoading: true });
    try {
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (before) params.set("before", before);
      const data = await api<NotificationsListResponse>(
        `/api/notifications?${params}`,
      );
      if (requestId !== listSeq) return;
      set({
        items: more ? [...get().items, ...data.items] : data.items,
        unreadCount: data.unreadCount,
        nextBefore: data.nextBefore,
        isLoaded: true,
        isLoading: false,
      });
    } catch (error) {
      if (requestId !== listSeq) return;
      console.warn("notifications: список не загрузился:", error);
      set({ isLoading: false });
    }
  },

  markRead: async (target) => {
    const data = await api<NotificationsReadResponse>(
      "/api/notifications/read",
      { method: "POST", body: target },
    );
    const now = new Date().toISOString();
    const ids = "ids" in target ? new Set(target.ids) : null;
    set({
      unreadCount: data.unreadCount,
      items: get().items.map((item) =>
        item.readAt || (ids && !ids.has(item._id))
          ? item
          : { ...item, readAt: now },
      ),
    });
  },

  applyUnreadCount: (unreadCount, ticketId = null) => {
    const now = new Date().toISOString();
    set({
      unreadCount,
      items: ticketId
        ? get().items.map((item) =>
            !item.readAt && item.ticketId === ticketId
              ? { ...item, readAt: now }
              : item,
          )
        : get().items,
    });
  },
}));

export default useNotificationsStore;
