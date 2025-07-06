import { create } from "zustand";
import { getLocalStorageData } from "../../util/auth";

const ticketTemplateFilter = (state) => {
  const originalList = state.originalList ? state.originalList : [];

  return originalList
    .filter((item) => {
      if (state.sharedCompanies?.length > 0) {
        const isEqual = (a, b) => a === b;
        return item.sharedCompanies
          .map((company) => company._id.toString())
          .some((item2) =>
            state.sharedCompanies.some((item1) => isEqual(item1, item2)),
          );
      } else {
        return true;
      }
    })
    .filter((item) => {
      if (state.categories?.length > 0) {
        return state.categories.includes(item.category._id.toString());
      } else {
        return true;
      }
    })
    .filter((item) => {
      if (state.sharedUsers?.length > 0) {
        const isEqual = (a, b) => a === b;
        return item.sharedUsers
          .map((user) => user._id.toString())
          .some((item2) =>
            state.sharedUsers.some((item1) => isEqual(item1, item2)),
          );
      } else {
        return true;
      }
    })
    .filter((item) => {
      if (state.searchTerm.length > 0) {
        return [item.title].join(" ").toLowerCase().includes(state.searchTerm);
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
      item.title,
      item.description,
      JSON.stringify(item.category),
      JSON.stringify(item.company),
      JSON.stringify(item.customFields),
      JSON.stringify(item.sharedCompanies),
      JSON.stringify(item.sharedUsers),
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
      sortedList.sort((a, b) => a.title.localeCompare(b.title));
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

const useTicketTemplateFilterStore = create((set) => ({
  sharedCompanies: [],
  sharedUsers: [],
  categories: [],
  searchTerm: "",
  sortingOptions: [
    {
      label: "Сначала новые",
    },
    { label: "Сначала старые" },
    { label: "По алфавиту" },
  ],
  sortBy: {
    label: "Сначала новые",
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
      filteredList: searchItems(query, ticketTemplateFilter(state)),
    })),
  isLoading: false,
  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_ADDRESS}/api/ticket-templates`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );
    const data = await response.json();
    set({
      originalList: data,
      isLoading: false,
    });
  },
  updateFilter: (data) =>
    set(() => ({
      sharedCompanies: data.sharedCompanies,
      sharedUsers: data.sharedUsers,
      categories: data.categories,
      searchTerm: data.searchTerm,
      originalList: data.originalList,
      isLoading: false,
    })),
  applyFilter: () =>
    set((state) => ({ filteredList: ticketTemplateFilter(state) })),
  resetFilter: () => {
    set(() => ({
      sharedCompanies: [],
      sharedUsers: [],
      categories: [],
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: ticketTemplateFilter(state),
    }));
  },
}));

export default useTicketTemplateFilterStore;
