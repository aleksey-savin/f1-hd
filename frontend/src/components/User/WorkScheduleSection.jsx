import { useCallback, useContext, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  RiAddLine,
  RiCalendar2Line,
  RiGlobalLine,
  RiTimeLine,
} from "react-icons/ri";

import AlertMessage from "../app/AlertMessage";
import { Eyebrow, Panel, Section, SectionEditLink } from "../app/Panel";
import PropRow from "../app/PropRow";
import { SCHEDULE_DAYS } from "../app/ScheduleEditor";
import ScheduleView from "../app/ScheduleView";
import Spinner from "../app/Spinner";
import { Button } from "../ui/button";
import { AuthedUserContext } from "../../store/authed-user-context";
import useOffcanvasStore from "../../store/offcanvas";
import { getLocalStorageData } from "../../util/auth";
import { monthRange } from "../../util/period";
import { getAbsenceType } from "../../util/absence-types";
import { WORK_TIME_MODES } from "./permissions-catalog";

const API = import.meta.env.VITE_API_ADDRESS;

const DAY_KEYS = SCHEDULE_DAYS.map(([, key]) => key);

const humanDate = (key) => key.split("-").reverse().join(".");

// «5/2 · 09:00–18:00» — компактная подпись версии в истории
const weekSummary = (week) => {
  const working = DAY_KEYS.map((key) => week?.[key]).filter(
    (day) => day?.isWorking,
  );
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
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const monthLabel = (from) => {
  const [, month] = from.split("-").map(Number);
  return MONTH_NAMES[month - 1];
};

/**
 * Секция «График работы» карточки сотрудника — ТОЛЬКО ПОКАЗ.
 *
 * Правится там же, где остальные поля пользователя, — в общей форме
 * «Изменить» (docs/ux-ui-guide.md, «одно поле — одно место правки»). Карандаш в
 * метке секции открывает ту же форму сразу на секции «График работы»
 * (`update#schedule`); своего редактора и своего сохранения у секции нет. Пока
 * личного графика нет, вместо карандаша — кнопка «Задать график»: она называет,
 * что создаёт.
 *
 * Данные секция грузит сама (как app/TechSection), поэтому карточка о ней
 * ничего не знает; `version` — отметка изменения пользователя (updatedAt):
 * после сохранения формы роутер ревалидирует loader, отметка меняется, и
 * секция перечитывает график.
 */
const WorkScheduleSection = ({ id = "schedule", userId, version }) => {
  const authedUser = useContext(AuthedUserContext);
  const offcanvas = useOffcanvasStore();
  const canManage = Boolean(
    authedUser?.isAdmin || authedUser?.can({ workSchedule: ["manage"] }),
  );

  const [data, setData] = useState(null);
  const [absences, setAbsences] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

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
  }, [userId, period.from, period.to, version]);

  useEffect(() => {
    load();
  }, [load]);

  // «Не ведётся» — ни календаря, ни автостатусов: всё, что про расписание,
  // на карточке лишнее
  const isUntracked = data?.workTimeMode === "none";
  // В свободном режиме расписания нет и на карточке: показывать нечего
  const showSchedule = !isUntracked && data?.workTimeMode !== "free";

  const activeAbsences = absences.filter(
    (absence) => absence.status === "approved" || absence.status === "pending",
  );

  return (
    <Section>
      <Eyebrow
        id={id}
        action={
          /* Та же форма, что у кнопки «Изменить» в шапке карточки, — открытая
             сразу на своей секции. Пока личного графика нет, кнопка называет,
             что создаёт; когда он есть — карандаш: это второй вход в ту же
             форму, а не отдельная операция. */
          !canManage ? undefined : data?.hasPersonalSchedule ? (
            <SectionEditLink
              to="update#schedule"
              label="График работы"
              onClick={offcanvas.setShow}
            />
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link to="update#schedule" onClick={offcanvas.setShow}>
                <RiAddLine /> Задать график
              </Link>
            </Button>
          )
        }
      >
        График работы
      </Eyebrow>

      <Panel>
        {isLoading && !data ? (
          <Spinner />
        ) : error ? (
          <AlertMessage variant="danger" message={error} />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col">
              <PropRow
                icon={<RiTimeLine size={17} />}
                label="Учёт рабочего времени"
              >
                {WORK_TIME_MODES.find(
                  (mode) => mode.value === data.workTimeMode,
                )?.label ?? "По графику"}
                {data.remoteOnly && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    только удалённо
                  </span>
                )}
              </PropRow>
              {!isUntracked && (
                <>
                  <PropRow
                    icon={<RiGlobalLine size={17} />}
                    label="Часовой пояс"
                  >
                    {data.timezone}
                    {!data.hasPersonalSchedule && (
                      <span className="ml-2 text-xs font-normal text-faint">
                        как в организации
                      </span>
                    )}
                  </PropRow>
                  {showSchedule && (
                    <PropRow
                      icon={<RiCalendar2Line size={17} />}
                      label="Производственный календарь"
                    >
                      {data.followsProductionCalendar
                        ? "Следует календарю РФ"
                        : "Не учитывается"}
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
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          и {data.absenceDays} дн. отсутствия
                        </span>
                      )}
                    </PropRow>
                  )}
                </>
              )}
            </div>

            {isUntracked ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
                <p className="mx-auto mb-0 max-w-md text-sm text-muted-foreground">
                  Рабочее время не ведётся: в календаре команды сотрудника нет,
                  статус по графику не меняется.
                </p>
              </div>
            ) : !showSchedule ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
                <p className="mx-auto mb-0 max-w-md text-sm text-muted-foreground">
                  Свободный режим: расписания нет, статус сотрудник ставит сам —
                  любой, включая отпуск. В календаре команды он есть, плановых
                  дней у него не показывается.
                </p>
              </div>
            ) : data.hasPersonalSchedule ? (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">
                  Время — по часовому поясу сотрудника ({data.timezone})
                </p>
                <ScheduleView schedule={data.schedule} />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
                <p className="mx-auto mb-0 max-w-md text-sm text-muted-foreground">
                  Личный график не задан — в календаре он показан по резервному
                  графику организации, а переработки в отчётах считаются по окну
                  обслуживания клиента.
                  {!canManage && " Обратитесь к администратору."}
                </p>
              </div>
            )}

            {showSchedule && (data.versions?.length ?? 0) > 1 && (
              <div className="border-t border-border-soft pt-3.5">
                <div className="mb-2 text-xs font-bold tracking-wider text-faint uppercase">
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
                      className="flex items-center gap-3 border-t border-border-soft py-2 text-sm first:border-t-0"
                    >
                      <span className="w-28 flex-none text-muted-foreground tabular-nums">
                        {version.effectiveFrom
                          ? `с ${humanDate(version.effectiveFrom)}`
                          : "с самого начала"}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {weekSummary(version.schedule)}
                      </span>
                      {index === 0 && (
                        <span className="flex-none text-xs text-accent-text">
                          действует
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            )}

            {!isUntracked && activeAbsences.length > 0 && (
              <div className="border-t border-border-soft pt-3.5">
                <div className="mb-2 text-xs font-bold tracking-wider text-faint uppercase">
                  Отсутствия
                </div>
                {activeAbsences.map((absence) => {
                  const meta = getAbsenceType(absence.type);
                  return (
                    <div
                      key={absence._id}
                      className="flex items-center gap-3 border-t border-border-soft py-2 text-sm first:border-t-0"
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
                      <span>
                        <span className="font-medium">{absence.typeLabel}</span>
                        <span className="text-muted-foreground">
                          {" · "}
                          {humanDate(absence.from)}
                          {absence.from !== absence.to &&
                            ` — ${humanDate(absence.to)}`}
                        </span>
                      </span>
                      {absence.status === "pending" && (
                        <span className="ml-auto text-xs text-warning">
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
    </Section>
  );
};

export default WorkScheduleSection;
