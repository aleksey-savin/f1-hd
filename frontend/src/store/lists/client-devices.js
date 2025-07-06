import { create } from "zustand";
import { getLocalStorageData } from "../../util/auth";

// функция последовательно отсеивает заявки согласно активным фильтрам
const clientDeviceFilter = (state) => {
  const originalList = state.originalList ? state.originalList : [];
  return originalList.filter((item) => {
    if (state.searchTerm.length > 0) {
      return [
        item.company,
        item.user,
        item.location,
        item.deviceType,
        item.manufacturer,
        item.model,
        item.serialNumber,
        item.purchaseDocument,
        item.status,
        item.notes,
        item.assignedTo,
        item.ipAddress,
        item.macAddress,
        item.operatingSystem,
      ]
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

  // Split the query into individual terms (e.g., "Ольга Вознюк" becomes ["Ольга", "Вознюк"])
  const queryTerms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fieldsToSearch = [
      item.company,
      item.user,
      item.location,
      item.deviceType,
      item.manufacturer,
      item.model,
      item.serialNumber,
      item.purchaseDocument,
      item.status,
      item.notes,
      item.assignedTo,
      item.ipAddress,
      item.macAddress,
      item.operatingSystem,
    ];

    return queryTerms.every((term) =>
      fieldsToSearch.some(
        (field) => field && field.toLowerCase().includes(term)
      )
    );
  });
};

const useClientDeviceFilterStore = create((set) => ({
  searchTerm: "",
  originalList: [],
  filteredList: [],
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_ADDRESS}/api/inventory/client-devices`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );
    const data = await response.json();

    set({
      originalList: data,
      isLoading: false,
    });
  },
  updateFilter: (data) =>
    set(() => ({
      searchTerm: data.searchTerm,
      originalList: data.originalList,
      isLoading: false,
    })),
  fullTextSearch: (query) =>
    set((state) => ({
      filteredList: searchItems(query, clientDeviceFilter(state)),
    })),
  applyFilter: () =>
    set((state) => {
      return { filteredList: clientDeviceFilter(state) };
    }),
  resetFilter: () => {
    set(() => ({
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: clientDeviceFilter(state),
    }));
  },
}));

export default useClientDeviceFilterStore;
