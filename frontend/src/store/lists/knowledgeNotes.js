import { create } from "zustand";
import { getLocalStorageData } from "../../util/auth";
import { NOTE_TYPES, getNoteTypeMeta } from "../../util/knowledgeNoteTypes";

// Все типы включены — значение по умолчанию для фильтра по типу
const defaultEnabledTypes = () =>
  Object.fromEntries(NOTE_TYPES.map((type) => [type.value, true]));

// Строка для поиска по заметке: заголовок, текст, связанные сущности, тип
const buildSearchString = (note) =>
  [
    note.title,
    note.plainText,
    getNoteTypeMeta(note.type).label,
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

// Заметки для режима модерации — в обход скоупинга (компания/категория/пользователь),
// но с учётом фильтра по типу и поиска, чтобы можно было сузить набор на проверку.
const moderationFilter = (state) => {
  let list = state.originalList || [];

  switch (state.moderationMode) {
    case "all-unapproved":
      list = list.filter((note) => note.approved !== true);
      break;
    case "pending-deletion":
      list = list.filter((note) => note.pendingDeletion);
      break;
    case "pending-archive":
      list = list.filter((note) => note.pendingArchive);
      break;
    case "flagged-secrets":
      list = list.filter((note) => note.secretsScan?.flagged);
      break;
    default:
      break;
  }

  const enabledTypes = state.enabledTypes || {};
  list = list.filter((note) => enabledTypes[note.type || "info"] !== false);

  if (state.searchTerm?.length > 0) {
    const terms = state.searchTerm.toLowerCase().split(" ").filter(Boolean);
    list = list.filter((note) => {
      const haystack = buildSearchString(note);
      return terms.every((term) => haystack.includes(term));
    });
  }

  return list;
};

// «Общая» заметка — без привязок к компаниям, пользователям и категориям
const isGlobalNote = (note) =>
  (note.companies || []).length === 0 &&
  (note.users || []).length === 0 &&
  (note.categories || []).length === 0;

// Какой набор грузить с сервера: активные (по умолчанию), архив или все с секретами
const datasetQuery = (state) => {
  if (state.showArchived) return "?archived=true";
  if (state.moderationMode === "flagged-secrets") return "?flaggedSecrets=true";
  return "";
};

// Последовательно отсеивает заметки по активным фильтрам (мультивыбор + поиск).
// Режим модерации игнорирует фильтры. Без активного фильтра показываем только
// «общие» заметки (без привязок) — иначе их невозможно увидеть в списке.
const noteFilter = (state) => {
  if (state.moderationMode) {
    return moderationFilter(state);
  }

  const enabledTypes = state.enabledTypes || {};

  if (!hasActiveFilter(state)) {
    const base = (state.originalList || []).filter(
      (note) => enabledTypes[note.type || "info"] !== false,
    );
    // В архиве показываем все архивные; в активном виде без фильтра — только «общие»
    return state.showArchived ? base : base.filter((note) => isGlobalNote(note));
  }

  let list = state.originalList ? state.originalList : [];

  // Фильтр по типу: применяется всегда; при всех включённых типах эффекта нет,
  // выключение типа убирает его заметки из выдачи
  list = list.filter((note) => enabledTypes[note.type || "info"] !== false);

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
  enabledTypes: defaultEnabledTypes(),
  searchTerm: "",
  sortingOptions: [
    { label: "Сначала изменённые" },
    { label: "Сначала старые" },
    { label: "По алфавиту" },
  ],
  sortBy: { label: "По алфавиту" },
  isSorting: false,
  originalList: [],
  filteredList: [],
  isLoading: false,
  loaded: false,
  // Режим модерации: null | "all-unapproved" | "pending-deletion" | "pending-archive" | "flagged-secrets"
  moderationMode: null,
  // Просмотр архива: грузит архивные заметки вместо активных
  showArchived: false,
  // Последний загруженный с сервера набор — чтобы решать, нужен ли рефетч
  lastFetchedQuery: "",

  fetch: async () => {
    const query = datasetQuery(get());
    set({ isLoading: true });
    const { token } = getLocalStorageData();
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/knowledge-notes${query}`,
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
      return {
        originalList,
        filteredList,
        loaded: true,
        isLoading: false,
        lastFetchedQuery: query,
      };
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

  // Применяет текущие фильтры; рефетчит, если сменился набор (активные/архив/секреты)
  refresh: async () => {
    const state = get();
    const query = datasetQuery(state);
    if (!state.loaded || query !== state.lastFetchedQuery) {
      await state.fetch();
    } else {
      state.applyFilter();
    }
  },

  // Частичное обновление фильтров (компании / пользователи / категории / поиск)
  updateFilter: (data) => set((state) => ({ ...state, ...data })),

  // Режим модерации: показать все заметки заданного статуса, игнорируя скоупинг.
  // Взаимоисключающе с просмотром архива; flagged-secrets грузит свой набор.
  setModerationMode: (mode) => {
    set({ moderationMode: mode, showArchived: false });
    return get().refresh();
  },

  // Просмотр архива (или возврат к активным). Взаимоисключающе с режимом модерации.
  setShowArchived: (value) => {
    set({ showArchived: value, moderationMode: null });
    return get().refresh();
  },

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
      enabledTypes: defaultEnabledTypes(),
      searchTerm: "",
      moderationMode: null,
      showArchived: false,
    }));
    return get().refresh();
  },
}));

export default useKnowledgeNotesStore;
