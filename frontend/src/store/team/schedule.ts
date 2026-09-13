import { create } from "zustand";

import { api } from "@/lib/api";

import type { TeamScheduleResponse } from "../../types/teamSchedule";
import { monthRange } from "../../util/period";

// Календарь команды. Механика — канон страниц-отчётов
// (store/reports/*): загрузка сразу при открытии за текущий месяц, seq-guard
// от гонок листания, ошибка НЕ сбрасывает уже показанные данные.
/**
 * Месяц — «что происходит в этот день», сегодня — «кому кидать заявку»,
 * планирование — «когда безопасно поставить отпуск».
 */
export type ScheduleView = "month" | "planning";

type ScheduleState = {
  from: string;
  to: string;
  view: ScheduleView;
  company: string | null;
  subdivision: string | null;
  search: string;
  data: TeamScheduleResponse | null;
  isLoading: boolean;
  error: string | null;
  fetch: () => void;
  silentFetch: () => Promise<void>;
  setPeriod: (patch: { from: string; to: string }) => void;
  resetPeriod: () => void;
  setView: (view: ScheduleView) => void;
  setFilter: (
    patch: Partial<Pick<ScheduleState, "company" | "subdivision" | "search">>,
  ) => void;
  resetFilter: () => void;
};

type Getter = () => ScheduleState;
type Setter = (partial: Partial<ScheduleState>) => void;

let requestSeq = 0;

// silent — живое обновление (docs/live-updates.md): без индикатора загрузки и
// без плашки ошибки поверх показанных данных; пропущенное подтянет следующее
const doFetch = async (get: Getter, set: Setter, silent = false) => {
  const { from, to, company, subdivision, search } = get();
  if (!from || !to) return;

  const requestId = ++requestSeq;
  if (!silent) set({ isLoading: true });
  try {
    // Имя `query`, а не `search`: в состоянии уже есть поле `search`, и
    // одноимённая переменная затенила бы его внутри собственного инициализатора.
    const query = new URLSearchParams({
      from,
      to,
      ...(company ? { company } : {}),
      ...(subdivision ? { subdivision } : {}),
      ...(search ? { search } : {}),
    }).toString();
    const data = (await api(
      `/api/team/schedule?${query}`,
    )) as TeamScheduleResponse;
    if (requestId !== requestSeq) return;
    set({ data, isLoading: false, error: null });
  } catch (error) {
    if (requestId !== requestSeq) return;
    console.warn("Табель не загрузился:", error);
    if (silent) return;
    set({
      isLoading: false,
      error: "Не удалось загрузить графики. Проверьте соединение и повторите.",
    });
  }
};

const useTeamScheduleStore = create<ScheduleState>()((set, get) => ({
  ...monthRange(new Date()),
  view: "month",
  company: null,
  subdivision: null,
  search: "",
  data: null,
  isLoading: false,
  error: null,

  fetch: () => doFetch(get, set),
  silentFetch: () => doFetch(get, set, true),

  setPeriod: (patch) => {
    set(patch);
    doFetch(get, set);
  },

  resetPeriod: () => {
    set(monthRange(new Date()));
    doFetch(get, set);
  },

  // Режим данных не меняет — все три вида строятся из одного ответа
  setView: (view) => set({ view }),

  setFilter: (patch) => {
    set(patch);
    doFetch(get, set);
  },

  resetFilter: () => {
    set({ company: null, subdivision: null, search: "" });
    doFetch(get, set);
  },
}));

export default useTeamScheduleStore;
