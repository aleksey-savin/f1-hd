import { create } from "zustand";
import { getLocalStorageData } from "../../util/auth";

const API = `${import.meta.env.VITE_API_ADDRESS}/api/inventory/mikrotik-devices`;

// Searchable text fields of a managed-device row.
const rowSearchFields = (item) => [
  item.displayName,
  item.host,
  item.serialNumber,
  item.currentFirmware,
  item.boardName,
  item.status,
  item.model?.name,
  item.model?.vendor,
  item.location?.name,
];

// последовательно отсеивает устройства согласно активному поиску
const clientDeviceFilter = (state) => {
  const originalList = Array.isArray(state.originalList)
    ? state.originalList
    : [];
  // В таблице показываем только привязанные (настроенные) устройства. Не
  // привязанные (status === "notConfigured") остаются в originalList — из них
  // формируется список доступных для добавления через «+».
  return originalList
    .filter((item) => item.status !== "notConfigured")
    .filter((item) => {
      if (state.searchTerm.length > 0) {
        return rowSearchFields(item)
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(state.searchTerm);
      }
      return true;
    });
};

const searchItems = (query, items) => {
  if (!query) return items;

  const queryTerms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fieldsToSearch = rowSearchFields(item);
    return queryTerms.every((term) =>
      fieldsToSearch.some(
        (field) => field && String(field).toLowerCase().includes(term),
      ),
    );
  });
};

const getTime = (value) => (value ? new Date(value).getTime() : 0);

const handleSorting = (selected, list) => {
  if (!selected || !list.length) {
    return;
  }

  const sortedList = [...list];

  switch (selected.label) {
    case "По алфавиту":
      sortedList.sort((a, b) =>
        (a.displayName || "").localeCompare(b.displayName || "", "ru"),
      );
      break;

    case "Сначала новые":
      sortedList.sort(
        (a, b) =>
          getTime(b.lastSuccessfulConnectionAt) -
          getTime(a.lastSuccessfulConnectionAt),
      );
      break;

    case "Сначала старые":
      sortedList.sort(
        (a, b) =>
          getTime(a.lastSuccessfulConnectionAt) -
          getTime(b.lastSuccessfulConnectionAt),
      );
      break;

    default:
      break;
  }

  return sortedList;
};

const useMikrotikDeviceFilterStore = create((set, get) => ({
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
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(API, {
      headers: {
        Authorization: "Bearer " + token,
      },
    });
    const data = await response.json();

    set({
      originalList: Array.isArray(data) ? data : [],
      isLoading: false,
    });
  },
  // Detach a device from management (delete its record), then refresh. The
  // ClientDevice returns to the "available" pool for re-adding via «+».
  detach: async (clientDeviceId) => {
    const { token } = getLocalStorageData();
    const response = await fetch(`${API}/${clientDeviceId}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    if (response.ok) {
      await get().fetch();
    }
    return response;
  },
  // Verify-on-save connection parameters, then refresh the list.
  saveParameters: async (clientDeviceId, body) => {
    const { token } = getLocalStorageData();
    const response = await fetch(`${API}/${clientDeviceId}/parameters`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      await get().fetch();
    }
    return response;
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

export default useMikrotikDeviceFilterStore;
