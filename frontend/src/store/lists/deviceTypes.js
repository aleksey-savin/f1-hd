import { create } from "zustand";

import { api } from "@/lib/api";
import { DEFAULT_KIND, kindOf } from "@/components/DeviceType/kinds";

// Все условия, кроме назначения: по ним же считаются счётчики сегмента —
// число у «Комплектующих» отвечает, сколько их найдётся, если переключиться.
const baseFilter = (state) => {
  const originalList = Array.isArray(state.originalList)
    ? state.originalList
    : [];
  return searchItems(
    state.searchTerm,
    originalList
      .filter((item) => {
        if (state.isActive) {
          return item.isActive;
        } else {
          return true;
        }
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
      }),
  );
};

const deviceTypeFilter = (state) =>
  baseFilter(state).filter((item) => kindOf(item) === state.kind);

// Счётчики сегмента назначения: { primary, component, consumable, peripheral }
export const kindCounts = (state) => {
  const counts = { primary: 0, component: 0, consumable: 0, peripheral: 0 };
  for (const item of baseFilter(state)) counts[kindOf(item)] += 1;
  return counts;
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
    return list;
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

const recompute = (state) => ({
  filteredList: handleSorting(state.sortBy, deviceTypeFilter(state)),
});

const useDeviceTypeFilterStore = create((set) => ({
  isActive: false,
  // Назначение — сегмент «Устройства | Комплектующие | Расходники |
  // Периферия»; «все сразу» нет, по умолчанию — устройства
  kind: DEFAULT_KIND,
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

    set((state) => ({
      sortBy: data,
      ...recompute({ ...state, sortBy: data }),
      isSorting: false,
    }));
  },
  originalList: [],
  filteredList: [],
  fullTextSearch: (query) =>
    set((state) => ({
      searchTerm: query,
      ...recompute({ ...state, searchTerm: query }),
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
  setKind: (kind) =>
    set((state) => ({ kind, ...recompute({ ...state, kind }) })),
  updateFilter: (data) =>
    set(() => ({
      isActive: data.isActive,
      kind: data.kind ?? DEFAULT_KIND,
      attributes: Array.isArray(data.attributes) ? data.attributes : [],
      originalList: Array.isArray(data.originalList) ? data.originalList : [],
      isLoading: false,
    })),
  applyFilter: () => set((state) => recompute(state)),
  resetFilter: () =>
    set((state) => {
      const cleared = {
        isActive: false,
        kind: DEFAULT_KIND,
        attributes: [],
        searchTerm: "",
      };
      return { ...cleared, ...recompute({ ...state, ...cleared }) };
    }),
}));

export default useDeviceTypeFilterStore;
