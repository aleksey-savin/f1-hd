import { create } from "zustand";

import type { PlannedWork } from "@/components/Dashboard/planned-works";
import { api } from "@/lib/api";

/**
 * Свои плановые работы для главной — ОДИН запрос на два блока.
 *
 * «Сегодня в плане» (полоса сверху) и «Дальше в плане» (правая колонка) — два
 * вопроса к одному набору, делит его `components/Dashboard/planned-works`.
 */

type PlannedWorksState = {
  works: PlannedWork[];
  loaded: boolean;
  load: () => Promise<void>;
};

const usePlannedWorksStore = create<PlannedWorksState>()((set) => ({
  works: [],
  loaded: false,

  // Сбой — блоков нет, как у остальных блоков главной; прежние данные при
  // фоновом обновлении остаются на экране
  load: async () => {
    try {
      const works = await api<PlannedWork[]>("/api/my-scheduled-works");
      set({ works, loaded: true });
    } catch (error) {
      console.warn("Плановые работы для главной не загрузились:", error);
      set({ loaded: true });
    }
  },
}));

export default usePlannedWorksStore;
