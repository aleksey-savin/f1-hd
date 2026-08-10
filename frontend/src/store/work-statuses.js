import { create } from "zustand";

import { api } from "@/lib/api";


// Статусы сотрудников для бара: лёгкий эндпоинт /users/work-statuses,
// обновляется фоновым опросом (usePolling). silentRefresh не трогает спиннеры
// и глотает сетевые сбои — пропущенный цикл некритичен, следующий тик
// поллинга подтянет данные.
const useWorkStatusesStore = create((set, get) => ({
  users: [],
  isLoaded: false,
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
}));

export default useWorkStatusesStore;
