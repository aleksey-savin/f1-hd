import { useEffect, useRef } from "react";

// Visibility-aware фоновый опрос: вызывает callback каждые intervalMs, пока
// вкладка активна. Когда вкладка скрыта — опрос на паузе (экономим сеть/батарею);
// при возврате фокуса callback вызывается сразу, чтобы данные не были устаревшими.
// enabled === false полностью останавливает опрос (например, пока пользователь
// что-то выделил/редактирует и обновление под рукой нежелательно).
const usePolling = (callback, { intervalMs = 15000, enabled = true } = {}) => {
  // Держим свежий callback в ref, чтобы не пересоздавать интервал на каждый
  // рендер (иначе таймер сбрасывался бы постоянно).
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (!enabled) return;

    let intervalId;

    const tick = () => {
      if (document.visibilityState === "visible") {
        savedCallback.current();
      }
    };

    const start = () => {
      clearInterval(intervalId);
      intervalId = setInterval(tick, intervalMs);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        savedCallback.current();
        start();
      } else {
        clearInterval(intervalId);
      }
    };

    start();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [intervalMs, enabled]);
};

export default usePolling;
