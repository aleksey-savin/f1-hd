import { useEffect } from "react";
import { useFetcher, useRevalidator } from "react-router";

import useToastStore from "../store/toast-store";

// Обёртка над useFetcher для действий над заявкой. Если сервер отклонил действие
// как применённое к устаревшей версии (409 → { conflict: true }), показываем тост
// и тихо ревалидируем заявку, чтобы пользователь увидел свежее состояние и
// осознанно повторил действие. Само действие при этом не применяется.
//
// Отказ по правилу процесса (422: нет работ, невыполненный обязательный пункт)
// сервер называет словами — показываем его фразу тем же тостом. Иначе бизнес-
// правило выглядело бы как поломка: страница ошибки вместо объяснения.
const useTicketAction = () => {
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const { showToast } = useToastStore();

  useEffect(() => {
    if (fetcher.data?.conflict) {
      showToast(
        "warning",
        "Заявка была изменена другим пользователем. Данные обновлены — повторите действие.",
      );
      revalidator.revalidate();
      return;
    }
    if (fetcher.data?.error && fetcher.data?.message) {
      showToast("danger", fetcher.data.message);
      revalidator.revalidate();
    }
  }, [fetcher.data]);

  return fetcher;
};

export default useTicketAction;
