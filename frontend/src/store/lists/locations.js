import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";

const locationFilter = (state) => {
  const originalList = state.originalList ? state.originalList : [];
  return originalList
    .filter(
      // Рабочие места по умолчанию скрыты — их обычно много; показываем по свитчу.
      (location) => state.showWorkplaces || location.type !== "workplace",
    )
    .filter((location) => {
      // Filter by type
      if (state.filterType && state.filterType !== "all") {
        return location.type === state.filterType;
      }
      return true;
    })
    .filter((location) => {
      // Filter by companies (multiple selection)
      if (state.selectedCompanyIds && state.selectedCompanyIds.length > 0) {
        return state.selectedCompanyIds.includes(location.company?._id);
      }
      return true;
    })
    .filter((item) => {
      if (state.searchTerm.length > 0) {
        return [
          item.name,
          item.fullPath,
          item.description,
          item.address,
          item.company?.alias,
          item.company?.fullTitle,
          item.subdivision?.name,
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

  const queryTerms = query.toLowerCase().split(" ").filter(Boolean);

  return items.filter((item) => {
    const fieldsToSearch = [
      item.name,
      item.fullPath,
      item.description,
      item.address,
      item.company?.alias,
      item.company?.fullTitle,
      item.subdivision?.name,
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
    case "По названию":
      sortedList.sort((a, b) => a.name.localeCompare(b.name));
      break;

    case "По типу":
      sortedList.sort((a, b) => {
        const typeOrder = { building: 0, floor: 1, room: 2, workplace: 3 };
        return (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
      });
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

const useLocationFilterStore = create((set) => ({
  filterType: "all",
  showWorkplaces: false,
  selectedCompanyIds: [],
  searchTerm: "",
  sortingOptions: [
    { label: "По названию" },
    { label: "По типу" },
    { label: "Сначала новые" },
    { label: "Сначала старые" },
  ],
  sortBy: {
    label: "По названию",
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
      filteredList: searchItems(query, locationFilter(state)),
    })),
  isLoading: false,
  fetch: async (companyParam = null) => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();

    let url = `${import.meta.env.VITE_API_ADDRESS}/api/inventory/companies-locations`;

    const currentState = useLocationFilterStore.getState();
    if (companyParam) {
      url += `?companyIds=${companyParam}`;
    } else if (
      currentState.selectedCompanyIds &&
      currentState.selectedCompanyIds.length > 0
    ) {
      url += `?companyIds=${currentState.selectedCompanyIds.join(",")}`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: "Bearer " + token,
      },
    });

    const data = response.ok ? await response.json() : [];
    set({
      originalList: data,
      isLoading: false,
    });
  },
  setFilterType: (filterType) =>
    set((state) => {
      const newState = { ...state, filterType };
      return {
        filterType,
        filteredList: locationFilter(newState),
      };
    }),
  setShowWorkplaces: (value) =>
    set((state) => ({
      showWorkplaces: value,
      filteredList: locationFilter({ ...state, showWorkplaces: value }),
    })),
  setSelectedCompanies: (companyIds) =>
    set((state) => {
      const newState = { ...state, selectedCompanyIds: companyIds };
      return {
        selectedCompanyIds: companyIds,
        filteredList: locationFilter(newState),
      };
    }),
  toggleCompany: (companyId) =>
    set((state) => {
      const newCompanyIds = state.selectedCompanyIds.includes(companyId)
        ? state.selectedCompanyIds.filter((id) => id !== companyId)
        : [...state.selectedCompanyIds, companyId];
      const newState = { ...state, selectedCompanyIds: newCompanyIds };
      return {
        selectedCompanyIds: newCompanyIds,
        filteredList: locationFilter(newState),
      };
    }),

  updateFilter: (data) =>
    set((state) => {
      const newState = {
        filterType: data.filterType || "all",
        selectedCompanyIds: data.selectedCompanyIds || [],
        searchTerm: data.searchTerm || "",
        originalList: data.originalList || [],
        isLoading: false,
      };

      const filteredList = locationFilter({ ...state, ...newState });
      console.log(filteredList);
      const sortedList = handleSorting(state.sortBy, filteredList);
      return {
        ...newState,
        filteredList: sortedList || filteredList,
      };
    }),
  applyFilter: () => set((state) => ({ filteredList: locationFilter(state) })),
  resetFilter: () => {
    set(() => ({
      filterType: "all",
      showWorkplaces: false,
      selectedCompanyIds: [],
      originalList: [],
      filteredList: [],
    }));
  },
}));

export default useLocationFilterStore;
