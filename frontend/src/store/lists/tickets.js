import { create } from "zustand";
import { getLocalStorageData } from "../../util/auth";

const isToday = (date) => {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
};

// функция последовательно отсеивает заявки согласно активным фильтрам
const ticketFilter = (state) => {
  const { userId } = getLocalStorageData();
  const originalList = state.originalList ? state.originalList : [];
  return originalList
    .filter((ticket) => {
      switch (state.nowActive) {
        case "all_active":
          return state.originalList
            .filter((ticket) => !ticket.isClosed)
            .includes(ticket);
        case "today":
          return state.originalList
            .filter((ticket) => !ticket.isClosed)
            .filter((ticket) => isToday(new Date(ticket.deadline)))
            .includes(ticket);
        case "not_processed":
          return state.originalList
            .filter((ticket) => !ticket.isClosed)
            .filter((ticket) => ticket.state === "Новая")
            .includes(ticket);
        case "overdue":
          return state.originalList
            .filter((ticket) => !ticket.isClosed)
            .filter((ticket) => new Date(ticket.deadline) < new Date())
            .includes(ticket);
        case "i_am_applicant":
          return state.originalList
            .filter(
              (ticket) =>
                ticket.applicant._id.toString() === userId && !ticket.isClosed,
            )
            .includes(ticket);
        case "recently_closed":
          return state.originalList
            .filter((ticket) => ticket.isClosed)
            .includes(ticket);
        default:
          return true;
      }
    })
    .filter((ticket) => {
      if (state.companies?.length > 0) {
        return state.companies.includes(ticket.company._id.toString());
      } else {
        return true;
      }
    })
    .filter((ticket) => {
      if (state.responsibles?.length > 0) {
        const isEqual = (a, b) => a === b;
        return ticket.responsibles
          .map((resp) => resp._id.toString())
          .some((item2) =>
            state.responsibles.some((item1) => isEqual(item1, item2)),
          );
      } else {
        return true;
      }
    })
    .filter((ticket) => {
      if (state.iAmResponsible) {
        return ticket.responsibles.map((resp) => resp._id).includes(userId);
      } else {
        return true;
      }
    })
    .filter((ticket) => {
      if (state.searchTerm.length > 0) {
        return [
          ticket.num,
          ticket.company.alias,
          ticket.applicant.lastName,
          ticket.applicant.firstName,
          JSON.stringify(ticket.responsibles),
          ticket.title,
          ticket.state,
        ]
          .join(" ")
          .toLowerCase()
          .includes(state.searchTerm);
      } else {
        return true;
      }
    })
    .filter((ticket) => {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
      const latestCommentDate = new Date(ticket.latestComment?.createdAt);
      const deadline = new Date(ticket.deadline);
      switch (state.comments) {
        case "present":
          return ticket.latestComment;
        case "abcent":
          return !ticket.latestComment;
        case "more_than_1_day":
          return !ticket.latestComment || latestCommentDate < oneDayAgo;
        case "no_comments_after_deadline":
          if (latestCommentDate) {
            return latestCommentDate > deadline;
          }
          return false;
        default:
          return true;
      }
    })
    .filter((ticket) => {
      switch (state.scheduledWorks) {
        case "present":
          return ticket.scheduledWorks?.length > 0;
        case "abcent":
          return ticket.scheduledWorks?.length === 0;
        default:
          return true;
      }
    })
    .filter((ticket) => {
      switch (state.routineTask) {
        case "present":
          return ticket.routineTask;
        case "absent":
          return !ticket.routineTask;
        default:
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
      String(item.num),
      item.company?.alias,
      item.title,
      `${item.applicant?.firstName} ${item.applicant?.lastName}`,
      item.applicant?.firstName,
      item.applicant?.lastName,
      item.applicant?.email,
      item.applicant?.phone,
      item.applicant?.position,
      item.applicant?.role,
      item.state,
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

    case "Дедлайн":
      sortedList.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
      break;

    default:
      break;
  }

  return sortedList;
};

const useTicketFilterStore = create((set) => ({
  nowActive: "all_active",
  iAmResponsible: false,
  companies: [],
  responsibles: [],
  comments: "any",
  scheduledWorks: "any",
  routineTask: "any",
  searchTerm: "",
  sortingOptions: [
    {
      label: "Сначала новые",
    },
    { label: "Сначала старые" },
    { label: "По алфавиту" },
    { label: "Дедлайн" },
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
  recentlyClosedList: [],
  isLoading: false,
  fetchOpened: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/all-opened`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );
    const data = await response.json();

    set({
      originalList: data.tickets,
      isLoading: false,
    });
  },
  fetchRecentlyClosed: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/recently-closed`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );
    const data = await response.json();

    if (data.error) {
      set({ isLoading: false });
      return data;
    }

    set((state) => ({
      originalList: [
        ...state.originalList.filter((ticket) => !ticket.isClosed),
        ...data.tickets,
      ],
      isLoading: false,
    }));

    set(() => ({
      recentlyClosedList: data.tickets,
    }));
  },
  updateFilter: (data) =>
    set(() => ({
      nowActive: data.nowActive,
      iAmResponsible: data.iAmResponsible,
      companies: data.companies,
      responsibles: data.responsibles,
      comments: data.comments,
      scheduledWorks: data.scheduledWorks,
      routineTask: data.routineTask,
      searchTerm: data.searchTerm,
      originalList: data.originalList,
      recentlyClosedList: data.recentlyClosedList,
      isLoading: false,
    })),
  fullTextSearch: (query) =>
    set((state) => ({ filteredList: searchItems(query, ticketFilter(state)) })),
  applyFilter: () =>
    set((state) => {
      return { filteredList: ticketFilter(state) };
    }),
  resetFilter: () => {
    set(() => ({
      nowActive: "all_active",
      iAmResponsible: false,
      companies: [],
      responsibles: [],
      comments: "any",
      scheduledWorks: "any",
      routineTask: "any",
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: ticketFilter(state),
    }));
  },
}));

export default useTicketFilterStore;
