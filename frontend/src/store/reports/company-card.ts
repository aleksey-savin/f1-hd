import { create } from "zustand";

import type {
  CompanyCardResponse,
  PeriodRange,
  SubdivisionCardResponse,
} from "../../types/report";
import { monthRange } from "../../util/period";

// Карточка компании и карточка подразделения — один стор: экраны различаются
// только адресом и парой блоков, а состояние у них одинаковое (период, гонки,
// «ошибка не сбрасывает данные»). Период приходит из сводки при открытии,
// поэтому переход «сводка → карточка» не сбрасывает выбранный месяц.
const API = import.meta.env.VITE_API_ADDRESS;

type CardTarget = {
  companyId: string;
  /** Задан — открыта карточка подразделения. */
  subdivisionId?: string | null;
};

type CardState = CardTarget & {
  from: string;
  to: string;
  includeDescendants: boolean;
  data: CompanyCardResponse | SubdivisionCardResponse | null;
  isLoading: boolean;
  error: string | null;
  /** 403 от сервера — доступ к чужой компании/подразделению. */
  isForbidden: boolean;
  open: (target: CardTarget & Partial<PeriodRange>) => void;
  fetch: () => void;
  setPeriod: (patch: Partial<PeriodRange>) => void;
  resetPeriod: () => void;
  setIncludeDescendants: (value: boolean) => void;
};

type Getter = () => CardState;
type Setter = (partial: Partial<CardState>) => void;

let requestSeq = 0;

const doFetch = async (get: Getter, set: Setter) => {
  const { companyId, subdivisionId, from, to, includeDescendants } = get();
  if (!companyId || !from || !to) return;

  const requestId = ++requestSeq;
  set({ isLoading: true });
  try {
    const path = subdivisionId
      ? `${API}/api/report/companies/${companyId}/subdivisions/${subdivisionId}`
      : `${API}/api/report/companies/${companyId}`;
    const url = new URL(path, window.location.origin);
    const params = new URLSearchParams({ from, to });
    if (subdivisionId && !includeDescendants) {
      params.set("includeDescendants", "false");
    }
    url.search = params.toString();

    const response = await fetch(url);
    if (response.status === 403) {
      if (requestId !== requestSeq) return;
      set({ isLoading: false, isForbidden: true, data: null, error: null });
      return;
    }
    if (!response.ok) throw new Error(`company card ${response.status}`);
    const data = (await response.json()) as
      | CompanyCardResponse
      | SubdivisionCardResponse;
    if (requestId !== requestSeq) return;
    set({ data, isLoading: false, error: null, isForbidden: false });
  } catch (error) {
    if (requestId !== requestSeq) return;
    console.warn("Карточка отчёта не загрузилась:", error);
    set({
      isLoading: false,
      error: "Не удалось загрузить отчёт. Проверьте соединение и повторите.",
    });
  }
};

const useCompanyCardStore = create<CardState>()((set, get) => ({
  companyId: "",
  subdivisionId: null,
  ...monthRange(new Date()),
  includeDescendants: true,
  data: null,
  isLoading: false,
  error: null,
  isForbidden: false,

  open: ({ companyId, subdivisionId = null, from, to }) => {
    const current = get();
    const changedTarget =
      current.companyId !== companyId ||
      current.subdivisionId !== subdivisionId;
    set({
      companyId,
      subdivisionId,
      // Чужие данные не должны мелькнуть под новым заголовком
      ...(changedTarget ? { data: null, isForbidden: false, error: null } : {}),
      ...(from && to ? { from, to } : {}),
    });
    doFetch(get, set);
  },

  fetch: () => doFetch(get, set),

  setPeriod: (patch) => {
    set(patch);
    doFetch(get, set);
  },

  resetPeriod: () => {
    set(monthRange(new Date()));
    doFetch(get, set);
  },

  setIncludeDescendants: (value) => {
    set({ includeDescendants: value });
    doFetch(get, set);
  },
}));

export default useCompanyCardStore;
