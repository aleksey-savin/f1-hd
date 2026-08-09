import { create } from "zustand";

import { getLocalStorageData } from "../../util/auth";
import { prevMonthRange } from "../../util/period";

// Сегмент «Работы» страницы «Архив» — список на серверной выборке (калька
// closed-tickets): поиск, фасеты, сортировку и постраничность считает бэкенд
// (GET /api/works), вместе с суммарной длительностью ВСЕЙ выборки
// (totalDurationMs — ИТОГО легаси-отчёта). Контракт app/ListWrapper сохранён
// (fullTextSearch / handleSorting / sortBy / sortingOptions / isLoading /
// isSorting / resetFilter). Опции фасетов — из общего loader страницы
// (/tickets/form-data?includeInactive=true): responsibles каталога — это и
// есть исполнители работ (активные с canPerformTickets, как в легаси-отчёте).
const API = import.meta.env.VITE_API_ADDRESS;
const PAGE_SIZE = 50;

// Сортировки по label (их показывает дропдаун ListWrapper) → серверный ключ
const SORT = {
  finished_desc: { label: "Сначала недавние" },
  finished_asc: { label: "Сначала старые" },
};
const SORT_KEY_BY_LABEL = Object.fromEntries(
  Object.entries(SORT).map(([key, option]) => [option.label, key]),
);
const SORTING_OPTIONS = [SORT.finished_desc, SORT.finished_asc];

const EMPTY_FILTERS = {
  from: "",
  to: "",
  companies: [],
  categories: [],
  executors: [],
};

// Дефолт и «Сбросить» — период за прошлый месяц (текущий ещё «не в архиве»);
// период целиком снимается бейджем в плашке или очисткой дат в шторке
const DEFAULT_FILTERS = { ...EMPTY_FILTERS, ...prevMonthRange() };

let searchDebounce;

const buildParams = (s) => {
  const p = new URLSearchParams();
  if (s.searchTerm) p.set("search", s.searchTerm);
  if (s.from) p.set("from", s.from);
  if (s.to) p.set("to", s.to);
  if (s.companies.length) p.set("companies", s.companies.join(","));
  if (s.categories.length) p.set("categories", s.categories.join(","));
  if (s.executors.length) p.set("executors", s.executors.join(","));
  p.set("sort", SORT_KEY_BY_LABEL[s.sortBy?.label] || "finished_desc");
  p.set("page", String(s.page));
  p.set("limit", String(PAGE_SIZE));
  return p;
};

const doFetch = async (get, set, { append = false } = {}) => {
  const { token } = getLocalStorageData();
  set({ isLoading: true });
  try {
    const url = new URL(`${API}/api/works`, window.location.origin);
    url.search = buildParams(get()).toString();
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!response.ok) throw new Error(`finished works ${response.status}`);
    const data = await response.json();
    set((state) => ({
      items: append ? [...state.items, ...data.works] : data.works,
      total: typeof data.total === "number" ? data.total : data.works.length,
      totalDurationMs: data.totalDurationMs || 0,
      isLoading: false,
      isSorting: false,
    }));
  } catch (error) {
    set({ isLoading: false, isSorting: false });
    console.warn("Загрузка архива работ пропущена:", error);
  }
};

const useWorksStore = create((set, get) => ({
  // данные
  items: [],
  total: 0,
  totalDurationMs: 0,
  page: 1,
  pageSize: PAGE_SIZE,
  isLoading: false,
  isSorting: false,

  // фильтры (всё опционально; период по умолчанию — прошлый месяц)
  ...DEFAULT_FILTERS,
  searchTerm: "",

  // опции фасетов из form-data (полный каталог, включая отключённые компании)
  options: { companies: [], categories: [], executors: [] },

  sortingOptions: SORTING_OPTIONS,
  sortBy: SORT.finished_desc,

  fetch: () => doFetch(get, set),

  setOptions: (formData) =>
    set({
      options: {
        companies: (formData?.companies || []).map((company) => ({
          value: company._id,
          label: company.alias,
        })),
        categories: (formData?.categories || []).map((category) => ({
          value: category._id,
          label: category.title,
        })),
        executors: (formData?.responsibles || []).map((user) => ({
          value: user._id,
          label: `${user.lastName} ${user.firstName}`.trim(),
        })),
      },
    }),

  // пагинация: setPage — десктоп (замена порции), loadMore — мобайл (докрутка)
  setPage: (page) => {
    set({ page });
    doFetch(get, set);
  },
  loadMore: () => {
    set((state) => ({ page: state.page + 1 }));
    doFetch(get, set, { append: true });
  },

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

  // патч из фильтр-шторки и чипов (from/to/companies/categories/executors)
  updateFilter: (patch) => {
    set({ ...patch, page: 1 });
    doFetch(get, set);
  },

  resetFilter: () => {
    set({
      ...DEFAULT_FILTERS,
      searchTerm: "",
      page: 1,
      sortBy: SORT.finished_desc,
    });
    doFetch(get, set);
  },
}));

export default useWorksStore;
