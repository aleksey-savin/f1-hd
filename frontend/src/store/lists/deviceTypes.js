import { create } from "zustand";

import { api } from "@/lib/api";

const deviceTypeFilter = (state) => {
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
      if (state.kind === "component") return item.isComponent;
      if (state.kind === "consumable") return item.isConsumable;
      if (state.kind === "peripheral") return item.isPeripheral;
      // Основные устройства — типы без спец-флагов
      if (state.kind === "primary")
        return !item.isComponent && !item.isConsumable && !item.isPeripheral;
      return true;
    })
    .filter((item) => {
      if (Array.isArray(state.attributes) && state.attributes.length > 0) {
        const itemAttributeIds = (item.attributes || []).map((attr) =>
          String(attr.attributeId?._id ?? attr.attributeId),
        );
        return state.attributes.every((selected) =>
          itemAttributeIds.includes(String(selected._id)),
        );
      }
      return true;
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

  const queryTerms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fieldsToSearch = [item.name, item.description];

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

const useDeviceTypeFilterStore = create((set) => ({
  isActive: false,
  kind: null,
  attributes: [],
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
      filteredList: searchItems(query, deviceTypeFilter(state)),
    })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    try {
      const data = await api("/api/inventory/device-types");
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
      kind: data.kind ?? null,
      attributes: Array.isArray(data.attributes) ? data.attributes : [],
      originalList: Array.isArray(data.originalList) ? data.originalList : [],
      isLoading: false,
    })),
  applyFilter: () =>
    set((state) => ({ filteredList: deviceTypeFilter(state) })),
  resetFilter: () => {
    set(() => ({
      isActive: false,
      kind: null,
      attributes: [],
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: deviceTypeFilter(state),
    }));
  },
}));

export default useDeviceTypeFilterStore;
