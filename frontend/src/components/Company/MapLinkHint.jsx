import { useEffect, useState } from "react";

// Подсказка под полем «Ссылка на карту»: есть ли в ссылке точка. Короткую
// ссылку «Поделиться» (yandex.ru/maps/-/…) раскрывает бэкенд — из браузера
// редирект не прочитать, — поэтому спрашиваем его с задержкой после ввода.
// Ответ ни к чему не обязывает: точку при сохранении бэкенд посчитает сам,
// а форму можно отправить, не дожидаясь.
const DEBOUNCE_MS = 600;

const IDLE_HINT =
  "Откроется из адреса; из точки в ссылке строится маршрут такси. Подойдёт ссылка «Поделиться» из Яндекс Карт или 2ГИС.";

const fixed = (value) => Number(value).toFixed(4);

const MapLinkHint = ({ url }) => {
  const [result, setResult] = useState({ status: "idle", location: null });

  useEffect(() => {
    const value = (url || "").trim();
    if (!value) {
      setResult({ status: "idle", location: null });
      return undefined;
    }
    let cancelled = false;
    setResult({ status: "checking", location: null });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/companies/resolve-map-link`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ url: value }),
          },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (cancelled) return;
        setResult(
          data.location
            ? { status: "found", location: data.location }
            : { status: "none", location: null },
        );
      } catch {
        if (!cancelled) setResult({ status: "error", location: null });
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url]);

  switch (result.status) {
    case "checking":
      return "Проверяем ссылку…";
    case "found":
      return (
        <>
          <span className="font-medium text-accent-text">Точка найдена</span>
          <span className="tabular-nums">
            {" "}
            · {fixed(result.location.lat)}, {fixed(result.location.lon)}
          </span>{" "}
          — такси построит маршрут.
        </>
      );
    case "none":
      return (
        <>
          <span className="font-medium text-warning">В ссылке нет точки</span> —
          скопируйте в Яндекс Картах или 2ГИС ссылку «Поделиться» с меткой; пока
          такси поедет без маршрута.
        </>
      );
    case "error":
      return "Не удалось проверить ссылку — точку посчитаем при сохранении.";
    default:
      return IDLE_HINT;
  }
};

export default MapLinkHint;
