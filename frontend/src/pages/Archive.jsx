import { useContext, useEffect } from "react";
import { useSearchParams } from "react-router";

import Segmented from "@/components/app/Segmented";

import TicketsArchiveList from "../components/Ticket/ArchiveList";
import WorksArchiveList from "../components/Work/ArchiveList";
import { AuthedUserContext } from "../store/authed-user-context";
import useInitialPrefs from "../store/prefs";
import { getLocalStorageData } from "../util/auth";

// «Архив» — одна страница на две сущности истории: закрытые заявки и
// выполненные работы (бывший «Отчёт по работам»). Активный сегмент несёт
// query (?view=works — deep-link и редирект с /report/work), фильтры сегментов
// живут в своих zustand-сторах и переживают переключение. Сегменты — два
// отдельных компонента с двумя ListWrapper: естественный ремоунт восстанавливает
// текст поиска из стора (SearchBar неконтролируемый) и не смешивает
// count/sort/фильтры. Гейт сегмента «Работы» зеркален пункту меню легаси:
// модуль учёта времени + canUseTimeTrackingModule + canSeeWorksReport (работает
// и для конечных пользователей).

const Archive = () => {
  const { permissions } = useContext(AuthedUserContext);
  const { modules } = useInitialPrefs();
  const [searchParams, setSearchParams] = useSearchParams();

  const worksAvailable =
    !!modules?.timeTracking?.isActive &&
    !!permissions?.canUseTimeTrackingModule &&
    !!permissions?.canSeeWorksReport;

  const view =
    worksAvailable && searchParams.get("view") === "works"
      ? "works"
      : "tickets";

  // deep-link ?view=… без права/модуля — тихий фолбэк на «Заявки» с очисткой query
  useEffect(() => {
    if (!worksAvailable && searchParams.get("view")) {
      setSearchParams({}, { replace: true });
    }
  }, [worksAvailable, searchParams, setSearchParams]);

  const switchView = (value) => {
    setSearchParams(value === "works" ? { view: "works" } : {}, {
      replace: true,
    });
    // Смена query не меняет pathname — скролл-ресеты Root не срабатывают
    window.scrollTo(0, 0);
    document.querySelector(".mobile-shell__scroll")?.scrollTo(0, 0);
  };

  // Сегмент из одного пункта не показываем (правило гайда «скрывается, если
  // не сужает») — без права на работы страница выглядит как чистый архив заявок
  const segment = worksAvailable ? (
    <Segmented
      ariaLabel="Раздел архива"
      options={[
        { value: "tickets", label: "Заявки" },
        { value: "works", label: "Работы" },
      ]}
      value={view}
      onChange={switchView}
    />
  ) : null;

  return view === "works" ? (
    <WorksArchiveList segment={segment} />
  ) : (
    <TicketsArchiveList segment={segment} />
  );
};

export default Archive;

export async function loader() {
  document.title = "Архив";

  const { token } = getLocalStorageData();

  // Архив — исключение: отключённые компании и их заявители нужны в фильтрах,
  // чтобы искать по истории (обычные формы получают только активные).
  // Один form-data обслуживает фасеты обоих сегментов (responsibles каталога —
  // это и исполнители работ).
  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/form-data?includeInactive=true`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}
