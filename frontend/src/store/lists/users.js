import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";

// Список «Пользователи» — адресная книга на серверной выборке: поиск, фасеты,
// сортировка и постраничность считает бэкенд (клиентский поиск несовместим с
// пагинацией). Стор держит текущую порцию (items), общий счётчик (total) и
// состояние фильтров; каждое изменение фильтра/сортировки/страницы делает
// запрос само (страница только монтирует первичную загрузку). Контракт
// app/ListWrapper сохранён (fullTextSearch / handleSorting / sortBy /
// sortingOptions / isLoading / isSorting / resetFilter).
const API = import.meta.env.VITE_API_ADDRESS;
const PAGE_SIZE = 30;

// Наборы сортировок по label (их показывает дропдаун ListWrapper) → серверный
// ключ. «Сначала на связи» есть только у сотрудников (у клиентов присутствия
// нет).
const SORT = {
  name: { label: "По имени" },
  online: { label: "Сначала на связи" },
  recent: { label: "Недавно активные" },
  created: { label: "Сначала новые" },
};
const SORT_KEY_BY_LABEL = Object.fromEntries(
  Object.entries(SORT).map(([key, option]) => [option.label, key]),
);
const sortingFor = (audience) =>
  audience === "staff"
    ? [SORT.online, SORT.name, SORT.recent, SORT.created]
    : [SORT.name, SORT.recent, SORT.created];
const DEFAULT_SORT = {
  clients: SORT.name,
  staff: SORT.online,
  all: SORT.name,
};

let searchDebounce;

const buildParams = (s) => {
  const p = new URLSearchParams();
  p.set("audience", s.audience);
  if (s.activeOnly) p.set("activeOnly", "true");
  if (s.includeService) p.set("includeService", "true");
  if (s.company) p.set("company", s.company);
  if (s.online) p.set("online", "true");
  if (s.pro32) p.set("pro32", "true");
  if (s.activity && s.activity !== "any") p.set("activity", s.activity);
  if (s.searchTerm) p.set("search", s.searchTerm);
  p.set("sort", SORT_KEY_BY_LABEL[s.sortBy?.label] || "name");
  if (s.groupBySubdivision && s.company) {
    // группировка по подразделению — одна компания целиком, без пагинации
    p.set("all", "true");
  } else {
    p.set("page", String(s.page));
    p.set("limit", String(PAGE_SIZE));
  }
  return p;
};

const doFetch = async (get, set, { silent = false, append = false } = {}) => {
  const { token } = getLocalStorageData();
  if (!silent) set({ isLoading: true });
  try {
    const url = new URL(`${API}/api/users`);
    url.search = buildParams(get()).toString();
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!response.ok) throw new Error(`users ${response.status}`);
    const data = await response.json();
    set((state) => ({
      items: append ? [...state.items, ...data.users] : data.users,
      total: typeof data.total === "number" ? data.total : data.users.length,
      isLoading: false,
      isSorting: false,
    }));
  } catch (error) {
    if (!silent) set({ isLoading: false, isSorting: false });
    console.warn("Загрузка пользователей пропущена:", error);
  }
};

const useUserFilterStore = create((set, get) => ({
  // данные
  items: [],
  total: 0,
  page: 1,
  pageSize: PAGE_SIZE,
  isLoading: false,
  isSorting: false,

  // фильтры (дефолт — «Клиенты», сортировка по имени, только активные)
  audience: "clients",
  company: null,
  companyOptions: [],
  online: false,
  activity: "any",
  activeOnly: true,
  includeService: false,
  // Подключён PRO32 Connect (задан персональный API-ключ)
  pro32: false,
  groupBySubdivision: false,
  searchTerm: "",

  sortingOptions: sortingFor("clients"),
  sortBy: DEFAULT_SORT.clients,

  fetch: () => doFetch(get, set),

  // Живые статусы присутствия без перезагрузки списка: тянем лёгкое табло
  // достижимых сотрудников и мёржим workStatus в показанные строки (пагинация
  // не рвётся). Сбой глотаем — следующий опрос подтянет.
  silentRefresh: async () => {
    const { token } = getLocalStorageData();
    try {
      const response = await fetch(`${API}/api/users/work-statuses`, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!response.ok) throw new Error(`work-statuses ${response.status}`);
      const raw = await response.json();
      const list = Array.isArray(raw) ? raw : raw?.users || [];
      const byId = new Map(list.map((u) => [String(u._id), u.workStatus]));
      set((state) => ({
        items: state.items.map((item) =>
          byId.has(String(item._id))
            ? { ...item, workStatus: byId.get(String(item._id)) }
            : item,
        ),
      }));
    } catch (error) {
      console.warn("Обновление статусов пропущено:", error);
    }
  },

  // пагинация: setPage — десктоп (замена порции), loadMore — мобайл (докрутка)
  setPage: (page) => {
    set({ page });
    doFetch(get, set);
  },
  loadMore: () => {
    set((state) => ({ page: state.page + 1 }));
    doFetch(get, set, { append: true });
  },

  // набор (сотрудники/клиенты/все): пересобираем сортировки и сбрасываем
  // несовместимые фасеты
  setAudience: (audience) => {
    set({
      audience,
      page: 1,
      sortingOptions: sortingFor(audience),
      sortBy: DEFAULT_SORT[audience] || SORT.name,
      online: audience === "staff" ? get().online : false,
      groupBySubdivision: get().company ? get().groupBySubdivision : false,
    });
    doFetch(get, set);
  },

  setCompany: (company) => {
    set({
      company,
      page: 1,
      groupBySubdivision: company ? get().groupBySubdivision : false,
    });
    doFetch(get, set);
  },

  toggleGroupBySubdivision: () => {
    set((state) => ({ groupBySubdivision: !state.groupBySubdivision, page: 1 }));
    doFetch(get, set);
  },

  setCompanyOptions: (companyOptions) => set({ companyOptions }),

  handleSorting: async (data) => {
    set({ sortBy: data, isSorting: true, page: 1 });
    await doFetch(get, set);
  },

  fullTextSearch: (query) => {
    set({ searchTerm: query });
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      set({ page: 1 });
      doFetch(get, set);
    }, 300);
  },

  // патч из фильтр-шторки (online / activity / activeOnly / includeService)
  updateFilter: (patch) => {
    set({ ...patch, page: 1 });
    doFetch(get, set);
  },

  resetFilter: () => {
    set({
      audience: "clients",
      company: null,
      online: false,
      activity: "any",
      activeOnly: true,
      includeService: false,
      pro32: false,
      groupBySubdivision: false,
      searchTerm: "",
      page: 1,
      sortingOptions: sortingFor("clients"),
      sortBy: DEFAULT_SORT.clients,
    });
    doFetch(get, set);
  },
}));

export default useUserFilterStore;
