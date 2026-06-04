import { create } from "zustand";
import { getLocalStorageData } from "../../util/auth";

// Строка для поиска по заметке: заголовок, текст, связанные сущности
const buildSearchString = (note) =>
  [
    note.title,
    note.plainText,
    ...(note.companies || []).map((company) => company.alias),
    ...(note.users || []).flatMap((user) => [
      user.firstName,
      user.lastName,
      `${user.firstName} ${user.lastName}`,
    ]),
    ...(note.categories || []).map((category) => category.title),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

// Есть ли активный фильтр (поиск или хотя бы один выбранный селект)
const hasActiveFilter = (state) =>
  (state.searchTerm && state.searchTerm.length > 0) ||
  (state.companies && state.companies.length > 0) ||
  (state.users && state.users.length > 0) ||
  (state.categories && state.categories.length > 0);

// Последовательно отсеивает заметки по активным фильтрам (мультивыбор + поиск).
// Без активного фильтра список пуст — заметки не показываем.
const noteFilter = (state) => {
  if (!hasActiveFilter(state)) {
    return [];
  }

  let list = state.originalList ? state.originalList : [];

  if (state.companies?.length > 0) {
    list = list.filter((note) =>
      (note.companies || []).some((company) =>
        state.companies.includes(company._id.toString()),
      ),
    );
  }

  if (state.users?.length > 0) {
    list = list.filter((note) =>
      (note.users || []).some((user) =>
        state.users.includes(user._id.toString()),
      ),
    );
  }

  if (state.categories?.length > 0) {
    list = list.filter((note) =>
      (note.categories || []).some((category) =>
        state.categories.includes(category._id.toString()),
      ),
    );
  }

  if (state.searchTerm?.length > 0) {
    // Каждое слово запроса должно встречаться где-то в заметке
    const terms = state.searchTerm.toLowerCase().split(" ").filter(Boolean);
    list = list.filter((note) => {
      const haystack = buildSearchString(note);
      return terms.every((term) => haystack.includes(term));
    });
  }

  return list;
};

const handleSorting = (selected, list) => {
  if (!selected || !list?.length) {
    return list || [];
  }

  const sortedList = [...list];

  switch (selected.label) {
    case "По алфавиту":
      sortedList.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "Сначала изменённые":
      sortedList.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      break;
    case "Сначала старые":
      sortedList.sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
      break;
    default:
      break;
  }

  return sortedList;
};

const useKnowledgeNotesStore = create((set, get) => ({
  companies: [],
  users: [],
  categories: [],
  searchTerm: "",
  sortingOptions: [
    { label: "Сначала изменённые" },
    { label: "Сначала старые" },
    { label: "По алфавиту" },
  ],
  sortBy: { label: "Сначала изменённые" },
  isSorting: false,
  originalList: [],
  filteredList: [],
  isLoading: false,
  loaded: false,

  fetch: async () => {
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/knowledge-notes`,
      {
        headers: { Authorization: "Bearer " + token },
      },
    );
    const data = await response.json();

    set((state) => {
      const originalList = Array.isArray(data) ? data : [];
      const filteredList = handleSorting(
        state.sortBy,
        noteFilter({ ...state, originalList }),
      );
      return { originalList, filteredList, loaded: true, isLoading: false };
    });
  },

  // Подгружает список один раз (для опций фильтров и последующей фильтрации)
  ensureLoaded: () => {
    const state = get();
    if (state.loaded || state.isLoading) {
      return;
    }
    return state.fetch();
  },

  // Применяет текущие фильтры; при необходимости сначала лениво грузит список
  refresh: async () => {
    const state = get();
    if (!state.loaded) {
      await state.fetch();
    } else {
      state.applyFilter();
    }
  },

  // Частичное обновление фильтров (компании / пользователи / категории / поиск)
  updateFilter: (data) => set((state) => ({ ...state, ...data })),

  applyFilter: () =>
    set((state) => ({
      filteredList: handleSorting(state.sortBy, noteFilter(state)),
    })),

  handleSorting: async (data) => {
    set({ isSorting: true, sortBy: data });
    await new Promise((resolve) => setTimeout(resolve, 0));
    set((state) => ({
      sortBy: data,
      filteredList: handleSorting(data, state.filteredList),
      isSorting: false,
    }));
  },

  resetFilter: () => {
    set(() => ({
      companies: [],
      users: [],
      categories: [],
      searchTerm: "",
    }));
    set((state) => ({
      filteredList: handleSorting(state.sortBy, noteFilter(state)),
    }));
  },
}));

export default useKnowledgeNotesStore;
