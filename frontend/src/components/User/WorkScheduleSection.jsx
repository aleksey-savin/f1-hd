import { useCallback, useContext, useEffect, useState } from "react";
import {
  RiCalendar2Line,
  RiEdit2Line,
  RiGlobalLine,
  RiSaveLine,
  RiTimeLine,
} from "react-icons/ri";

import AlertMessage from "../app/AlertMessage";
import { Eyebrow, Panel } from "../app/Panel";
import PropRow from "../app/PropRow";
import ScheduleEditor, { emptyDay, SCHEDULE_DAYS } from "../app/ScheduleEditor";
import Field from "../app/Field";
import Segmented from "../app/Segmented";
import SwitchField from "../app/SwitchField";
import ScheduleView from "../app/ScheduleView";
import Spinner from "../app/Spinner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import Combobox from "../app/Combobox";
import { AuthedUserContext } from "../../store/authed-user-context";
import timezones from "../../store/timezones";
import { getLocalStorageData } from "../../util/auth";
import { monthRange } from "../../util/period";
import { getAbsenceType } from "../../util/absence-types";
import { WORK_TIME_MODES } from "./permissions-catalog";

const MODE_HINT = {
  scheduled: "Статус меняется автоматически по графику, отсутствия — по заявке",
  free: "В календаре есть, но статусы ставит сам — любые, включая отпуск",
  none: "В календаре команды не показывается",
};

const API = import.meta.env.VITE_API_ADDRESS;

const DAY_KEYS = SCHEDULE_DAYS.map(([, key]) => key);

const workDay = () => ({ ...emptyDay(), isWorking: true, breakMinutes: 60 });

// Заготовка личного графика: 5/2 09:00–18:00 с часовым перерывом — та же, что
// DEFAULT_OVERTIME_SCHEDULE на бэкенде
const defaultWeek = () =>
  Object.fromEntries(
    DAY_KEYS.map((key, index) => [
      key,
      index < 5 ? workDay() : { ...emptyDay(), breakMinutes: 0 },
    ]),
  );

const humanDate = (key) => key.split("-").reverse().join(".");

// «5/2 · 09:00–18:00» — компактная подпись версии в истории
const weekSummary = (week) => {
  const working = DAY_KEYS.map((key) => week?.[key]).filter((day) => day?.isWorking);
  if (!working.length) return "нерабочая неделя";
  const first = working[0];
  const same = working.every(
    (day) => day.start === first.start && day.end === first.end,
  );
  const time = first.is24hours
    ? "круглосуточно"
    : same
      ? `${first.start}–${first.end}`
      : "плавающее время";
  return `${working.length}/${7 - working.length} · ${time}`;
};

const MONTH_NAMES = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const monthLabel = (from) => {
  const [, month, ] = from.split("-").map(Number);
  return MONTH_NAMES[month - 1];
};

/**
 * Секция «График работы» карточки сотрудника.
 *
 * Правится НА МЕСТЕ отдельным запросом (канон чек-листа шаблона заявки):
 * «Изменить» в метке секции, «Сохранить график» / «Отмена» внутри панели —
 * всю форму пользователя ради графика не открываем. Данные секция грузит сама
 * (как app/TechSection), поэтому карточка о ней ничего не знает.
 */
const WorkScheduleSection = ({ id = "schedule", userId }) => {
  const authedUser = useContext(AuthedUserContext);
  const canManage = Boolean(
    authedUser?.isAdmin || authedUser?.permissions?.canManageWorkSchedules,
  );

  const [data, setData] = useState(null);
  const [absences, setAbsences] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [draft, setDraft] = useState(null);

  const period = monthRange(new Date());

  const load = useCallback(async () => {
    const { token } = getLocalStorageData();
    setIsLoading(true);
    try {
      const [scheduleResponse, absenceResponse] = await Promise.all([
        fetch(
          `${API}/api/team/schedule/${userId}?from=${period.from}&to=${period.to}`,
          { headers: { Authorization: "Bearer " + token } },
        ),
        fetch(`${API}/api/team/absences?user=${userId}`, {
          headers: { Authorization: "Bearer " + token },
        }),
      ]);
      if (!scheduleResponse.ok) {
        throw new Error(`schedule ${scheduleResponse.status}`);
      }
      setData(await scheduleResponse.json());
      if (absenceResponse.ok) {
        const payload = await absenceResponse.json();
        setAbsences(payload.absences || []);
      }
      setError(null);
    } catch (loadError) {
      console.warn("График сотрудника не загрузился:", loadError);
      setError("Не удалось загрузить график работы.");
    } finally {
      setIsLoading(false);
    }
    // period пересоздаётся каждый рендер — в зависимостях его значения, не объект
  }, [userId, period.from, period.to]);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = () => {
    setSaveError(null);
    setDraft({
      timezone: data?.hasPersonalSchedule ? (data.timezone ?? "") : "",
      followProductionCalendar: data?.followsProductionCalendar ?? true,
      week: data?.hasPersonalSchedule ? structuredClone(data.schedule) : defaultWeek(),
      // По умолчанию — с сегодня: новая версия не трогает прошлое
      effectiveFrom: new Date().toISOString().slice(0, 10),
      workTimeMode: data?.workTimeMode ?? "scheduled",
      remoteOnly: Boolean(data?.remoteOnly),
    });
    setEditing(true);
  };

  const save = async () => {
    const { token } = getLocalStorageData();
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`${API}/api/users/${userId}/work-schedule`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        // При «не ведётся» шлём только режим: график не редактировался, и
        // новую версию плодить незачем — прежняя ждёт возврата учёта
        body: JSON.stringify(
          draft.workTimeMode === "none"
            ? { workTimeMode: "none" }
            : {
                timezone: draft.timezone || null,
                followProductionCalendar: draft.followProductionCalendar,
                schedule: draft.week,
                effectiveFrom: draft.effectiveFrom || null,
                workTimeMode: draft.workTimeMode,
                remoteOnly: draft.remoteOnly,
              },
        ),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Сервер отклонил график");
      }
      setEditing(false);
      await load();
    } catch (submitError) {
      setSaveError(submitError.message);
    } finally {
      setSaving(false);
    }
  };

  const setBreak = (value) => {
    const minutes = Math.max(0, Math.min(480, Number(value) || 0));
    setDraft((current) => ({
      ...current,
      week: Object.fromEntries(
        Object.entries(current.week).map(([key, day]) => [
          key,
          day.isWorking ? { ...day, breakMinutes: minutes } : day,
        ]),
      ),
    }));
  };

  // Сколько месяцев заденет правка задним числом — предупреждаем поимённо,
  // иначе согласованные суммы поедут молча
  const backdated = (() => {
    const from = draft?.effectiveFrom;
    if (!from) return null;
    const start = new Date(`${from}T00:00:00Z`);
    const now = new Date();
    if (start >= new Date(now.toISOString().slice(0, 10))) return null;
    const months = [];
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    while (cursor <= last && months.length < 12) {
      months.push(`${MONTH_NAMES[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return months.join(", ");
  })();

  const currentBreak =
    Object.values(draft?.week ?? {}).find((day) => day.isWorking)?.breakMinutes ?? 60;

  const tzOptions = timezones.map((zone) => ({
    value: zone.value,
    label: zone.label,
  }));

  // Свободный режим: нормы и автостатусов нет, значит расписание, перерыв и
  // производственный календарь ни на что не влияют — в форме их быть не должно
  const isFreeMode = draft?.workTimeMode === "free";

  // Пояс, в котором читается график: личный, а если не выбран — организации
  const tzHint = (() => {
    const own = draft?.timezone || null;
    const effective = own || data?.organizationTimezone || data?.timezone;
    if (!effective) return "часовой пояс организации";
    const label = tzOptions.find((zone) => zone.value === effective)?.label ?? effective;
    return own ? label : `${label}, как в организации`;
  })();

  // «Не ведётся» — ни календаря, ни автостатусов: всё, что про расписание,
  // на карточке лишнее
  const isUntracked = data?.workTimeMode === "none";
  // В свободном режиме расписания нет и на карточке: показывать нечего
  const showSchedule = !isUntracked && data?.workTimeMode !== "free";

  const activeAbsences = absences.filter(
    (absence) => absence.status === "approved" || absence.status === "pending",
  );

  return (
    <>
      <Eyebrow
        id={id}
        action={
          canManage && !editing ? (
            <Button variant="outline" size="sm" onClick={startEdit}>
              <RiEdit2Line />
              {data?.hasPersonalSchedule ? "Изменить" : "Задать график"}
            </Button>
          ) : undefined
        }
      >
        График работы
      </Eyebrow>

      <Panel>
        {isLoading && !data ? (
          <Spinner />
        ) : error ? (
          <AlertMessage variant="danger" message={error} />
        ) : editing ? (
          <div className="tw:space-y-4">
            {saveError && <AlertMessage variant="danger" message={saveError} />}

            {/* Учёт времени живёт здесь, а не в форме пользователя: одна тема
                не должна правиться в двух местах */}
            <Field
              label="Учёт рабочего времени"
              hint={MODE_HINT[draft.workTimeMode]}
            >
              <Segmented
                ariaLabel="Учёт рабочего времени"
                options={WORK_TIME_MODES}
                value={draft.workTimeMode}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, workTimeMode: value }))
                }
              />
            </Field>

            {/* «Не ведётся» — человека нет ни в календаре, ни в автоматике:
                расписание и всё, что от него зависит, показывать незачем */}
            {draft.workTimeMode === "none" ? (
              <div className="tw:rounded-lg tw:border tw:border-dashed tw:border-border tw:px-4 tw:py-6 tw:text-center">
                <p className="tw:mx-auto tw:mb-0 tw:max-w-md tw:text-sm tw:text-muted-foreground">
                  Рабочее время не ведётся: сотрудник не показывается в
                  календаре команды, статус по графику не меняется, заявки на
                  отсутствие ему не нужны. Прежний график сохранится — если
                  вернуть учёт, он снова заработает.
                </p>
              </div>
            ) : (
              <>
            <SwitchField
              id="ws-remote-only"
              checked={draft.remoteOnly}
              onCheckedChange={(value) =>
                setDraft((current) => ({ ...current, remoteOnly: value === true }))
              }
              label="Работает только удалённо"
              hint="Статуса «в офисе» у него не будет — автоматика поставит «на удалёнке»"
            />

            <div
              className={
                isFreeMode
                  ? "tw:max-w-sm"
                  : "tw:grid tw:gap-3 tw:md:grid-cols-2"
              }
            >
              <div>
                <Label htmlFor="ws-tz">Часовой пояс</Label>
                <Combobox
                  id="ws-tz"
                  options={tzOptions}
                  value={draft.timezone || null}
                  onChange={(next) =>
                    setDraft((current) => ({ ...current, timezone: next ?? "" }))
                  }
                  placeholder="Как в организации"
                  searchPlaceholder="Город или зона…"
                  clearable
                  clearLabel="Как в организации"
                />
                <p className="tw:mt-1 tw:mb-0 tw:text-xs tw:text-muted-foreground">
                  {isFreeMode
                    ? "По нему показывается его местное время в календаре"
                    : "По нему считается его рабочий день — и в календаре, и в отчётах"}
                </p>
              </div>
              {!isFreeMode && (
              <div>
                <Label htmlFor="ws-break">Перерыв, мин</Label>
                <Input
                  id="ws-break"
                  inputMode="numeric"
                  value={currentBreak}
                  onChange={(event) => setBreak(event.target.value)}
                  className="tw:tabular-nums"
                />
                <p className="tw:mt-1 tw:mb-0 tw:text-xs tw:text-muted-foreground">
                  Не входит в рабочее время; на часы влияет только в отчётах
                </p>
              </div>
              )}
            </div>

            {!isFreeMode && (
            <label className="tw:flex tw:cursor-pointer tw:items-start tw:gap-3">
              <Switch
                checked={draft.followProductionCalendar}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({
                    ...current,
                    followProductionCalendar: checked === true,
                  }))
                }
              />
              <span>
                <span className="tw:block tw:text-sm tw:font-medium">
                  Следовать производственному календарю РФ
                </span>
                <span className="tw:block tw:text-xs tw:text-muted-foreground">
                  Праздники и перенесённые выходные становятся нерабочими,
                  предпраздничные — короче на час
                </span>
              </span>
            </label>
            )}

            <div className="tw:max-w-xs">
              <Label htmlFor="ws-from">Действует с</Label>
              <Input
                id="ws-from"
                type="date"
                value={draft.effectiveFrom}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    effectiveFrom: event.target.value,
                  }))
                }
              />
              <p className="tw:mt-1 tw:mb-0 tw:text-xs tw:text-muted-foreground">
                {isFreeMode
                  ? "С этой даты действует свободный режим; прежний график сохранится в истории"
                  : "Прежний график сохранится в истории и продолжит действовать до этой даты"}
              </p>
            </div>

            {/* Из самих полей «09:00–18:00» не видно, чьё это время: пояс
                у сотрудника свой, и по нему же считается его день */}
            {!isFreeMode && (
            <div>
              <p className="tw:mb-2 tw:text-xs tw:text-muted-foreground">
                Время указывается по часовому поясу сотрудника —{" "}
                <span className="tw:font-medium tw:text-body">{tzHint}</span>. В
                календаре и отчётах у каждого свой день, поясá не приводятся к
                общему.
              </p>
              <ScheduleEditor
                schedule={draft.week}
                onChange={(week) => setDraft((current) => ({ ...current, week }))}
              />
            </div>
            )}

            {!isFreeMode && backdated && (
              <AlertMessage
                variant="warning"
                message={`Дата в прошлом: отчёты за ${backdated} пересчитаются по новому графику. Если месяц уже согласован, суммы в нём изменятся.`}
              />
            )}
              </>
            )}

            <div className="tw:flex tw:justify-end tw:gap-2.5 tw:border-t tw:border-border-soft tw:pt-3.5">
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Отмена
              </Button>
              <Button onClick={save} disabled={saving}>
                <RiSaveLine />
                {saving ? "Сохранение…" : "Сохранить график"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="tw:space-y-4">
            <div className="tw:flex tw:flex-col">
              <PropRow icon={<RiTimeLine size={17} />} label="Учёт рабочего времени">
                {WORK_TIME_MODES.find((mode) => mode.value === data.workTimeMode)
                  ?.label ?? "По графику"}
                {data.remoteOnly && (
                  <span className="tw:ml-2 tw:text-xs tw:font-normal tw:text-muted-foreground">
                    только удалённо
                  </span>
                )}
              </PropRow>
              {!isUntracked && (
                <>
                  <PropRow icon={<RiGlobalLine size={17} />} label="Часовой пояс">
                    {data.timezone}
                    {!data.hasPersonalSchedule && (
                      <span className="tw:ml-2 tw:text-xs tw:font-normal tw:text-faint">
                        как в организации
                      </span>
                    )}
                  </PropRow>
                  {showSchedule && (
                    <PropRow icon={<RiCalendar2Line size={17} />} label="Производственный календарь">
                      {data.followsProductionCalendar ? "Следует календарю РФ" : "Не учитывается"}
                    </PropRow>
                  )}
                  {/* Часы — забота отчёта «Сотрудники»; здесь календарь, а он
                      измеряет дни */}
                  {showSchedule && (
                  <PropRow
                    icon={<RiTimeLine size={17} />}
                    label={`Рабочих дней в ${monthLabel(period.from)}`}
                  >
                    {data.workingDays}
                    {data.absenceDays > 0 && (
                      <span className="tw:ml-2 tw:text-xs tw:font-normal tw:text-muted-foreground">
                        и {data.absenceDays} дн. отсутствия
                      </span>
                    )}
                  </PropRow>
                  )}
                </>
              )}
            </div>

            {isUntracked ? (
              <div className="tw:rounded-lg tw:border tw:border-dashed tw:border-border tw:px-4 tw:py-6 tw:text-center">
                <p className="tw:mx-auto tw:mb-0 tw:max-w-md tw:text-sm tw:text-muted-foreground">
                  Рабочее время не ведётся: в календаре команды сотрудника нет,
                  статус по графику не меняется.
                </p>
              </div>
            ) : !showSchedule ? (
              <div className="tw:rounded-lg tw:border tw:border-dashed tw:border-border tw:px-4 tw:py-6 tw:text-center">
                <p className="tw:mx-auto tw:mb-0 tw:max-w-md tw:text-sm tw:text-muted-foreground">
                  Свободный режим: расписания нет, статус сотрудник ставит сам —
                  любой, включая отпуск. В календаре команды он есть, плановых
                  дней у него не показывается.
                </p>
              </div>
            ) : data.hasPersonalSchedule ? (
              <div>
                <p className="tw:mb-2 tw:text-xs tw:text-muted-foreground">
                  Время — по часовому поясу сотрудника ({data.timezone})
                </p>
                <ScheduleView schedule={data.schedule} />
              </div>
            ) : (
              <div className="tw:rounded-lg tw:border tw:border-dashed tw:border-border tw:px-4 tw:py-6 tw:text-center">
                <p className="tw:mx-auto tw:mb-0 tw:max-w-md tw:text-sm tw:text-muted-foreground">
                  Личный график не задан — в календаре он показан по
                  резервному графику организации, а переработки в отчётах
                  считаются по окну обслуживания клиента.
                  {!canManage && " Обратитесь к администратору."}
                </p>
              </div>
            )}

            {showSchedule && (data.versions?.length ?? 0) > 1 && (
              <div className="tw:border-t tw:border-border-soft tw:pt-3.5">
                <div className="tw:mb-2 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
                  История графика
                </div>
                {[...data.versions]
                  .sort((a, b) =>
                    String(b.effectiveFrom ?? "").localeCompare(
                      String(a.effectiveFrom ?? ""),
                    ),
                  )
                  .map((version, index) => (
                    <div
                      key={version.effectiveFrom ?? "always"}
                      className="tw:flex tw:items-center tw:gap-3 tw:border-t tw:border-border-soft tw:py-2 tw:text-sm tw:first:border-t-0"
                    >
                      <span className="tw:w-28 tw:flex-none tw:text-muted-foreground tw:tabular-nums">
                        {version.effectiveFrom
                          ? `с ${humanDate(version.effectiveFrom)}`
                          : "с самого начала"}
                      </span>
                      <span className="tw:min-w-0 tw:flex-1 tw:truncate">
                        {weekSummary(version.schedule)}
                      </span>
                      {index === 0 && (
                        <span className="tw:flex-none tw:text-xs tw:text-accent-text">
                          действует
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            )}

            {!isUntracked && activeAbsences.length > 0 && (
              <div className="tw:border-t tw:border-border-soft tw:pt-3.5">
                <div className="tw:mb-2 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
                  Отсутствия
                </div>
                {activeAbsences.map((absence) => {
                  const meta = getAbsenceType(absence.type);
                  return (
                    <div
                      key={absence._id}
                      className="tw:flex tw:items-center tw:gap-3 tw:border-t tw:border-border-soft tw:py-2 tw:text-sm tw:first:border-t-0"
                    >
                      <span
                        className="tw:grid tw:h-6 tw:min-w-8 tw:place-items-center tw:rounded-md tw:px-1.5 tw:text-xs tw:font-bold"
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
                      <span>
                        <span className="tw:font-medium">{absence.typeLabel}</span>
                        <span className="tw:text-muted-foreground">
                          {" · "}
                          {humanDate(absence.from)}
                          {absence.from !== absence.to && ` — ${humanDate(absence.to)}`}
                        </span>
                      </span>
                      {absence.status === "pending" && (
                        <span className="tw:ml-auto tw:text-xs tw:text-warning">
                          на согласовании
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Panel>
    </>
  );
};

export default WorkScheduleSection;
