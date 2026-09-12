import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

import AlertMessage from "@/components/app/AlertMessage";
import ScheduleView from "@/components/app/ScheduleView";
import SettingRow from "@/components/app/SettingRow";
import Spinner from "@/components/app/Spinner";
import { Button } from "@/components/ui/button";
import { useCan } from "@/store/authed-user";
import type { UserScheduleResponse } from "@/types/teamSchedule";
import { monthRange } from "@/util/period";
import { orgTimezone, tzCity } from "@/util/timezone-display";

const API = import.meta.env.VITE_API_ADDRESS;

/**
 * «Мой аккаунт» → График работы.
 *
 * Только показ: правит график тот, у кого есть право «Графики и отсутствия».
 * Отпуска, отгулы и больничные жили здесь же списком, но личные настройки — про
 * поведение приложения под себя, а не про архив заявок. Заявку заводят и
 * читают в «Календаре команды», где видно, кого не будет рядом в те же дни и
 * на кого ляжет работа.
 */
const MySchedule = ({ user }: { user: { _id: string } }) => {
  // Календарь команды за правом `schedule.read` — без него ряд вёл бы на «Нет
  // доступа». Свой график виден и без права, он выше на этой же странице;
  // отдельная точка входа в свои отсутствия — задача на оформление.
  const canReadSchedule = useCan()({ schedule: ["read"] });
  const [data, setData] = useState<UserScheduleResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const period = monthRange(new Date());

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `${API}/api/team/schedule/${user._id}?from=${period.from}&to=${period.to}`,
      );
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json());
      setError(null);
    } catch (loadError) {
      console.warn("Свой график не загрузился:", loadError);
      setError("Не удалось загрузить график работы.");
    } finally {
      setIsLoading(false);
    }
  }, [user._id, period.from, period.to]);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading && !data) {
    return <Spinner />;
  }
  if (error) {
    return <AlertMessage variant="danger" message={error} />;
  }
  if (!data) {
    return null;
  }

  return (
    <>
      <SettingRow
        title="График"
        hint={
          data.hasPersonalSchedule
            ? `Время указано по часовому поясу организации (${tzCity(orgTimezone())}). ${
                data.followsProductionCalendar
                  ? "Следует производственному календарю РФ."
                  : "Производственный календарь не учитывается."
              }`
            : "Личный график не задан — обратитесь к администратору"
        }
      >
        <span />
      </SettingRow>

      {data.hasPersonalSchedule && (
        <div className="px-4 pb-4">
          <ScheduleView schedule={data.schedule} />
        </div>
      )}

      {canReadSchedule && (
        <SettingRow
          divider
          title="Отпуска, отгулы и больничные"
          hint="Заявка заводится в календаре команды — там видно, кого не будет рядом в те же дни."
        >
          <Button asChild variant="outline" size="sm">
            <Link to="/team/calendar">Открыть календарь</Link>
          </Button>
        </SettingRow>
      )}
    </>
  );
};

export default MySchedule;
