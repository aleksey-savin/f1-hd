import { useCallback, useEffect, useRef, useState } from "react";
import { useFetchers, useRevalidator } from "react-router";

/**
 * Перечитать данные маршрута, когда это безопасно; промис — когда перечитали.
 *
 * Ревалидировать можно только когда все fetcher'ы страницы простаивают: иначе
 * роутер теряет их результаты («Did not find corresponding fetcher result»).
 * Поэтому просьба запоминается флагом и исполняется, как только станет можно, —
 * а не отбрасывается, если в этот момент шло сохранение.
 *
 * Пользуются `useRefreshRoute` (после действия мимо роутера) и живые
 * обновления (hooks/use-live-route-revalidate.ts) — тем промис и нужен, чтобы
 * не просить следующую ревалидацию, пока не закончилась эта.
 */
export const useDeferredRevalidate = () => {
  const revalidator = useRevalidator();
  const fetchers = useFetchers();
  const [wanted, setWanted] = useState(false);
  const waiters = useRef([]);

  const idle =
    revalidator.state === "idle" &&
    fetchers.every((fetcher) => fetcher.state === "idle");

  useEffect(() => {
    if (!wanted || !idle) return;
    setWanted(false);
    const settled = waiters.current;
    waiters.current = [];
    Promise.resolve(revalidator.revalidate()).finally(() =>
      settled.forEach((resolve) => resolve()),
    );
  }, [wanted, idle]);

  return useCallback(
    () =>
      new Promise((resolve) => {
        waiters.current.push(resolve);
        setWanted(true);
      }),
    [],
  );
};

/**
 * Перечитать данные маршрута после действия, которое прошло МИМО роутера.
 *
 * Загрузки файлов и прочие прямые `fetch` меняют то, что нарисовано из данных
 * загрузчика (аватар в навбаре, обои страницы), но роутер об этом не знает —
 * до сих пор такие экраны просили перезагрузить страницу руками.
 *
 *   const refresh = useRefreshRoute();
 *   ...
 *   await upload();
 *   refresh();
 */
const useRefreshRoute = () => {
  const revalidate = useDeferredRevalidate();
  return () => {
    void revalidate();
  };
};

export default useRefreshRoute;
