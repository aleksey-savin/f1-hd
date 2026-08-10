import { create } from "zustand";

import { api } from "@/lib/api";

const deviceModelFilter = (state) => {
  const originalList = Array.isArray(state.originalList)
    ? state.originalList
    : [];
  return originalList
    .filter((item) => {
      // Фасет «Тип устройства» — объект {_id, name}
      if (state.deviceType) {
        return String(item.deviceTypeId?._id) === String(state.deviceType._id);
      }
      return true;
    })
    .filter((item) => {
      // Фасет «Производитель» — объект {_id, name}
      if (state.vendor) {
        return String(item.vendorId?._id) === String(state.vendor._id);
      }
      return true;
    })
    .filter((item) => {
      if (state.searchTerm.length > 0) {
        return [item.name, item.deviceTypeId?.name, item.vendorId?.name]
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
    const fieldsToSearch = [
      item.name,
      item.deviceTypeId?.name,
      item.vendorId?.name,
      item.notes,
    ];

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

const useDeviceModelFilterStore = create((set) => ({
  deviceType: null,
  vendor: null,
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
      filteredList: searchItems(query, deviceModelFilter(state)),
    })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    try {
      const data = await api("/api/inventory/device-models");
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
      deviceType: data.deviceType ?? null,
      vendor: data.vendor ?? null,
      originalList: Array.isArray(data.originalList) ? data.originalList : [],
      isLoading: false,
    })),
  applyFilter: () =>
    set((state) => ({ filteredList: deviceModelFilter(state) })),
  resetFilter: () => {
    set(() => ({
      deviceType: null,
      vendor: null,
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: deviceModelFilter(state),
    }));
  },
}));

export default useDeviceModelFilterStore;
