import { create } from "zustand";

import { getLocalStorageData } from "../util/auth";

const ZERO = {
  pendingApproval: 0,
  pendingDeletion: 0,
  pendingArchive: 0,
  secretsFlagged: 0,
};

// Счётчики очередей модерации. Их нельзя посчитать по загруженному списку:
// secretsFlagged учитывает и архивные заметки, которых в активном наборе нет.
// Общий стор, а не хук с локальным состоянием: счётчики показывают и проводник,
// и панель фильтров, и карточка на странице заявок — запрос должен быть один,
// а после массового действия все три должны обновиться разом.
const useKnowledgeModerationStore = create((set) => ({
  counts: ZERO,

  // Стартовое значение из снимка настроек (приходит вместе с логином).
  seed: (counts) => set({ counts: counts || ZERO }),

  refresh: async () => {
    const { token } = getLocalStorageData();
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/knowledge-notes/moderation-summary`,
        { headers: { Authorization: "Bearer " + token } },
      );
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      set({
        counts: {
          pendingApproval: data.pendingApproval || 0,
          pendingDeletion: data.pendingDeletion || 0,
          pendingArchive: data.pendingArchive || 0,
          secretsFlagged: data.secretsFlagged || 0,
        },
      });
    } catch {
      // сеть — оставляем прежние счётчики (фоновый запрос, не действие пользователя)
    }
  },
}));

export default useKnowledgeModerationStore;
