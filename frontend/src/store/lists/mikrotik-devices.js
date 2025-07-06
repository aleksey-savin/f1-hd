import { create } from "zustand";
import { getLocalStorageData } from "../../util/auth";

// функция последовательно отсеивает заявки согласно активным фильтрам
const clientDeviceFilter = (state) => {
  const originalList = state.originalList ? state.originalList : [];
  return originalList.filter((item) => {
    if (state.searchTerm.length > 0) {
      return [
        item.name,
        item.boardName,
        item.serialNumber,
        item.currentFirmware,
        JSON.stringify(item.addresses),
        item.description,
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
      item.name,
      item.boardName,
      item.serialNumber,
      item.currentFirmware,
      ...item.addresses.flatMap((address) => [address]),
      item.description,
    ];

    return queryTerms.every((term) =>
      fieldsToSearch.some(
        (field) => field && field.toLowerCase().includes(term)
      )
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

const useMikrotikDeviceFilterStore = create((set) => ({
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
    const response = await fetch(
      `${import.meta.env.VITE_ADDRESS}/api/mikrotik-devices`,
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

export default useMikrotikDeviceFilterStore;
