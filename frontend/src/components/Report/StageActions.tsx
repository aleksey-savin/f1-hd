import { useEffect, useMemo, useState } from "react";
import { RiArrowGoBackLine, RiMoreLine } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import DateField from "@/components/app/DateField";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { toDateInputValue } from "../../util/format-date";
import { reportDates, useReportDates } from "./report-zone";
import {
  rollbackMenuLabel,
  rollbackTargetOf,
  stageActionCopy,
  subjectMeta,
  type StageActionKind,
  type StageSubject,
} from "./stage-actions";
import { formatMoney } from "./work-format";

/**
 * Ходы нашей стороны по конвейеру — диалог подтверждения и меню «⋯».
 *
 * Отчёт двигают из двух мест: быстрым действием в строке списка стадии и из
 * шапки карточки. Диалог у них один, иначе одно и то же «Выставить счёт»
 * спрашивало бы по-разному. Без подтверждения не проходит ни один ход: каждый
 * меняет стадию документа, а часть из них шлёт клиенту письмо.
 *
 * Слова диалога — в `stage-actions.ts` (чистый модуль под тестами), здесь
 * только вёрстка и запросы.
 */

const API = import.meta.env.VITE_API_ADDRESS;

type Pending = { kind: StageActionKind; subject: StageSubject };

export type StageActionResult = {
  kind: StageActionKind;
  /** Отчёт расформирован: документа больше нет, карточку перечитывать нельзя. */
  dissolved: boolean;
};

const requestOf = (
  { kind, subject }: Pending,
  form: { number: string; date: string; paidAt: string },
): { path: string; body: Record<string, unknown> } => {
  const base = `/api/approval/reports/${subject.id}`;
  switch (kind) {
    case "submit":
      return { path: "/api/approval/reports", body: { ...subject.preview } };
    case "remind":
      return { path: `${base}/remind`, body: {} };
    case "invoice":
      return {
        path: `${base}/invoice`,
        body: { number: form.number.trim(), date: form.date },
      };
    case "payment":
      return { path: `${base}/payment`, body: { paidAt: form.paidAt } };
    case "archive":
      return { path: `${base}/archive`, body: {} };
    case "rollback":
      return { path: `${base}/rollback`, body: {} };
  }
};

export const useStageActions = ({
  zone,
  onDone,
}: {
  /** Пояс организации из ответа сервера: в нём диалог называет даты. */
  zone?: string | null;
  onDone: (result: StageActionResult) => void;
}) => {
  const inherited = useReportDates();
  const dates = useMemo(
    () => (zone ? reportDates(zone) : inherited),
    [zone, inherited],
  );
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ number: "", date: "", paidAt: "" });

  // Каждое открытие — с чистого листа: вчерашний номер счёта в сегодняшнем
  // диалоге опаснее пустого поля
  useEffect(() => {
    if (pending) {
      const today = toDateInputValue(new Date());
      setForm({ number: "", date: today, paidAt: today });
      setError(null);
    }
  }, [pending]);

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const { path, body } = requestOf(pending, form);
      const response = await fetch(`${API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Причина отказа человеческая («Отчёт некому согласовать — …») и
        // называет, что чинить, — показываем как есть и не закрываем диалог
        throw new Error(payload?.message || "Не удалось выполнить действие");
      }
      const kind = pending.kind;
      setPending(null);
      onDone({ kind, dissolved: Boolean(payload?.dissolved) });
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = pending
    ? stageActionCopy(pending.kind, pending.subject, { date: dates.shortDate })
    : null;
  const incomplete =
    pending?.kind === "invoice"
      ? !form.number.trim() || !form.date
      : pending?.kind === "payment"
        ? !form.paidAt
        : false;

  const dialog = (
    <AlertDialog
      open={Boolean(pending)}
      onOpenChange={(open) => !open && !busy && setPending(null)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
        </AlertDialogHeader>

        {pending && copy && (
          <>
            {/* Сводка — о чём спрашиваем: компания, услуга, период и сумма.
                Диалог открывается и из строки списка, где отчёта целиком не
                видно, — без неё подтверждают вслепую */}
            <div className="flex items-start gap-x-4 gap-y-1 rounded-xl border border-border-soft bg-accent/60 px-4 py-3 max-sm:flex-col">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{pending.subject.company}</div>
                <div className="text-sm text-muted-foreground">
                  {subjectMeta(pending.subject, { date: dates.shortDate })}
                </div>
              </div>
              {pending.subject.total != null && (
                <div className="text-lg font-semibold whitespace-nowrap tabular-nums">
                  {formatMoney(pending.subject.total)}
                </div>
              )}
            </div>

            {pending.kind === "invoice" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="stage-inv-number" className="mb-1.5 text-sm">
                    Номер счёта
                  </Label>
                  <Input
                    id="stage-inv-number"
                    value={form.number}
                    onChange={(event) =>
                      setForm({ ...form, number: event.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="stage-inv-date" className="mb-1.5 text-sm">
                    Дата счёта
                  </Label>
                  <DateField
                    id="stage-inv-date"
                    value={form.date}
                    onChange={(next) => setForm({ ...form, date: next })}
                    clearable={false}
                  />
                </div>
              </div>
            )}

            {pending.kind === "payment" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="stage-paid-at" className="mb-1.5 text-sm">
                    Дата полной оплаты
                  </Label>
                  <DateField
                    id="stage-paid-at"
                    value={form.paidAt}
                    onChange={(next) => setForm({ ...form, paidAt: next })}
                    clearable={false}
                  />
                </div>
              </div>
            )}

            <AlertDialogDescription>{copy.note}</AlertDialogDescription>

            {error && <AlertMessage variant="danger" message={error} />}

            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={busy}>
                Отмена
              </AlertDialogCancel>
              <Button
                type="button"
                variant={copy.variant}
                disabled={busy || incomplete}
                onClick={confirm}
              >
                {copy.confirmLabel}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );

  return {
    /** Открыть подтверждение хода. */
    open: (kind: StageActionKind, subject: StageSubject) =>
      setPending({ kind, subject }),
    /** Идёт запрос — на это время живое обновление карточки ставят на паузу. */
    busy,
    dialog,
  };
};

/**
 * Меню «⋯» отчёта: редкое и опасное. Сейчас здесь возврат на стадию назад, в
 * строке списка — ещё и вход в карточку.
 *
 * Возврат в превью — разрушающий (отчёт расформировывается, подписи пропадают),
 * возврат после счёта — нет: снимается одна отметка.
 */
export const StageMoreMenu = ({
  status,
  size = "default",
  disabled = false,
  onOpen,
  onRollback,
}: {
  status: StageSubject["status"];
  size?: "default" | "sm";
  disabled?: boolean;
  /** «Открыть отчёт» — в строке списка; на карточке пункта нет. */
  onOpen?: () => void;
  onRollback: () => void;
}) => {
  const label = rollbackMenuLabel(status);
  if (!label) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size === "sm" ? "icon-sm" : "icon"}
          disabled={disabled}
          aria-label="Ещё действия"
          // В записи списка (узкий экран) цель нажатия — не меньше 44 px
          className={cn(size === "sm" && "max-xl:size-11")}
        >
          <RiMoreLine />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onOpen && (
          <>
            <DropdownMenuItem onSelect={onOpen}>Открыть отчёт</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          variant={
            rollbackTargetOf(status) === "preview" ? "destructive" : "default"
          }
          onSelect={onRollback}
        >
          <RiArrowGoBackLine />
          {label}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
