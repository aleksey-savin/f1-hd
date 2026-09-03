import { create } from "zustand";

import { api } from "@/lib/api";

const RAIL_KEY = "workStatusBarOpen";

// Статусы сотрудников для рейла, блока «Команда сейчас» и подсказок в выборе
// ответственного: лёгкий эндпоинт /users/work-statuses, обновляется фоновым
// опросом (usePolling). silentRefresh не трогает спиннеры и глотает сетевые
// сбои — пропущенный цикл некритичен, следующий тик поллинга подтянет данные.
//
// Состояние рейла (свёрнут/раскрыт) живёт здесь же, а не в самом рейле:
// раскрытый рейл стоит в потоке и сдвигает контент, значит об этом должна
// знать оболочка (layout/Root ставит класс резерва). Запоминается на
// устройстве — как тема.
const useWorkStatusesStore = create((set, get) => ({
  users: [],
  isLoaded: false,
  railOpen: localStorage.getItem(RAIL_KEY) === "true",
  fetch: async () => {
    const data = await api("/api/users/work-statuses");
    set({ users: data.users || [], isLoaded: true });
  },
  silentRefresh: async () => {
    try {
      await get().fetch();
    } catch (error) {
      console.warn("work-statuses: пропущено обновление:", error);
    }
  },
  toggleRail: () =>
    set((state) => {
      const next = !state.railOpen;
      localStorage.setItem(RAIL_KEY, String(next));
      return { railOpen: next };
    }),
}));

export default useWorkStatusesStore;
