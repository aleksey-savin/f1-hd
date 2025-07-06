import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";

const companyFilter = (state) => {
  const originalList = state.originalList ? state.originalList : [];
  return originalList
    .filter((company) => {
      if (state.responsibles?.length > 0) {
        const isEqual = (a, b) => a === b;
        return company.responsibles
          .map((resp) => resp._id.toString())
          .some((item2) =>
            state.responsibles.some((item1) => isEqual(item1, item2))
          );
      } else {
        return true;
      }
    })
    .filter((item) => {
      if (state.searchTerm.length > 0) {
        return [
          item.alias,
          item.fullTitle,
          JSON.stringify(item.emailDomains),
          JSON.stringify(item.phones),
          JSON.stringify(item.responsibles),
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
      item.alias,
      item.fullTitle,
      ...item.emailDomains.flatMap((domain) => [domain]),
      ...item.phones.flatMap((phone) => [phone]),
      ...item.responsibles.flatMap((responsible) => [
        `${responsible?.firstName} ${responsible?.lastName}`,
        responsible?.firstName,
        responsible?.lastName,
        responsible?.email,
        responsible?.phone,
        responsible?.position,
        responsible?.role,
      ]),
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
      sortedList.sort((a, b) => a.alias.localeCompare(b.alias));
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

const useCompanyFilterStore = create((set) => ({
  responsibles: [],
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
    set((state) => ({
      filteredList: searchItems(query, companyFilter(state)),
    })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_ADDRESS}/api/companies`,
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
    set(() => {
      return {
        responsibles: data.responsibles,
        searchTerm: data.searchTerm,
        originalList: data.originalList,
        isLoading: false,
      };
    }),
  applyFilter: () => set((state) => ({ filteredList: companyFilter(state) })),
  resetFilter: () => {
    set(() => ({
      responsibles: [],
    }));
    set((state) => ({
      filteredList: companyFilter(state),
    }));
  },
}));

export default useCompanyFilterStore;
