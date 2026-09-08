import { create } from "zustand";

import { api } from "@/lib/api";
import { businessDayKey } from "@/util/format-date";

import { scopeTotals } from "./supplier-scope";

// Справочник поставщиков — маленький, поэтому выборка клиентская (как у
// вендоров): бэкенд отдаёт список целиком вместе с корзинами закупок
// (`purchases` — год × компания), а срез под выбранные чипы считает
// ./supplier-scope.js.
const SORT = {
  purchases: { label: "По закупкам" },
  name: { label: "По названию" },
  created: { label: "Сначала новые" },
};

/** Текущий год — по бизнес-зоне, а не по часам браузера. */
export const currentYear = () => Number(businessDayKey().slice(0, 4));

const supplierFilter = (state) => {
  const list = Array.isArray(state.originalList) ? state.originalList : [];
  const term = state.searchTerm.toLowerCase();
  return (
    list
      .filter((item) => (state.isActive ? item.isActive : true))
      // Компания отсеивает строки, год — нет: поставщик без закупок в
      // выбранном году остаётся в справочнике (сортировка сама опустит его
      // вниз), иначе справочник перестал бы быть справочником.
      .filter((item) =>
        state.companyId
          ? (item.purchases || []).some(
              (bucket) => bucket.companyId === state.companyId,
            )
          : true,
      )
      .filter((item) =>
        term
          ? [item.name, item.phone, item.email, item.inn, item.website]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(term)
          : true,
      )
      // Числа строки — уже под срез: по ним же идёт сортировка «по закупкам».
      .map((item) => ({ ...item, ...scopeTotals(item, state) }))
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
  // Чипы панели: компания (null — все) и год (null — за всё время).
  companyId: null,
  year: currentYear(),
  originalList: [],
  filteredList: [],
  isLoading: false,
  isSorting: false,

  sortingOptions: [SORT.purchases, SORT.name, SORT.created],
  sortBy: SORT.purchases,

  fetch: async () => {
    set({ isLoading: true });
    try {
      const data = await api("/api/inventory/suppliers");
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
      const next = { ...state, ...data };
      return {
        isActive: next.isActive,
        companyId: next.companyId,
        year: next.year,
        filteredList: sortItems(supplierFilter(next), state.sortBy),
      };
    }),

  resetFilter: () =>
    set((state) => {
      const next = {
        ...state,
        isActive: false,
        companyId: null,
        year: currentYear(),
        searchTerm: "",
      };
      return {
        isActive: false,
        companyId: null,
        year: next.year,
        searchTerm: "",
        filteredList: sortItems(supplierFilter(next), state.sortBy),
      };
    }),
}));

export default useSupplierFilterStore;
