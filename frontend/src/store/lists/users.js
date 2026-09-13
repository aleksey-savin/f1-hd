import { create } from "zustand";

import { api } from "@/lib/api";


// Список «Пользователи» — адресная книга на серверной выборке: поиск, фасеты,
// сортировка и постраничность считает бэкенд (клиентский поиск несовместим с
// пагинацией). Стор держит текущую порцию (items), общий счётчик (total) и
// состояние фильтров; каждое изменение фильтра/сортировки/страницы делает
// запрос само (страница только монтирует первичную загрузку). Контракт
// app/ListWrapper сохранён (fullTextSearch / handleSorting / sortBy /
// sortingOptions / isLoading / isSorting / resetFilter).
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
  // служебные: hide (умолчание) | any | only — «hide» не шлём
  if (s.service && s.service !== "hide") p.set("service", s.service);
  if (s.company) p.set("company", s.company);
  if (s.online) p.set("online", "true");
  if (s.pro32) p.set("pro32", "true");
  if (s.roles?.length) p.set("roles", s.roles.join(","));
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
  if (!silent) set({ isLoading: true });
  try {
    // База обязательна: VITE_API_ADDRESS теперь пуст (фронт и API на одном
    // origin), а `new URL("/api/users")` без базы БРОСАЕТ «Invalid URL».
    // Абсолютному адресу база не мешает — он её перекрывает.
    const data = await api(
      `/api/users?${buildParams(get()).toString()}`,
    );
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
  // Роли — фасет и его справочник. Справочник грузит страница; без права на
  // чтение ролей он останется пустым, и фасет не показывается.
  roles: [],
  roleOptions: [],
  online: false,
  activity: "any",
  activeOnly: true,
  // Служебные аккаунты и телефония: скрыть | показать вместе со всеми (any) |
  // только их (only)
  service: "hide",
  // Подключён PRO32 Connect (задан персональный API-ключ)
  pro32: false,
  groupBySubdivision: false,
  searchTerm: "",

  sortingOptions: sortingFor("clients"),
  sortBy: DEFAULT_SORT.clients,

  fetch: () => doFetch(get, set),

  // Живые статусы присутствия без перезагрузки списка: мёржим workStatus из
  // общего табло (store/work-statuses, его держит User/PresenceSync) в
  // показанные строки — пагинация не рвётся, своего запроса у списка нет.
  mergePresence: (presence) => {
    if (!presence?.length) return;
    const byId = new Map(presence.map((u) => [String(u._id), u.workStatus]));
    set((state) => ({
      items: state.items.map((item) =>
        byId.has(String(item._id))
          ? { ...item, workStatus: byId.get(String(item._id)) }
          : item,
      ),
    }));
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
    set((state) => ({
      groupBySubdivision: !state.groupBySubdivision,
      page: 1,
    }));
    doFetch(get, set);
  },

  setCompanyOptions: (companyOptions) => set({ companyOptions }),

  setRoleOptions: (roleOptions) => set({ roleOptions }),

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

  // патч из фильтр-шторки (online / activity / activeOnly / service)
  updateFilter: (patch) => {
    set({ ...patch, page: 1 });
    doFetch(get, set);
  },

  resetFilter: () => {
    set({
      audience: "clients",
      company: null,
      roles: [],
      online: false,
      activity: "any",
      activeOnly: true,
      service: "hide",
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
