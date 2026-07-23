import { useCallback, useRef, useState } from "react";

// Лёгкая проверка «сервер вернулся?» для состояний 502/503/504 и «Нет
// соединения»: пингуем публичный /api/app-version и по успеху перезагружаем
// страницу — после деплоя это заодно подтягивает свежие ассеты фронта.
// Ревалидацией роутера не пользуемся намеренно: после ошибки загрузчика она
// не гарантирует перезапуск упавших загрузчиков ниже границы ошибки.
export function useAvailabilityProbe() {
  const [probing, setProbing] = useState(false);
  const probingRef = useRef(false);

  const probe = useCallback(async () => {
    if (probingRef.current) {
      return;
    }
    probingRef.current = true;
    setProbing(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/app-version`,
        { cache: "no-store" },
      );
      if (response.ok) {
        window.location.reload();
        return;
      }
    } catch {
      // сервер ещё недоступен — просто ждём следующей попытки
    }
    probingRef.current = false;
    setProbing(false);
  }, []);

  return { probe, probing };
}
