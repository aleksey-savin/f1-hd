import { useCallback, useEffect, useState } from "react";
import { RiAddFill } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import Combobox from "@/components/app/Combobox";
import ScheduleView from "@/components/app/ScheduleView";
import SettingRow from "@/components/app/SettingRow";
import Spinner from "@/components/app/Spinner";
import AbsenceForm from "@/components/Team/AbsenceForm";
import { Button } from "@/components/ui/button";
import type { UserScheduleResponse } from "@/types/teamSchedule";
import { getAbsenceType } from "@/util/absence-types";
import { getLocalStorageData } from "@/util/auth";
import { monthRange } from "@/util/period";
import timezones from "@/store/timezones";

const API = import.meta.env.VITE_API_ADDRESS;

type Absence = {
  _id: string;
  type: string;
  typeLabel: string;
  from: string;
  to: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  comment: string;
  decisionComment: string;
  decidedBy: { firstName: string; lastName: string } | null;
};

const humanDate = (key: string) => key.split("-").reverse().join(".");

const range = (from: string, to: string) =>
  from === to ? humanDate(from) : `${humanDate(from)} — ${humanDate(to)}`;

const STATUS_TONE: Record<Absence["status"], string> = {
  pending: "text-warning",
  approved: "text-accent-text",
  rejected: "text-muted-foreground",
  cancelled: "text-faint",
};

const STATUS_LABEL: Record<Absence["status"], string> = {
  pending: "на согласовании",
  approved: "подтверждено",
  rejected: "отклонено",
  cancelled: "отозвано",
};

/**
 * «Мой аккаунт» → График и отсутствия.
 *
 * Свой график сотрудник только смотрит (правит его тот, у кого есть право
 * «Графики и отсутствия»), а вот отпуск, отгул и больничный запрашивает сам —
 * запись уходит на согласование, и до решения календарь не меняется.
 */
const MySchedule = ({ user }: { user: { _id: string } }) => {
  const [data, setData] = useState<UserScheduleResponse | null>(null);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingTz, setSavingTz] = useState(false);

  const period = monthRange(new Date());

  const load = useCallback(async () => {
    const { token } = getLocalStorageData();
    setIsLoading(true);
    try {
      const [scheduleResponse, absenceResponse] = await Promise.all([
        fetch(
          `${API}/api/team/schedule/${user._id}?from=${period.from}&to=${period.to}`,
          { headers: { Authorization: "Bearer " + token } },
        ),
        fetch(`${API}/api/team/absences?user=${user._id}`, {
          headers: { Authorization: "Bearer " + token },
        }),
      ]);
      if (!scheduleResponse.ok)
        throw new Error(String(scheduleResponse.status));
      setData(await scheduleResponse.json());
      if (absenceResponse.ok) {
        const payload = await absenceResponse.json();
        setAbsences(payload.absences ?? []);
      }
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

  const tzOptions = timezones.map((zone: { value: string; label: string }) => ({
    value: zone.value,
    label: zone.label,
  }));

  const saveTimezone = async (next: string | null) => {
    const { token, userId } = getLocalStorageData();
    setSavingTz(true);
    try {
      const response = await fetch(`${API}/api/users/update-account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ id: userId, timezone: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch (tzError) {
      console.warn("Часовой пояс не сохранился:", tzError);
    } finally {
      setSavingTz(false);
    }
  };

  const cancel = async (id: string) => {
    const { token } = getLocalStorageData();
    setBusyId(id);
    try {
      const response = await fetch(`${API}/api/team/absences/${id}/cancel`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch (cancelError) {
      console.warn("Запрос не отозвался:", cancelError);
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading && !data) {
    return <Spinner />;
  }
  if (error) {
    return <AlertMessage variant="danger" message={error} />;
  }
  if (!data) {
    return null;
  }

  const visible = absences.filter((absence) => absence.status !== "cancelled");

  return (
    <>
      {/* Пояс правит сам сотрудник: он про него знает лучше, а от пояса
          зависят и его сутки в календаре, и границы смены */}
      <SettingRow
        title="Часовой пояс"
        hint="По нему считается ваш рабочий день"
        htmlFor="my-tz"
      >
        <div className="w-64">
          <Combobox
            id="my-tz"
            options={tzOptions}
            value={data.timezone}
            onChange={saveTimezone}
            disabled={savingTz}
            placeholder="Как в организации"
            searchPlaceholder="Город или зона…"
          />
        </div>
      </SettingRow>

      <SettingRow
        title="График"
        hint={
          data.hasPersonalSchedule
            ? data.followsProductionCalendar
              ? "Следует производственному календарю РФ"
              : "Производственный календарь не учитывается"
            : "Личный график не задан — обратитесь к администратору"
        }
        divider
      >
        <span />
      </SettingRow>

      {data.hasPersonalSchedule && (
        <div className="px-4 pb-4">
          <ScheduleView schedule={data.schedule} />
        </div>
      )}

      <div className="border-t border-border-soft px-4 py-3.5">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="text-xs font-bold tracking-wider text-faint uppercase">
            Мои отсутствия
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setFormOpen(true)}
          >
            <RiAddFill />
            Новая заявка
          </Button>
        </div>

        {visible.length === 0 ? (
          <p className="my-2 text-sm text-muted-foreground">
            Отпусков, отгулов и больничных пока не записано. Запрос уйдёт на
            согласование — до решения календарь не меняется.
          </p>
        ) : (
          visible.map((absence) => {
            const meta = getAbsenceType(absence.type);
            return (
              <div
                key={absence._id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-soft py-2.5 text-sm first:border-t-0"
              >
                <span
                  className="grid h-6 min-w-8 place-items-center rounded-md px-1.5 text-xs font-bold"
                  style={{
                    color: meta?.color,
                    background:
                      absence.status === "approved"
                        ? `color-mix(in srgb, ${meta?.color} 17%, transparent)`
                        : "transparent",
                    border:
                      absence.status === "approved"
                        ? undefined
                        : `1.5px dashed color-mix(in srgb, ${meta?.color} 60%, transparent)`,
                  }}
                >
                  {meta?.short}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">{absence.typeLabel}</span>
                  <span className="text-muted-foreground">
                    {" · "}
                    {range(absence.from, absence.to)}
                  </span>
                  {absence.status === "rejected" && absence.decisionComment && (
                    <span className="block text-xs text-muted-foreground">
                      Причина: {absence.decisionComment}
                    </span>
                  )}
                </span>
                <span
                  className={`ms-auto text-xs ${STATUS_TONE[absence.status]}`}
                >
                  {STATUS_LABEL[absence.status]}
                  {absence.decidedBy &&
                    absence.status !== "pending" &&
                    ` · ${absence.decidedBy.lastName} ${absence.decidedBy.firstName?.slice(0, 1)}.`}
                </span>
                {absence.status === "pending" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === absence._id}
                    onClick={() => cancel(absence._id)}
                  >
                    Отозвать
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>

      <AbsenceForm
        open={formOpen}
        onOpenChange={setFormOpen}
        canManage={false}
        employees={[]}
        defaultUserId={user._id}
        onSaved={() => load()}
      />
    </>
  );
};

export default MySchedule;
