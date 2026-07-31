import { create } from "zustand";

import { getLocalStorageData } from "../util/auth";

/**
 * Открытые заявки для главной — ОДИН запрос на три блока.
 *
 * «На мне», «Без ответственного» и «Давно без движения» — три вопроса к одному
 * и тому же набору, а не три выборки. Набор невелик (открытых заявок десятки),
 * бэкенд уже сузил его по правам, поэтому срезы считаются на клиенте: три
 * запроса к `all-opened` ради трёх фильтров были бы тройной ценой за одни
 * данные.
 *
 * Со списком заявок (`store/lists/tickets.js`) стор намеренно не делим: там
 * живут фасеты, сортировка, поиск и режим выбора — целое состояние страницы,
 * которое главная не использует и не должна ронять, уходя с себя.
 */

const fetchOpened = async () => {
  const { token } = getLocalStorageData();
  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/all-opened`,
    { headers: { Authorization: "Bearer " + token } },
  );
  if (!response.ok) throw new Error(`all-opened ${response.status}`);
  return response.json();
};

const useDashboardTicketsStore = create((set) => ({
  tickets: [],
  isLoading: false,
  loaded: false,
  failed: false,

  load: async () => {
    set({ isLoading: true });
    try {
      const data = await fetchOpened();
      set({
        tickets: data.tickets ?? [],
        isLoading: false,
        loaded: true,
        failed: false,
      });
    } catch (error) {
      // Первая загрузка упала — блокам нужно показать, что данных нет, а не
      // крутить спиннер вечно.
      console.error("Не удалось загрузить заявки для главной:", error);
      set({ isLoading: false, loaded: true, failed: true });
    }
  },

  // Фоновый цикл: пропущенный тик некритичен, прежние данные остаются на экране.
  refresh: async () => {
    try {
      const data = await fetchOpened();
      set({ tickets: data.tickets ?? [], failed: false });
    } catch (error) {
      console.warn("Фоновое обновление главной пропущено:", error);
    }
  },
}));

export default useDashboardTicketsStore;
