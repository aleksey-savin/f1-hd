import { create } from "zustand";

import { api } from "@/lib/api";

import { getLocalStorageData } from "../../util/auth";
import {
  DEFAULT_QUEUE,
  TICKET_QUEUES,
  matchesQueue,
} from "../../util/ticket-queues";

// Список активных заявок — выборка клиентская: открытых заявок десятки, и весь
// набор помещается в память целиком. Из этого следует главное свойство ленты
// очередей: её счётчики считаются по ВСЕЙ выборке, а не по странице, и потому
// честны (см. util/ticket-queues.js).
//
// Правки фильтра частичные (`updateFilter({ companies: [...] })`) и сами
// пересчитывают отфильтрованный список: раньше стор принимал слепок всего
// состояния, и любой забытый ключ молча сбрасывал соседний фасет.

const FACET_DEFAULTS = {
  queue: DEFAULT_QUEUE,
  iAmResponsible: false,
  companies: [],
  applicants: [],
  responsibles: [],
  categories: [],
  states: [],
  createdFrom: "",
  createdTo: "",
  comments: "any",
  scheduledWorks: "any",
  routineTask: "any",
  searchTerm: "",
};

const SORTING_OPTIONS = [
  { label: "Сначала новые", shortLabel: "Новые" },
  { label: "Сначала старые", shortLabel: "Старые" },
  { label: "По алфавиту", shortLabel: "А–Я" },
  { label: "Дедлайн" },
];

// Группы по состоянию — личная настройка вида списка, живёт в браузере (как
// рейл статусов): по умолчанию включена, выключается галочкой в меню
// сортировки. Сортировка при этом действует внутри групп.
const GROUP_KEY = "ticketsGroupByState";

const matchesSearch = (ticket, term) => {
  if (!term) return true;
  const terms = term.toLowerCase().split(" ").filter(Boolean);
  const haystack = [
    String(ticket.num),
    ticket.title,
    ticket.company?.alias,
    ticket.category?.title,
    ticket.state,
    ticket.applicant?.firstName,
    ticket.applicant?.lastName,
    ticket.applicant?.email,
    ticket.applicant?.phone,
    ticket.realSender,
    ...(ticket.responsibles ?? []).flatMap((user) => [
      user?.firstName,
      user?.lastName,
      user?.email,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every((part) => haystack.includes(part));
};

// Три значения вместо пяти: переключатель на три кнопки не держит больше, а
// «без ответа» вбирает и «комментариев нет вовсе», и «последний старше суток» —
// оба про одно, про молчание по заявке.
const matchesComments = (ticket, mode) => {
  if (mode === "any") return true;
  const latest = ticket.latestComment?.createdAt
    ? new Date(ticket.latestComment.createdAt)
    : null;
  if (mode === "present") return !!latest;
  if (mode === "silent") {
    return !latest || Date.now() - latest.getTime() > 24 * 60 * 60 * 1000;
  }
  return true;
};

/**
 * Все фасеты, кроме очереди: по ним считаются и список, и счётчики очередей —
 * счётчик фасета считается без него самого, иначе выбранная очередь обнуляла бы
 * соседние и лента перестала бы отвечать на свой вопрос.
 */
const matchesFacets = (ticket, state, userId) => {
  if (
    state.iAmResponsible &&
    !ticket.responsibles?.some(
      (user) => user._id?.toString() === userId?.toString(),
    )
  ) {
    return false;
  }
  if (
    state.companies.length > 0 &&
    !state.companies.includes(ticket.company?._id?.toString())
  ) {
    return false;
  }
  if (
    state.responsibles.length > 0 &&
    !ticket.responsibles?.some((user) =>
      state.responsibles.includes(user._id?.toString()),
    )
  ) {
    return false;
  }
  if (
    state.applicants.length > 0 &&
    !state.applicants.includes(ticket.applicant?._id?.toString())
  ) {
    return false;
  }
  if (
    state.categories.length > 0 &&
    !state.categories.includes(ticket.category?._id?.toString())
  ) {
    return false;
  }
  if (state.states.length > 0 && !state.states.includes(ticket.state)) {
    return false;
  }
  // Период создания — календарные дни включительно: «по 18.07» значит «весь
  // день 18-го», поэтому верхняя граница сдвигается на конец суток
  if (
    state.createdFrom &&
    new Date(ticket.createdAt) < new Date(state.createdFrom)
  ) {
    return false;
  }
  if (
    state.createdTo &&
    new Date(ticket.createdAt) > new Date(`${state.createdTo}T23:59:59`)
  ) {
    return false;
  }
  if (state.routineTask === "present" && !ticket.routineTask) return false;
  if (state.routineTask === "absent" && ticket.routineTask) return false;
  if (state.scheduledWorks === "present" && !ticket.scheduledWorks?.length) {
    return false;
  }
  if (state.scheduledWorks === "absent" && ticket.scheduledWorks?.length) {
    return false;
  }
  if (!matchesComments(ticket, state.comments)) return false;
  return matchesSearch(ticket, state.searchTerm);
};

const applyFilter = (state) => {
  const { userId } = getLocalStorageData();
  return (state.originalList ?? []).filter(
    (ticket) =>
      matchesFacets(ticket, state, userId) &&
      matchesQueue(ticket, state.queue, userId),
  );
};

const countQueues = (state) => {
  const { userId } = getLocalStorageData();
  const base = (state.originalList ?? []).filter((ticket) =>
    matchesFacets(ticket, state, userId),
  );
  return Object.fromEntries(
    TICKET_QUEUES.map(({ value }) => [
      value,
      base.filter((ticket) => matchesQueue(ticket, value, userId)).length,
    ]),
  );
};

const sortList = (sortBy, list) => {
  const sorted = [...list];
  switch (sortBy?.label) {
    case "По алфавиту":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case "Сначала старые":
      return sorted.sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      );
    case "Дедлайн":
      // Заявки без срока — в конец: пустое значение не «самый ранний дедлайн»
      return sorted.sort((a, b) => {
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline) - new Date(b.deadline);
      });
    default:
      return sorted.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      );
  }
};

// Пересчёт списка и счётчиков одним set-вызовом: список не должен мигать
// промежуточным состоянием.
const recalc = (state) => ({
  filteredList: sortList(state.sortBy, applyFilter(state)),
  queueCounts: countQueues(state),
});

const fetchTickets = async () => api("/api/tickets/all-opened");

const useTicketFilterStore = create((set, get) => ({
  ...FACET_DEFAULTS,
  originalList: [],
  filteredList: [],
  queueCounts: {},
  isLoading: false,
  isSorting: false,
  lastSyncedAt: null,
  sortingOptions: SORTING_OPTIONS,
  sortBy: SORTING_OPTIONS[0],
  groupByState: localStorage.getItem(GROUP_KEY) !== "false",

  setGroupByState: (value) => {
    localStorage.setItem(GROUP_KEY, String(value));
    set({ groupByState: value });
  },

  fetchOpened: async () => {
    set({ isLoading: true });
    let data;
    try {
      data = await fetchTickets();
    } catch (error) {
      // Сетевой сбой не роняем необработанным reject (иначе TypeError "Failed to
      // fetch" улетает в Sentry): снимаем спиннер и оставляем прежний список.
      console.error("Не удалось загрузить список заявок:", error);
      set({ isLoading: false });
      return;
    }
    set((state) => {
      const next = { ...state, originalList: data.tickets ?? [] };
      return {
        originalList: next.originalList,
        ...recalc(next),
        isLoading: false,
        lastSyncedAt: Date.now(),
      };
    });
  },

  // Фоновое обновление без флагов загрузки: список стоит на месте, меняются
  // только сами строки.
  silentRefresh: async () => {
    let data;
    try {
      data = await fetchTickets();
    } catch (error) {
      // Транзиентный сбой на фоновом опросе ожидаем (сон вкладки, обрыв связи):
      // тихо пропускаем цикл, следующий подтянет свежие данные.
      console.warn("Фоновое обновление заявок пропущено:", error);
      return;
    }
    set((state) => {
      const next = { ...state, originalList: data.tickets ?? [] };
      return {
        originalList: next.originalList,
        ...recalc(next),
        lastSyncedAt: Date.now(),
      };
    });
  },

  /** Частичная правка фасетов — остальные значения остаются как были. */
  updateFilter: (patch) =>
    set((state) => {
      const next = { ...state, ...patch };
      return { ...patch, ...recalc(next) };
    }),

  resetFilter: () =>
    set((state) => {
      const next = { ...state, ...FACET_DEFAULTS };
      return { ...FACET_DEFAULTS, ...recalc(next) };
    }),

  // ListWrapper зовёт это на каждый ввод в поиске
  fullTextSearch: (query) => get().updateFilter({ searchTerm: query }),

  handleSorting: (option) =>
    set((state) => ({
      sortBy: option,
      filteredList: sortList(option, state.filteredList),
    })),
}));

export default useTicketFilterStore;
