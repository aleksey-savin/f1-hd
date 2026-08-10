import { create } from "zustand";

import { api } from "@/lib/api";

import type { CompaniesSummaryResponse, PeriodRange } from "../../types/report";
import { monthRange } from "../../util/period";

// Сегмент «Сводка» отчёта «Компании»: данные грузятся сразу при открытии за
// текущий месяц (отчёт — живой взгляд на «сейчас», в отличие от архива с
// прошлым месяцем), смена периода сама делает запрос. При ошибке устаревший
// отчёт остаётся видимым под баннером (data не сбрасывается); контракт UI:
// isLoading && !data — скелет, isLoading && data — приглушение контента.
type SummaryState = {
  from: string;
  to: string;
  data: CompaniesSummaryResponse | null;
  isLoading: boolean;
  error: string | null;
  fetch: () => void;
  /** Патч периода (MonthStepper — целиком, шторка — по одной дате). */
  setPeriod: (patch: Partial<PeriodRange>) => void;
  resetPeriod: () => void;
};

type Getter = () => SummaryState;
type Setter = (partial: Partial<SummaryState>) => void;

// Защита от гонок при быстром листании месяцев
let requestSeq = 0;

const doFetch = async (get: Getter, set: Setter) => {
  const { from, to } = get();
  // Произвольный период задан наполовину — ждём вторую дату
  if (!from || !to) return;

  const requestId = ++requestSeq;
  set({ isLoading: true });
  try {
    const search = new URLSearchParams({ from, to }).toString();
    const data = (await api(`/api/report/companies?${search}`)) as CompaniesSummaryResponse;
    if (requestId !== requestSeq) return;
    set({ data, isLoading: false, error: null });
  } catch (error) {
    if (requestId !== requestSeq) return;
    console.warn("Сводка по компаниям не загрузилась:", error);
    set({
      isLoading: false,
      error: "Не удалось загрузить сводку. Проверьте соединение и повторите.",
    });
  }
};

const useCompaniesSummaryStore = create<SummaryState>()((set, get) => ({
  // Дефолт — текущий месяц
  ...monthRange(new Date()),
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
}));

export default useCompaniesSummaryStore;
