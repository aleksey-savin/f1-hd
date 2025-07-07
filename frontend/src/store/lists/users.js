import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";

const userFilter = (state) => {
  const originalList = state.originalList || [];

  return originalList
    .filter((item) => {
      if (
        Array.isArray(state.timeTrackingModule) &&
        state.timeTrackingModule.length > 0
      ) {
        return (
          state.timeTrackingModule.filter(
            (permission) => item.permissions?.[permission] === true,
          ).length > 0
        );
      } else {
        return true;
      }
    })
    .filter((item) => {
      if (state.searchTerm.length > 0) {
        const searchText = [
          item.email,
          item.phone,
          `${item.firstName} ${item.lastName}`,
          item.firstName,
          item.lastName,
          item.position,
          item.role,
          ...(Array.isArray(item.categories)
            ? item.categories.map((category) => category.title)
            : []),
          ...(Array.isArray(item.responsibleForCompanies)
            ? item.responsibleForCompanies.map((company) => company.alias)
            : []),
          item.company?.alias,
        ]
          .join(" ")
          .toLowerCase();

        return searchText.includes(state.searchTerm.toLowerCase());
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
      item.email,
      item.phone,
      `${item.firstName} ${item.lastName}`,
      item.firstName,
      item.lastName,
      item.position,
      item.role,
      JSON.stringify(item.categories),
      JSON.stringify(item.responsibleForCompanies),
      item.company?.alias,
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
      sortedList.sort((a, b) => {
        const aValue =
          a.lastName.trim() === "" ? a.firstName.trim() : a.lastName.trim();
        const bValue =
          b.lastName.trim() === "" ? b.firstName.trim() : b.lastName.trim();
        return aValue.localeCompare(bValue);
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

const useUserFilterStore = create((set) => ({
  isAdmin: false,
  isServiceAccount: false,
  isCloudTelephony: false,
  permissions: [],
  tgBot: "any",
  isActive: "any",
  roles: [],
  categories: [],
  company: [],
  respForCompanies: [],
  timeTrackingModule: [],
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
  fullTextSearch: (query) =>
    set((state) => ({ filteredList: searchItems(query, userFilter(state)) })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );
    const data = await response.json();
    set({
      originalList: data.users,
      isLoading: false,
    });
  },
  updateFilter: (data) =>
    set(() => ({
      timeTrackingModule: data.timeTrackingModule,
      searchTerm: data.searchTerm,
      originalList: data.originalList,
      isLoading: false,
    })),
  applyFilter: () => set((state) => ({ filteredList: userFilter(state) })),
  resetFilter: () => {
    set(() => ({
      isAdmin: false,
      isServiceAccount: false,
      isCloudTelephony: false,
      permissions: [],
      tgBot: "any",
      isActive: "any",
      roles: [],
      categories: [],
      company: [],
      respForCompanies: [],
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: userFilter(state),
    }));
  },
}));

export default useUserFilterStore;
