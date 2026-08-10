import { create } from "zustand";

import { api } from "@/lib/api";

const deviceAttributeFilter = (state) => {
  const originalList = Array.isArray(state.originalList)
    ? state.originalList
    : [];
  return originalList
    .filter((item) => {
      if (state.isActive) {
        return item.isActive;
      } else {
        return true;
      }
    })
    .filter((item) => {
      if (state.deviceType && Array.isArray(state.deviceType.attributeIds)) {
        return state.deviceType.attributeIds.includes(String(item._id));
      }
      return true;
    })
    .filter((item) => {
      if (state.valueType && state.valueType !== "all") {
        return item.valueType === state.valueType;
      } else {
        return true;
      }
    })
    .filter((item) => {
      if (state.searchTerm.length > 0) {
        return [item.name, item.code]
          .join(" ")
          .toLowerCase()
          .includes(state.searchTerm);
      } else {
        return true;
      }
    });
};

const searchItems = (query, items) => {
  if (!query) return items;

  const queryTerms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fieldsToSearch = [item.name, item.code, item.unit];

    return queryTerms.every((term) =>
      fieldsToSearch.some(
        (field) => field && field.toLowerCase().includes(term),
      ),
    );
  });
};

const handleSorting = (selected, list) => {
  if (!selected || !list.length) {
    return;
  }

  const sortedList = [...list];

  switch (selected.label) {
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

const useDeviceAttributeFilterStore = create((set) => ({
  isActive: false,
  valueType: "all",
  deviceType: null,
  searchTerm: "",
  sortingOptions: [
    { label: "По алфавиту" },
    { label: "Сначала новые" },
    { label: "Сначала старые" },
  ],
  sortBy: {
    label: "По алфавиту",
  },
  isSorting: false,
  handleSorting: async (data) => {
    set({ isSorting: true });

    set({ sortBy: data });

    await new Promise((resolve) => setTimeout(resolve, 0));

    set((state) => {
      const sortedList = handleSorting(data, state.filteredList);
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
      filteredList: searchItems(query, deviceAttributeFilter(state)),
    })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    try {
      const data = await api("/api/inventory/device-attributes");
      set({
        originalList: Array.isArray(data) ? data : [],
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
      valueType: data.valueType !== undefined ? data.valueType : "all",
      deviceType: data.deviceType ?? null,
      originalList: Array.isArray(data.originalList) ? data.originalList : [],
      isLoading: false,
    })),
  applyFilter: () =>
    set((state) => ({ filteredList: deviceAttributeFilter(state) })),
  resetFilter: () => {
    set(() => ({
      isActive: false,
      valueType: "all",
      deviceType: null,
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: deviceAttributeFilter(state),
    }));
  },
}));

export default useDeviceAttributeFilterStore;
