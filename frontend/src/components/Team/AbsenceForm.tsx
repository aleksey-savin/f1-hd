import { useCallback, useEffect, useMemo, useState } from "react";
import { RiSaveLine } from "react-icons/ri";

import AlertMessage from "../app/AlertMessage";
import Field from "../app/Field";
import FormSheet from "../app/FormSheet";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import Combobox from "../app/Combobox";
import { ABSENCE_TYPES } from "../../util/absence-types";
import { toIsoDay } from "../../util/period";
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
  const [from, setFrom] = useState(() => toIsoDay(new Date()));
  const [to, setTo] = useState(() => toIsoDay(new Date()));
  const [comment, setComment] = useState("");
  const [impact, setImpact] = useState<{ workingDays: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showEmployeePicker = canManage && employees.length > 0;
  const targetId = showEmployeePicker ? userId : defaultUserId;

  useEffect(() => {
    if (open) {
      setUserId(defaultUserId);
      setType("vacation");
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
          ? "человека не будет в календаре"
          : "человек продолжает работать",
      })),
    [],
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

  // Живая сводка периода — тем же планировщиком, что строит календарь: форма
  // не должна обещать одно, а календарь показывать другое
  const loadImpact = useCallback(async () => {
    if (!targetId || !from || !to || to < from) {
      setImpact(null);
      return;
    }
    try {
      const response = await fetch(
        `${API}/api/team/absences/impact?user=${targetId}&from=${from}&to=${to}`,
      );
      if (!response.ok) throw new Error(String(response.status));
      setImpact(await response.json());
    } catch {
      setImpact(null);
    }
  }, [targetId, from, to]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(loadImpact, 250);
    return () => clearTimeout(timer);
  }, [open, loadImpact]);

  const submit = async () => {
    if (to < from) {
      setError("Дата окончания раньше даты начала");
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
          from,
          to,
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

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="С" htmlFor="abs-from" required>
          <Input
            id="abs-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
        <Field label="По" htmlFor="abs-to" required>
          <Input
            id="abs-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </Field>
      </div>

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

      {days !== null && (
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
                  · человек продолжает работать, в календаре останется доступным
                </>
              )}
              {!canManage &&
                " · запрос уйдёт на согласование, до решения календарь не меняется"}
            </>
          }
        />
      )}
      <div className="sticky bottom-0 -mx-6 mt-6 flex items-center justify-end gap-2.5 bg-background px-6 py-3">
        <Button
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={saving}
        >
          Отмена
        </Button>
        <Button
          onClick={submit}
          disabled={saving || (showEmployeePicker && !userId)}
        >
          <RiSaveLine />
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
      </div>
    </FormSheet>
  );
};

export default AbsenceForm;
