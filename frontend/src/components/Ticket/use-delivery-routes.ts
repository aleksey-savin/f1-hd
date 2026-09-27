import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { DeliveryRoutes } from "@/types/conversation";

/**
 * Маршруты «Ответить через» заявки (`GET /api/tickets/:num/delivery-routes`).
 * Перечитываются вместе с карточкой (`revision` — курсор её загрузчика) и после
 * ответа через мессенджер (`refresh`): ответ привязывает личный чат. Без
 * модуля «Диалоги» или права их читать запроса нет вовсе.
 */
export const useDeliveryRoutes = (
  ticketNum: number | string,
  { enabled, revision }: { enabled: boolean; revision?: string | null },
) => {
  const [data, setData] = useState<DeliveryRoutes | null>(null);
  const [version, setVersion] = useState(0);

  // Другая заявка — прежние маршруты не показываем, пока не приедут новые
  // (страница заявки не размонтируется при переходе на соседнюю)
  useEffect(() => {
    setData(null);
  }, [ticketNum]);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return undefined;
    }
    let alive = true;
    api<DeliveryRoutes>(`/api/tickets/${ticketNum}/delivery-routes`)
      .then((next) => {
        if (alive) setData(next);
      })
      .catch((error) => console.warn("Маршруты ответа не загрузились:", error));
    return () => {
      alive = false;
    };
  }, [ticketNum, enabled, revision, version]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  return { data, refresh };
};
