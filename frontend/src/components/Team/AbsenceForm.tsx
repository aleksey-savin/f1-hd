import { useEffect, useMemo, useState } from "react";
import { RiSaveLine } from "react-icons/ri";

import AlertMessage from "../app/AlertMessage";
import Field from "../app/Field";
import FormSheet from "../app/FormSheet";
import { FormActions } from "../app/FormLayout";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import Combobox from "../app/Combobox";
import DateRangeField from "../app/DateRangeField";
import DateField from "../app/DateField";
import Segmented from "../app/Segmented";
import TimeInput from "../app/TimeInput";
import { ABSENCE_TYPES } from "../../util/absence-types";
import { businessDayKey, formatDayKey } from "../../util/format-date";
import {
  absenceDurationMinutes,
  absencePeriodError,
  formatAbsenceDuration,
  formatAbsencePeriod,
  formatAbsenceScheduleWindow,
} from "../../util/absence-period";
import type { TeamMember } from "@/types/teamSchedule";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  /** Кого можно выбрать; пусто — форма про себя. */
  employees?: TeamMember[];
  canManage?: boolean;
  defaultUserId?: string | null;
};

const API = import.meta.env.VITE_API_ADDRESS;

type Impact = {
  workingDays: number;
  durationMinutes?: number;
  reducesNorm?: boolean;
  scheduleWindow?: {
    date: string;
    start: number;
    end: number;
    crossesMidnight: boolean;
  } | null;
};

const plural = (count: number, one: string, few: string, many: string) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

/**
 * Заведение отсутствия. Одна форма на два случая, разница только в правах:
 *  • с правом «Графики и отсутствия» — виден выбор сотрудника, запись
 *    сохраняется сразу подтверждённой;
 *  • без права — сотрудник ставит его себе, и запись уходит на согласование.
 * Разделение делает бэкенд, форма лишь честно называет исход в сводке.
 */
const AbsenceForm = ({
  open,
  onOpenChange,
  onSaved,
  /** Кого можно выбрать; пусто — форма про себя. */
  employees = [],
  canManage = false,
  defaultUserId = null,
}: Props) => {
  const [userId, setUserId] = useState<string | null>(defaultUserId);
  const [type, setType] = useState("vacation");
  const [from, setFrom] = useState(() => businessDayKey());
  const [to, setTo] = useState(() => businessDayKey());
  const [mode, setMode] = useState("days");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("11:00");
  const [comment, setComment] = useState("");
  const [impact, setImpact] = useState<Impact | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showEmployeePicker = canManage && employees.length > 0;
  const targetId = showEmployeePicker ? userId : defaultUserId;

  useEffect(() => {
    if (open) {
      setUserId(defaultUserId);
      setType("vacation");
      setMode("days");
      setStart("09:00");
      setEnd("11:00");
      setComment("");
      setError(null);
      setImpact(null);
    }
  }, [open, defaultUserId]);

  const typeOptions = useMemo(
    () =>
      ABSENCE_TYPES.map((item) => ({
        value: item.code,
        label: `${item.emoji} ${item.label}`,
        hint: item.reducesNorm
          ? mode === "hours"
            ? "человека не будет в указанные часы"
            : "человека не будет в календаре"
          : "человек продолжает работать",
      })),
    [mode],
  );

  const employeeOptions = useMemo(
    () =>
      employees.map((item) => ({
        value: item.user._id,
        label:
          `${item.user.lastName ?? ""} ${item.user.firstName ?? ""}`.trim(),
        hint: item.user.position ?? undefined,
      })),
    [employees],
  );

  const selectedType = ABSENCE_TYPES.find((item) => item.code === type);

  const partial = mode === "hours";
  const timeRange = useMemo(
    () => (partial ? { start, end } : null),
    [partial, start, end],
  );
  const period = useMemo(
    () => ({ from, to: partial ? from : to, timeRange }),
    [from, to, partial, timeRange],
  );
  const periodError = absencePeriodError(period);
  const duration = absenceDurationMinutes(timeRange);

  // Отмена и флаг защищают сводку от ответов для предыдущего сотрудника/периода.
  useEffect(() => {
    setImpact(null);
    if (!open || !targetId || periodError) return undefined;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(async () => {
      const query = new URLSearchParams({
        user: targetId,
        from: period.from,
        to: period.to,
      });
      if (timeRange) query.set("timeRange", JSON.stringify(timeRange));
      try {
        const response = await fetch(
          `${API}/api/team/absences/impact?${query}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(String(response.status));
        const payload: Impact = await response.json();
        if (active) setImpact(payload);
      } catch {
        if (active) setImpact(null);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, targetId, period, periodError, timeRange]);

  const submit = async () => {
    if (periodError) {
      setError(periodError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`${API}/api/team/absences`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(showEmployeePicker && userId ? { user: userId } : {}),
          type,
          ...period,
          comment,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || "Сервер отклонил отсутствие");
      }
      onOpenChange(false);
      onSaved?.();
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const days = impact?.workingDays ?? null;

  return (
    // Своего скролл-контейнера у формы нет намеренно: он обрезал бы инлайн-меню
    // Combobox — прокрутку даёт сама
    // FormSheet, и меню свободно раскрывается вниз
    <FormSheet open={open} onOpenChange={onOpenChange} title="Новое отсутствие">
      <h1 className="my-0 mb-5 pr-10 text-2xl font-semibold tracking-tight">
        {canManage ? "Новое отсутствие" : "Запросить отсутствие"}
      </h1>

      {error && <AlertMessage variant="danger" message={error} />}

      {showEmployeePicker && (
        <Field label="Сотрудник" htmlFor="abs-user" required>
          <Combobox
            id="abs-user"
            options={employeeOptions}
            value={userId}
            onChange={setUserId}
            placeholder="Выберите сотрудника"
            searchPlaceholder="Фамилия или имя…"
          />
        </Field>
      )}

      <Field label="Тип" htmlFor="abs-type" required>
        <Combobox
          id="abs-type"
          options={typeOptions}
          value={type}
          onChange={(next) => setType(next ?? "vacation")}
        />
      </Field>

      <Field label="Продолжительность">
        <Segmented
          ariaLabel="Продолжительность отсутствия"
          options={[
            { value: "days", label: "Целые дни" },
            { value: "hours", label: "Часть дня" },
          ]}
          value={mode}
          onChange={(value) => {
            setMode(value);
            if (value === "hours") setTo(from);
          }}
        />
      </Field>

      {partial ? (
        <>
          <Field label="Дата" htmlFor="abs-date" required>
            <DateField
              id="abs-date"
              value={from}
              onChange={(value) => {
                setFrom(value);
                setTo(value);
              }}
              clearable={false}
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Не буду с" htmlFor="abs-start" required>
              <TimeInput
                id="abs-start"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                required
              />
            </Field>
            <Field label="До" htmlFor="abs-end" required>
              <TimeInput
                id="abs-end"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                required
              />
            </Field>
          </div>
          {periodError && (
            <p role="alert" className="-mt-2 mb-4 text-sm text-destructive">
              {periodError}
            </p>
          )}
          <p className="-mt-2 mb-4 text-sm text-muted-foreground">
            {impact?.scheduleWindow &&
              `График на этот день: ${formatAbsenceScheduleWindow(impact.scheduleWindow)}. `}
            Время организации.
            {duration !== null &&
              end < start &&
              " Отсутствие закончится на следующий день."}
          </p>
        </>
      ) : (
        <Field label="Период" htmlFor="abs-period" required>
          <DateRangeField
            id="abs-period"
            value={{ from, to }}
            onChange={(range) => {
              setFrom(range.from);
              setTo(range.to);
            }}
            required
          />
        </Field>
      )}

      <Field
        label="Комментарий"
        htmlFor="abs-comment"
        hint="Виден согласующему и в карточке сотрудника"
      >
        <Textarea
          id="abs-comment"
          value={comment}
          maxLength={300}
          onChange={(event) => setComment(event.target.value)}
        />
      </Field>

      {partial && duration !== null && !periodError ? (
        <AlertMessage
          variant={canManage ? "info" : "warning"}
          message={
            <div className="space-y-1.5">
              <p className="font-semibold">
                {formatAbsencePeriod(period, formatDayKey)} ·{" "}
                {formatAbsenceDuration(duration)}
              </p>
              <p>
                {selectedType?.reducesNorm
                  ? "В остальное время рабочий день сохранится по графику."
                  : "Человек продолжает работать, в календаре останется доступным."}
              </p>
              <p>Норма часов и расчёт переработок не изменятся.</p>
              <p>
                {canManage
                  ? "Отсутствие появится в календаре."
                  : "Запрос уйдёт на согласование. До решения график не изменится."}
              </p>
            </div>
          }
        />
      ) : (
        !partial &&
        days !== null && (
          <AlertMessage
            variant={canManage ? "info" : "warning"}
            message={
              <>
                <b>
                  {days}{" "}
                  {plural(days, "рабочий день", "рабочих дня", "рабочих дней")}
                </b>
                {selectedType?.reducesNorm ? (
                  <> · в эти дни человека не будет в календаре</>
                ) : (
                  <>
                    {" "}
                    · человек продолжает работать, в календаре останется
                    доступным
                  </>
                )}
                {!canManage &&
                  " · запрос уйдёт на согласование, до решения календарь не меняется"}
              </>
            }
          />
        )
      )}
      <FormActions className="justify-end">
        <Button
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={saving}
        >
          Отмена
        </Button>
        <Button
          onClick={submit}
          disabled={
            saving || Boolean(periodError) || (showEmployeePicker && !userId)
          }
        >
          <RiSaveLine />
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
      </FormActions>
    </FormSheet>
  );
};

export default AbsenceForm;
