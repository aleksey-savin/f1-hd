import { create } from "zustand";

import type { AnalyticsSummaryResponse, PeriodRange } from "../../types/report";
import { getLocalStorageData } from "../../util/auth";
import { monthRange } from "../../util/period";

// Сегмент «Сводка» отчёта «Аналитика»: данные грузятся сразу при открытии за
// текущий месяц (аналитика — живой взгляд на «сейчас», в отличие от архива с
// прошлым месяцем), смена периода сама делает запрос. При ошибке устаревший
// отчёт остаётся видимым под баннером (data не сбрасывается); контракт UI:
// isLoading && !data — скелет, isLoading && data — приглушение контента.
const API = import.meta.env.VITE_API_ADDRESS;

export type SummaryViewType = "companies" | "employees";

type SummaryState = {
  from: string;
  to: string;
  viewType: SummaryViewType;
  data: AnalyticsSummaryResponse | null;
  isLoading: boolean;
  error: string | null;
  fetch: () => void;
  /** Патч периода (MonthStepper — целиком, шторка — по одной дате). */
  setPeriod: (patch: Partial<PeriodRange>) => void;
  resetPeriod: () => void;
  setViewType: (viewType: SummaryViewType) => void;
};

type Getter = () => SummaryState;
type Setter = (partial: Partial<SummaryState>) => void;

// Защита от гонок при быстром листании месяцев (приём seqRef из ActivityTiles)
let requestSeq = 0;

const doFetch = async (get: Getter, set: Setter) => {
  const { from, to } = get();
  // Произвольный период задан наполовину — ждём вторую дату
  if (!from || !to) return;

  const requestId = ++requestSeq;
  const { token } = getLocalStorageData();
  set({ isLoading: true });
  try {
    const url = new URL(`${API}/api/report/analytics`);
    url.search = new URLSearchParams({ from, to }).toString();
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!response.ok) throw new Error(`analytics summary ${response.status}`);
    const data = (await response.json()) as AnalyticsSummaryResponse;
    if (requestId !== requestSeq) return;
    set({ data, isLoading: false, error: null });
  } catch (error) {
    if (requestId !== requestSeq) return;
    console.warn("Сводка аналитики не загрузилась:", error);
    set({
      isLoading: false,
      error: "Не удалось загрузить сводку. Проверьте соединение и повторите.",
    });
  }
};

const useAnalyticsSummaryStore = create<SummaryState>()((set, get) => ({
  // Дефолт — текущий месяц
  ...monthRange(new Date()),
  viewType: "companies",
  data: null,
  isLoading: false,
  error: null,

  fetch: () => doFetch(get, set),

  setPeriod: (patch) => {
    set(patch);
    doFetch(get, set);
  },

  resetPeriod: () => {
    set(monthRange(new Date()));
    doFetch(get, set);
  },

  // Чистый пивот по уже загруженным данным — без запроса
  setViewType: (viewType) => set({ viewType }),
}));

export default useAnalyticsSummaryStore;
