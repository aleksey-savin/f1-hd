import { create } from "zustand";

import { api } from "@/lib/api";

/**
 * Каталог ролей: фильтр и сортировка целиком на клиенте.
 *
 * Ролей единицы, и весь список приезжает одним запросом — серверная выборка
 * здесь была бы работой ради работы. Условие ровно одно осмысленное («у кого
 * есть такое право») плюс поиск по названию.
 */

/**
 * Фильтр по правам — И, а не ИЛИ: вопрос «у какой роли есть доступ к финансам»
 * при двух выбранных правах означает «и то, и другое», а не «хоть что-нибудь».
 * ИЛИ вернул бы почти весь каталог и на вопрос не ответил.
 */
const rolesFilter = (state) => {
  const list = Array.isArray(state.originalList) ? state.originalList : [];
  const wanted = state.permissions || [];

  return list
    .filter((role) => wanted.every((key) => role.permissions?.[key]))
    .filter((role) => {
      if (!state.searchTerm) return true;
      return [role.title, role.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(state.searchTerm);
    });
};

const searchItems = (query, items) => {
  if (!query) return items;
  const terms = query.toLowerCase().split(" ").filter(Boolean);
  return items.filter((role) =>
    terms.every((term) =>
      [role.title, role.description].some(
        (field) => field && field.toLowerCase().includes(term),
      ),
    ),
  );
};

const sortList = (selected, list) => {
  if (!selected || !list?.length) return list;
  const sorted = [...list];

  switch (selected.label) {
    // По умолчанию: каталог читают от массовых ролей к точечным — алфавит
    // здесь ни на что не отвечает.
    case "Больше людей":
      sorted.sort((a, b) => (b.usage?.total || 0) - (a.usage?.total || 0));
      break;
    case "По названию":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "Больше прав":
      sorted.sort(
        (a, b) => grantedCount(b.permissions) - grantedCount(a.permissions),
      );
      break;
    default:
      break;
  }
  return sorted;
};

const grantedCount = (permissions = {}) =>
  Object.values(permissions).filter(Boolean).length;

const useRolesFilterStore = create((set) => ({
  permissions: [],
  searchTerm: "",
  sortingOptions: [
    { label: "Больше людей" },
    { label: "По названию" },
    { label: "Больше прав" },
  ],
  sortBy: { label: "Больше людей" },
  isSorting: false,
  handleSorting: async (data) => {
    set({ isSorting: true, sortBy: data });
    await new Promise((resolve) => setTimeout(resolve, 0));
    set((state) => ({
      filteredList: sortList(data, state.filteredList),
      isSorting: false,
    }));
  },
  originalList: [],
  filteredList: [],
  /** Словарь возможных действий — им питается фильтр по правам. */
  statement: {},
  fullTextSearch: (query) =>
    set((state) => ({
      filteredList: sortList(
        state.sortBy,
        searchItems(query, rolesFilter(state)),
      ),
    })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    try {
      const data = await api("/api/roles");
      set({
        originalList: Array.isArray(data.roles) ? data.roles : [],
        statement: data.statement || {},
        isLoading: false,
      });
    } catch {
      // Ошибку показывает страница по пустому списку: свой текст ошибки в
      // сторе завёл бы второе место, где живёт состояние загрузки.
      set({ originalList: [], isLoading: false });
    }
  },
  updateFilter: (data) =>
    set(() => ({
      permissions: Array.isArray(data.permissions) ? data.permissions : [],
      originalList: Array.isArray(data.originalList) ? data.originalList : [],
      isLoading: false,
    })),
  applyFilter: () =>
    set((state) => ({
      filteredList: sortList(state.sortBy, rolesFilter(state)),
    })),
  resetFilter: () => {
    set(() => ({ permissions: [], searchTerm: "" }));
    set((state) => ({
      filteredList: sortList(state.sortBy, rolesFilter(state)),
    }));
  },
}));

export default useRolesFilterStore;
