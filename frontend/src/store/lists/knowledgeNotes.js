import { create } from "zustand";
import { getLocalStorageData } from "../../util/auth";
import { NOTE_TYPES } from "../../util/knowledgeNoteTypes";

// Все типы включены — значение по умолчанию для фильтра по типу
const defaultEnabledTypes = () =>
  Object.fromEntries(NOTE_TYPES.map((type) => [type.value, true]));

// Есть ли активный фильтр (поиск или хотя бы один выбранный селект).
// Нужен для текста пустого состояния: сам список фильтр не «открывает».
export const hasActiveFilter = (state) =>
  (state.searchTerm && state.searchTerm.length > 0) ||
  state.companies.length > 0 ||
  state.users.length > 0 ||
  state.categories.length > 0;

// Отсев по типу: применяется всегда; при всех включённых типах эффекта нет
const applyTypes = (list, enabledTypes = {}) =>
  list.filter((note) => enabledTypes[note.type || "info"] !== false);

const idsOf = (items = []) => items.map((item) => item._id.toString());

// Заметки для режима модерации — в обход скоупинга (компания/категория/пользователь),
// но с учётом фильтра по типу: набор на проверку можно сузить.
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

  return applyTypes(list, state.enabledTypes);
};

// Набор данных на сервере + поиск. Поиск ушёл на бэкенд вместе с plainText:
// на двух сотнях статей клиентский поиск стоил мегабайты трафика на каждый
// заход в раздел.
const datasetQuery = (state) => {
  const params = new URLSearchParams();
  if (state.scope === "archived") {
    params.set("archived", "true");
  } else if (state.moderationMode === "flagged-secrets") {
    params.set("flaggedSecrets", "true");
  }
  if (state.searchTerm?.trim()) {
    params.set("search", state.searchTerm.trim());
  }
  const query = params.toString();
  return query ? `?${query}` : "";
};

// Клиентские фильтры поверх серверного набора: тип и привязки. Без фильтра
// показываем ВСЕ видимые заметки — бэкенд уже отдал ровно разрешённое, и
// прятать их до ввода запроса значило бы прятать базу знаний от её читателей.
const noteFilter = (state) => {
  if (state.moderationMode) {
    return moderationFilter(state);
  }

  let list = applyTypes(state.originalList || [], state.enabledTypes);

  const companyIds = idsOf(state.companies);
  if (companyIds.length > 0) {
    list = list.filter((note) =>
      (note.companies || []).some((company) =>
        companyIds.includes(company._id.toString()),
      ),
    );
  }

  const userIds = idsOf(state.users);
  if (userIds.length > 0) {
    list = list.filter((note) =>
      (note.users || []).some((user) => userIds.includes(user._id.toString())),
    );
  }

  const categoryIds = idsOf(state.categories);
  if (categoryIds.length > 0) {
    list = list.filter((note) =>
      (note.categories || []).some((category) =>
        categoryIds.includes(category._id.toString()),
      ),
    );
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

// Поиск бьёт по серверу, поэтому не на каждую букву.
const SEARCH_DEBOUNCE_MS = 300;
let searchTimer = null;

const useKnowledgeNotesStore = create((set, get) => ({
  // Выбранные значения фасетов храним объектами, а не id: серверный поиск
  // сужает набор, а вместе с ним и список опций — по одному id восстановить
  // пилюлю выбранного значения было бы уже нечем.
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
  sortBy: { label: "Сначала изменённые" },
  isSorting: false,
  originalList: [],
  filteredList: [],
  isLoading: false,
  loaded: false,
  // Режим модерации: null | "all-unapproved" | "pending-deletion" | "pending-archive" | "flagged-secrets"
  moderationMode: null,
  // Набор данных: активные заметки или архив (взаимоисключающие)
  scope: "active",
  // Выделение для массовых действий модерации
  selectedIds: [],
  // Раскрытые группы-компании в проводнике. По умолчанию свёрнуты все, включая
  // «Общие»: список папок целиком помещается на экран, и это и есть навигация.
  expandedGroups: [],
  // Мобильный drill-down: открытая компания (ключ группы) или null — список компаний
  openCompany: null,
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
      // Заметки, исчезнувшие из набора (удалены, заархивированы, проверены),
      // не должны тянуться в следующее массовое действие.
      const present = new Set(originalList.map((note) => note._id));
      return {
        originalList,
        filteredList,
        loaded: true,
        isLoading: false,
        lastFetchedQuery: query,
        selectedIds: state.selectedIds.filter((id) => present.has(id)),
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

  // Применяет текущие фильтры; рефетчит, если сменился серверный набор
  refresh: async () => {
    const state = get();
    const query = datasetQuery(state);
    if (!state.loaded || query !== state.lastFetchedQuery) {
      await state.fetch();
    } else {
      state.applyFilter();
    }
  },

  // Частичное обновление фильтров (компании / пользователи / категории / тип)
  updateFilter: (data) => set((state) => ({ ...state, ...data })),

  // Поиск: значение в инпуте меняем сразу, серверный запрос — с задержкой.
  // Очистка запроса сворачивает папки обратно: их раскрыл поиск, а не человек.
  fullTextSearch: (query) => {
    const searchTerm = query || "";
    set(
      searchTerm.trim()
        ? { searchTerm }
        : { searchTerm, expandedGroups: [], openCompany: null },
    );
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => get().refresh(), SEARCH_DEBOUNCE_MS);
  },

  // Режим модерации: показать все заметки заданного статуса, игнорируя скоупинг.
  // Взаимоисключающе с архивом; flagged-secrets грузит свой набор.
  setModerationMode: (mode) => {
    set({
      moderationMode: mode,
      scope: "active",
      selectedIds: [],
      openCompany: null,
    });
    return get().refresh();
  },

  // Набор данных: "active" | "archived". Архив несовместим с режимом модерации.
  setScope: (scope) => {
    set({ scope, moderationMode: null, selectedIds: [], openCompany: null });
    return get().refresh();
  },

  toggleSelected: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((selected) => selected !== id)
        : [...state.selectedIds, id],
    })),

  clearSelection: () => set({ selectedIds: [] }),

  toggleGroup: (key) =>
    set((state) => ({
      expandedGroups: state.expandedGroups.includes(key)
        ? state.expandedGroups.filter((group) => group !== key)
        : [...state.expandedGroups, key],
    })),

  // Раскрыть папки, не трогая уже раскрытые. Возврат state без изменений —
  // настоящий no-op: zustand сравнивает по Object.is и не будит подписчиков,
  // иначе вызов из useEffect зациклил бы рендер.
  expandGroups: (keys) =>
    set((state) => {
      const missing = keys.filter((key) => !state.expandedGroups.includes(key));
      return missing.length
        ? { expandedGroups: [...state.expandedGroups, ...missing] }
        : state;
    }),

  setOpenCompany: (key) => set({ openCompany: key }),

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
    clearTimeout(searchTimer);
    set(() => ({
      companies: [],
      users: [],
      categories: [],
      enabledTypes: defaultEnabledTypes(),
      searchTerm: "",
      moderationMode: null,
      scope: "active",
      selectedIds: [],
      openCompany: null,
    }));
    return get().refresh();
  },
}));

export default useKnowledgeNotesStore;
