import { create } from "zustand";

import type { PipelineResponse } from "../../types/approval";

// Конвейер «Согласования работ». Механика та же, что у остальных отчётов
// (store/reports/*): seq-guard от гонок, ошибка не сбрасывает уже показанные
// данные. Отличие одно: периода у конвейера нет — это очередь, а не отчёт за
// месяц, и забытый май обязан оставаться видимым. Сужение по месяцу делает
// сама страница поверх загруженного набора. Выбранные стадия и период — в
// адресе страницы (pages/Finances/Approval), а не здесь: так возврат из
// карточки отчёта приводит туда же, откуда ушли.
const API = import.meta.env.VITE_API_ADDRESS;

type ApprovalState = {
  data: PipelineResponse | null;
  isLoading: boolean;
  error: string | null;
  fetch: () => void;
  /** Фоновый опрос: без скелета и без гашения уже показанных данных. */
  silentRefresh: () => void;
};

type Getter = () => ApprovalState;
type Setter = (partial: Partial<ApprovalState>) => void;

let requestSeq = 0;

const doFetch = async (get: Getter, set: Setter, silent = false) => {
  const requestId = ++requestSeq;
  if (!silent) {
    set({ isLoading: true });
  }
  try {
    const response = await fetch(`${API}/api/approval/pipeline`);
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

  fetch: () => doFetch(get, set),
  silentRefresh: () => doFetch(get, set, true),
}));

export default useApprovalStore;
