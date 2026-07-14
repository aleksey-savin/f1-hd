import { create } from "zustand";

import { getLocalStorageData } from "../util/auth";

// Статусы сотрудников для бара: лёгкий эндпоинт /users/work-statuses,
// обновляется фоновым опросом (usePolling). silentRefresh не трогает спиннеры
// и глотает сетевые сбои — пропущенный цикл некритичен, следующий тик
// поллинга подтянет данные.
const useWorkStatusesStore = create((set, get) => ({
  users: [],
  isLoaded: false,
  fetch: async () => {
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/work-statuses`,
      { headers: { Authorization: "Bearer " + token } },
    );
    if (!response.ok) {
      throw new Error("Failed to fetch work statuses");
    }
    const data = await response.json();
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
