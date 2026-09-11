import { useCallback, useEffect, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/app/Spinner";
import AlertMessage from "@/components/app/AlertMessage";
import { getAbsenceType } from "@/util/absence-types";

// Свои отсутствия: заявка, ждущая решения, и решённые — со статусом, автором
// решения и причиной отказа. Жила в «Моём аккаунте», но личные настройки — про
// поведение приложения, а не про архив заявок; теперь список открывается с
// календаря команды, там же, где заявку и заводят.
//
// Ждущую заявку календарь показывает и без шторки, отдельной строкой над
// сеткой: отзывать имеет смысл ровно пока она висит. Здесь она повторена, чтобы
// список был полным, и «Отозвать» работает из обоих мест.

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
  pending: "На согласовании",
  approved: "Согласовано",
  rejected: "Отклонено",
  cancelled: "Отозвано",
};

const Row = ({
  absence,
  busy,
  onCancel,
}: {
  absence: Absence;
  busy: boolean;
  onCancel: (id: string) => void;
}) => {
  const meta = getAbsenceType(absence.type);
  const approved = absence.status === "approved";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-soft py-2.5 text-sm first:border-t-0">
      <span
        className="grid h-6 min-w-8 place-items-center rounded-md px-1.5 text-xs font-bold"
        style={{
          color: approved ? undefined : meta?.color,
          background: approved
            ? `color-mix(in srgb, ${meta?.color} 17%, transparent)`
            : "transparent",
          border: approved
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
      <span className={`ms-auto text-xs ${STATUS_TONE[absence.status]}`}>
        {STATUS_LABEL[absence.status]}
        {absence.decidedBy &&
          absence.status !== "pending" &&
          ` · ${absence.decidedBy.lastName} ${absence.decidedBy.firstName?.slice(0, 1)}.`}
      </span>
      {absence.status === "pending" && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => onCancel(absence._id)}
        >
          Отозвать
        </Button>
      )}
    </div>
  );
};

const MyAbsencesSheet = ({
  open,
  onOpenChange,
  userId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  /** Заявку отозвали — календарю нужно перечитать сетку. */
  onChanged?: () => void;
}) => {
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API}/api/team/absences?user=${userId}`);
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json();
      setAbsences(payload.absences ?? []);
      setError(null);
    } catch (loadError) {
      console.warn("Свои отсутствия не загрузились:", loadError);
      setError("Не удалось загрузить отсутствия.");
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const cancel = async (id: string) => {
    setBusyId(id);
    try {
      const response = await fetch(`${API}/api/team/absences/${id}/cancel`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
      onChanged?.();
    } catch (cancelError) {
      console.warn("Заявка не отозвалась:", cancelError);
      setError("Не удалось отозвать заявку.");
    } finally {
      setBusyId(null);
    }
  };

  // Отозванные не показываем: человек сам их снял, и держать их в списке
  // значит копить шум ради ничего
  const visible = absences.filter((absence) => absence.status !== "cancelled");
  const waiting = visible.filter((absence) => absence.status === "pending");
  const decided = visible.filter((absence) => absence.status !== "pending");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-5 sm:max-w-md"
      >
        <SheetTitle className="mb-1 pr-8 text-lg">Мои отсутствия</SheetTitle>
        <SheetDescription className="sr-only">
          Заявки на отпуска, отгулы и больничные со статусом решения
        </SheetDescription>

        {isLoading ? (
          <div className="py-10">
            <Spinner />
          </div>
        ) : error ? (
          <AlertMessage variant="danger" message={error} />
        ) : visible.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Отпусков, отгулов и больничных пока не записано. Заявка заводится
            кнопкой «Отсутствие» и уходит на согласование — до решения календарь
            не меняется.
          </p>
        ) : (
          <>
            {waiting.length > 0 && (
              <>
                <div className="mt-4 mb-1 text-xs font-bold tracking-wider text-faint uppercase">
                  Ждёт решения
                </div>
                {waiting.map((absence) => (
                  <Row
                    key={absence._id}
                    absence={absence}
                    busy={busyId === absence._id}
                    onCancel={cancel}
                  />
                ))}
              </>
            )}
            {decided.length > 0 && (
              <>
                <div className="mt-5 mb-1 text-xs font-bold tracking-wider text-faint uppercase">
                  Решённые
                </div>
                {decided.map((absence) => (
                  <Row
                    key={absence._id}
                    absence={absence}
                    busy={busyId === absence._id}
                    onCancel={cancel}
                  />
                ))}
              </>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default MyAbsencesSheet;
