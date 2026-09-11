import { useEffect, useState } from "react";
import { useFetchers, useRevalidator } from "react-router";

/**
 * Перечитать данные маршрута после действия, которое прошло МИМО роутера.
 *
 * Загрузки файлов и прочие прямые `fetch` меняют то, что нарисовано из данных
 * загрузчика (аватар в навбаре, обои страницы), но роутер об этом не знает —
 * до сих пор такие экраны просили перезагрузить страницу руками.
 *
 * Ревалидировать можно только когда все fetcher'ы страницы простаивают: иначе
 * роутер теряет их результаты («Did not find corresponding fetcher result»).
 * Поэтому просьба запоминается флагом и исполняется, как только станет можно, —
 * а не отбрасывается, если в этот момент шло сохранение.
 *
 *   const refresh = useRefreshRoute();
 *   ...
 *   await upload();
 *   refresh();
 */
const useRefreshRoute = () => {
  const revalidator = useRevalidator();
  const fetchers = useFetchers();
  const [wanted, setWanted] = useState(false);

  const idle =
    revalidator.state === "idle" &&
    fetchers.every((fetcher) => fetcher.state === "idle");

  useEffect(() => {
    if (!wanted || !idle) return;
    setWanted(false);
    revalidator.revalidate();
  }, [wanted, idle]);

  return () => setWanted(true);
};

export default useRefreshRoute;
