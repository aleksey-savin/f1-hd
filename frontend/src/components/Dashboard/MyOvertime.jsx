import { useEffect, useState } from "react";

import StatTile, { StatTileDelta } from "@/components/app/StatTile";
import useInitialPrefsStore from "../../store/prefs";
import { monthRange } from "../../util/period";
import { useCan } from "@/store/authed-user";

/**
 * Переработка за месяц — единственное число, оставшееся от ряда KPI сотрудника.
 *
 * «На мне заявок» и «Без ответственного» оттуда ушли: те же счётчики стоят в
 * подписях переключателя `StaffTickets`, а одно и то же число дважды на экране
 * — не сводка, а шум. Оставшаяся плитка ничего не дублирует и переехала наверх
 * правой колонки, к остальным справкам.
 *
 * Данные — из того же сервиса, что и финансовые отчёты
 * (`personal-report-summary`), запрошенного в облегчённом режиме `details=0`:
 * список работ и 12-месячный тренд плитке не нужны, а вот дельта к прошлому
 * месяцу нужна — без неё под числом нечего писать.
 */

const asHours = (minutes) => {
  if (!minutes) return "0:00";
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;
};

const MyOvertime = () => {
  const can = useCan();
  const modules = useInitialPrefsStore((state) => state.modules);

  // Плитка показывает СВОЮ переработку — это право `report.own`; право на
  // чужие отчёты его не заменяет (ручка со своим отчётом требует именно own).
  const canSeeOvertime =
    !!modules?.finances?.isActive && !!can({ report: ["own"] });

  const [overtime, setOvertime] = useState(null);

  useEffect(() => {
    if (!canSeeOvertime) return;
    const load = async () => {
      const { from, to } = monthRange(new Date());
      const params = new URLSearchParams({ from, to, details: "0" });
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/finances/personal-report-summary?${params}`,
        );
        if (!response.ok) throw new Error(`overtime ${response.status}`);
        setOvertime(await response.json());
      } catch (error) {
        console.error("Не удалось загрузить переработку:", error);
      }
    };
    load();
  }, [canSeeOvertime]);

  if (!canSeeOvertime) return null;

  const current = overtime?.totals?.overtime?.roundedMinutes ?? null;
  const previous =
    overtime?.prevPeriod?.totals?.overtime?.roundedMinutes ?? null;
  const delta =
    current !== null && previous
      ? Math.round(((current - previous) / previous) * 100)
      : null;

  return (
    <StatTile
      // mt-6 — вровень с метками секций соседних блоков: у них отступ несёт
      // Eyebrow, а у плитки метки нет.
      className="mt-6"
      label="Переработка за месяц"
      value={current === null ? "—" : asHours(current)}
      busy={!overtime}
      delta={
        <StatTileDelta
          direction={
            delta === null || delta === 0 ? "flat" : delta > 0 ? "up" : "down"
          }
          percentage={delta}
          hint="к прошлому месяцу"
        />
      }
      footer={
        overtime?.totals?.overtime?.daysWithOvertime
          ? `${overtime.totals.overtime.daysWithOvertime} дн с переработкой`
          : undefined
      }
    />
  );
};

export default MyOvertime;
