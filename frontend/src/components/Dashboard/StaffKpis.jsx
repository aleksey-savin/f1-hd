import { useContext, useEffect, useMemo, useState } from "react";

import StatTile, { StatTileDelta } from "@/components/app/StatTile";
import { AuthedUserContext } from "../../store/authed-user-context";
import useInitialPrefsStore from "../../store/prefs";
import useDashboardTicketsStore from "../../store/dashboard-tickets";
import { getLocalStorageData } from "../../util/auth";
import { monthRange } from "../../util/period";

/**
 * Ряд KPI сотрудника: сколько на мне, сколько ничейных, сколько переработал.
 *
 * Переработка — из того же сервиса, что и финансовые отчёты
 * (`personal-report-summary`), запрошенного в облегчённом режиме `details=0`:
 * список работ и 12-месячный тренд плитке не нужны, а вот дельта к прошлому
 * месяцу нужна — без неё под числом нечего писать.
 */

const asHours = (minutes) => {
  if (!minutes) return "0:00";
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;
};

const StaffKpis = () => {
  const { _id: userId, isAdmin, permissions } = useContext(AuthedUserContext);
  const modules = useInitialPrefsStore((state) => state.modules);
  const tickets = useDashboardTicketsStore((state) => state.tickets);

  const canSeeOvertime =
    !!modules?.finances?.isActive &&
    (isAdmin ||
      !!permissions?.canSeePersonalFinancialReport ||
      !!permissions?.canSeeGlobalFinancialReport);
  const seesOthers =
    isAdmin ||
    !!permissions?.canAdministrateTickets ||
    !!permissions?.canSeeAllTickets;

  const [overtime, setOvertime] = useState(null);

  useEffect(() => {
    if (!canSeeOvertime) return;
    const load = async () => {
      const { token } = getLocalStorageData();
      const { from, to } = monthRange(new Date());
      const params = new URLSearchParams({ from, to, details: "0" });
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/finances/personal-report-summary?${params}`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (!response.ok) throw new Error(`overtime ${response.status}`);
        setOvertime(await response.json());
      } catch (error) {
        console.error("Не удалось загрузить переработку:", error);
      }
    };
    load();
  }, [canSeeOvertime]);

  const mineCount = useMemo(
    () =>
      tickets.filter((ticket) =>
        (ticket.responsibles ?? []).some(
          (user) => String(user?._id) === String(userId),
        ),
      ).length,
    [tickets, userId],
  );

  const unassigned = useMemo(
    () => tickets.filter((ticket) => !(ticket.responsibles ?? []).length),
    [tickets],
  );
  const machineCount = useMemo(
    () =>
      unassigned.filter(
        (ticket) =>
          ticket.isAuto ||
          ticket.source === "Мониторинг устройств" ||
          !ticket.applicant,
      ).length,
    [unassigned],
  );

  const current = overtime?.totals?.overtime?.roundedMinutes ?? null;
  const previous =
    overtime?.prevPeriod?.totals?.overtime?.roundedMinutes ?? null;
  const delta =
    current !== null && previous
      ? Math.round(((current - previous) / previous) * 100)
      : null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <StatTile label="На мне заявок" value={mineCount} />

      {seesOthers && (
        <StatTile
          label="Без ответственного"
          value={unassigned.length}
          footer={
            machineCount > 0
              ? `из них ${machineCount} от мониторинга`
              : "все заведены людьми"
          }
        />
      )}

      {canSeeOvertime && (
        <StatTile
          label="Переработка за месяц"
          value={current === null ? "—" : asHours(current)}
          busy={!overtime}
          delta={
            <StatTileDelta
              direction={
                delta === null || delta === 0
                  ? "flat"
                  : delta > 0
                    ? "up"
                    : "down"
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
      )}
    </div>
  );
};

export default StaffKpis;
