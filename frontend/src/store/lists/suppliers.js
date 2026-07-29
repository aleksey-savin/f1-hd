import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";

// Справочник поставщиков — маленький, поэтому выборка клиентская (как у
// вендоров): бэкенд отдаёт список целиком вместе с агрегатами закупок.
const SORT = {
  purchases: { label: "По закупкам" },
  name: { label: "По названию" },
  created: { label: "Сначала новые" },
};

const supplierFilter = (state) => {
  const list = Array.isArray(state.originalList) ? state.originalList : [];
  const term = state.searchTerm.toLowerCase();
  return list
    .filter((item) => (state.isActive ? item.isActive : true))
    .filter((item) =>
      term
        ? [item.name, item.phone, item.email, item.inn, item.website]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(term)
        : true,
    );
};

// Сортировка применяется ко всем пересборкам списка, а не только к смене
// сортировки: иначе после рефетча порядок «прыгал» бы на серверный.
const sortItems = (items, sortBy) => {
  const sorted = [...items];
  if (sortBy?.label === SORT.name.label) {
    return sorted.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }
  if (sortBy?.label === SORT.created.label) {
    return sorted.sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    );
  }
  // По умолчанию — по сумме закупок: список открывают, чтобы понять, с кем
  // работаем чаще.
  return sorted.sort(
    (a, b) =>
      (b.totalSpent || 0) - (a.totalSpent || 0) ||
      a.name.localeCompare(b.name, "ru"),
  );
};

const useSupplierFilterStore = create((set) => ({
  searchTerm: "",
  isActive: false,
  originalList: [],
  filteredList: [],
  isLoading: false,
  isSorting: false,

  sortingOptions: [SORT.purchases, SORT.name, SORT.created],
  sortBy: SORT.purchases,

  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/suppliers`,
        { headers: { Authorization: "Bearer " + token } },
      );
      if (!response.ok) throw new Error(`suppliers ${response.status}`);
      const data = await response.json();
      set({ originalList: Array.isArray(data) ? data : [], isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      console.warn("Загрузка поставщиков пропущена:", error);
    }
  },

  applyFilter: () =>
    set((state) => ({
      filteredList: sortItems(supplierFilter(state), state.sortBy),
    })),

  fullTextSearch: (query) =>
    set((state) => {
      const next = { ...state, searchTerm: query.toLowerCase() };
      return {
        searchTerm: next.searchTerm,
        filteredList: sortItems(supplierFilter(next), state.sortBy),
      };
    }),

  handleSorting: (option) =>
    set((state) => ({
      sortBy: option,
      filteredList: sortItems(supplierFilter(state), option),
    })),

  updateFilter: (data) =>
    set((state) => {
      const next = { ...state, isActive: data.isActive };
      return {
        isActive: next.isActive,
        filteredList: sortItems(supplierFilter(next), state.sortBy),
      };
    }),

  resetFilter: () =>
    set((state) => {
      const next = { ...state, isActive: false, searchTerm: "" };
      return {
        isActive: false,
        searchTerm: "",
        filteredList: sortItems(supplierFilter(next), state.sortBy),
      };
    }),
}));

export default useSupplierFilterStore;
