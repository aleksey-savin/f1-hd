import { create } from "zustand";

import { api } from "@/lib/api";

const vendorFilter = (state) => {
  const originalList = state.originalList ? state.originalList : [];
  return originalList
    .filter((item) => {
      if (state.isActive) {
        return item.isActive;
      } else {
        return true;
      }
    })
    .filter((item) => {
      if (state.searchTerm.length > 0) {
        return [item.name].join(" ").toLowerCase().includes(state.searchTerm);
      } else {
        return true;
      }
    });
};

const searchItems = (query, items) => {
  if (!query) return items;

  // Split the query into individual terms (e.g., "Ольга Вознюк" becomes ["Ольга", "Вознюк"])
  const queryTerms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fieldsToSearch = [item.name];

    return queryTerms.every((term) =>
      fieldsToSearch.some(
        (field) => field && field.toLowerCase().includes(term),
      ),
    );
  });
};

// Применяется КО ВСЕМ пересборкам filteredList (фильтр, поиск, рефетч), а не
// только при смене сортировки: сервер отдаёт «бинарный» порядок mongo
// (кириллица и строчные — в конец), и без этого новый/обновлённый элемент
// вставал не на своё место.
const sortList = (selected, list) => {
  if (!list?.length) return list;

  const sortedList = [...list];

  switch (selected?.label) {
    case "По алфавиту":
      sortedList.sort((a, b) => a.name.localeCompare(b.name));
      break;

    case "Сначала новые":
      sortedList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;

    case "Сначала старые":
      sortedList.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      break;

    default:
      break;
  }

  return sortedList;
};

const useVendorFilterStore = create((set) => ({
  isActive: false,
  searchTerm: "",
  sortingOptions: [
    { label: "По алфавиту" },
    {
      label: "Сначала новые",
    },
    { label: "Сначала старые" },
  ],
  sortBy: {
    label: "По алфавиту",
  },
  isSorting: false,
  handleSorting: async (data) => {
    set({ isSorting: true });

    // Set new sort option immediately
    set({ sortBy: data });

    // Use Promise and setTimeout to make sorting async
    await new Promise((resolve) => setTimeout(resolve, 0));

    set((state) => {
      const sortedList = sortList(data, state.filteredList);
      return {
        sortBy: data,
        filteredList: sortedList,
        isSorting: false,
      };
    });
  },
  originalList: [],
  filteredList: [],
  fullTextSearch: (query) =>
    set((state) => ({
      filteredList: sortList(
        state.sortBy,
        searchItems(query, vendorFilter(state)),
      ),
    })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    try {
      const data = await api("/api/inventory/vendors");
      set({
        originalList: data,
        isLoading: false,
      });
    } catch {
      // Пустой список вместо молчаливого зависания: до перехода на
      // api() ответ не проверялся вовсе, и на любой ошибке стор
      // оставался в isLoading навсегда.
      set({ originalList: [], isLoading: false });
    }
  },
  updateFilter: (data) =>
    set(() => ({
      isActive: data.isActive,
      originalList: data.originalList,
      isLoading: false,
    })),
  applyFilter: () =>
    set((state) => ({
      filteredList: sortList(state.sortBy, vendorFilter(state)),
    })),
  resetFilter: () => {
    set(() => ({
      isActive: "any",
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: sortList(state.sortBy, vendorFilter(state)),
    }));
  },
}));

export default useVendorFilterStore;
