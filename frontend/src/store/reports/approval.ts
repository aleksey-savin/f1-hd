import { create } from "zustand";

import type { PipelineResponse, PipelineStageKey } from "../../types/approval";
import { getLocalStorageData } from "../../util/auth";

// Конвейер «Согласования работ». Механика та же, что у остальных отчётов
// (store/reports/*): seq-guard от гонок, ошибка не сбрасывает уже показанные
// данные. Отличие одно: периода у конвейера нет — это очередь, а не отчёт за
// месяц, и забытый май обязан оставаться видимым. Сужение по месяцу делает
// сама страница поверх загруженного набора.
const API = import.meta.env.VITE_API_ADDRESS;

type ApprovalState = {
  data: PipelineResponse | null;
  isLoading: boolean;
  error: string | null;
  /** Выбранная стадия конвейера — она же фильтр списка под рейлом. */
  stage: PipelineStageKey | "declined";
  fetch: () => void;
  /** Фоновый опрос: без скелета и без гашения уже показанных данных. */
  silentRefresh: () => void;
  setStage: (stage: PipelineStageKey | "declined") => void;
};

type Getter = () => ApprovalState;
type Setter = (partial: Partial<ApprovalState>) => void;

let requestSeq = 0;

const doFetch = async (get: Getter, set: Setter, silent = false) => {
  const requestId = ++requestSeq;
  const { token } = getLocalStorageData();
  if (!silent) {
    set({ isLoading: true });
  }
  try {
    const response = await fetch(`${API}/api/approval/pipeline`, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!response.ok) throw new Error(`approval pipeline ${response.status}`);
    const data = (await response.json()) as PipelineResponse;
    if (requestId !== requestSeq) return;
    set({ data, isLoading: false, error: null });
  } catch (error) {
    if (requestId !== requestSeq) return;
    console.warn("Конвейер согласования не загрузился:", error);
    set({
      isLoading: false,
      error: "Не удалось загрузить конвейер. Проверьте соединение и повторите.",
    });
  }
};

const useApprovalStore = create<ApprovalState>()((set, get) => ({
  data: null,
  isLoading: false,
  error: null,
  stage: "preview",

  fetch: () => doFetch(get, set),
  silentRefresh: () => doFetch(get, set, true),
  setStage: (stage) => set({ stage }),
}));

export default useApprovalStore;
