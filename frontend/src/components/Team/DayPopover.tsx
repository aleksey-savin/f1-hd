import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { TeamScheduleResponse } from "@/types/teamSchedule";

import { dotState, fullName, humanDate, longDate } from "./calendar";

type Props = {
  data: TeamScheduleResponse;
  dateKey: string | null;
  onClose: () => void;
  onAddAbsence: () => void;
};

/**
 * Клик по дню — «кто именно». Сначала те, на кого можно рассчитывать, потом
 * отсутствующие с датой возврата: без неё «в отпуске» не отвечает на вопрос
 * «когда он вернётся».
 */
const DayPopover = ({ data, dateKey, onClose, onAddAbsence }: Props) => {
  if (!dateKey) return null;

  const isToday = dateKey === data.period.today;
  const meta = data.calendar.days.find((day) => day.date === dateKey);

  const rows = data.employees
    .map((member) => ({
      member,
      day: member.days.find((item) => item.date === dateKey),
    }))
    .filter((row) => row.day);

  const working = rows.filter((row) => !row.day!.away && !row.day!.offDuty);
  const away = rows.filter((row) => row.day!.away);
  const offDuty = rows.filter((row) => row.day!.offDuty);

  const line = (row: (typeof rows)[number]) => {
    const day = row.day!;
    const dot = dotState(row.member, day, isToday);
    const label = day.absence
      ? `${day.absence.label.toLowerCase()}${day.absence.to > dateKey ? ` до ${humanDate(day.absence.to)}` : ""}`
      : day.offDuty
        ? (day.holidayTitle ?? "не на работе")
        : isToday && row.member.status
          ? row.member.status.label
          : "по графику";
    return (
      <div
        key={row.member.user._id}
        className="tw:flex tw:items-center tw:gap-2.5 tw:px-1 tw:py-1.5 tw:text-sm"
      >
        <span
          className="tw:size-2 tw:flex-none tw:rounded-full"
          style={{ background: dot.color }}
        />
        <span className="tw:min-w-0 tw:flex-1 tw:truncate">
          {fullName(row.member.user)}
        </span>
        <span className="tw:flex-none tw:text-xs tw:text-faint">{label}</span>
      </div>
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {longDate(dateKey)}
            {isToday && (
              <span className="tw:ms-2 tw:text-xs tw:font-bold tw:tracking-wide tw:text-primary tw:uppercase">
                сегодня
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {meta?.title ? `${meta.title} · ` : ""}
            работают {working.length} · отсутствуют {away.length}
            {offDuty.length > 0 ? ` · не на работе ${offDuty.length}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="tw:max-h-96 tw:overflow-y-auto">
          {working.map(line)}
          {away.length > 0 && (
            <div className="tw:my-2 tw:h-px tw:bg-border-soft" />
          )}
          {away.map(line)}
          {offDuty.length > 0 && (
            <>
              <div className="tw:my-2 tw:h-px tw:bg-border-soft" />
              {offDuty.map(line)}
            </>
          )}
        </div>

        <div className="tw:flex tw:justify-end tw:gap-2.5 tw:border-t tw:border-border-soft tw:pt-3.5">
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button variant="outline" onClick={onAddAbsence}>
            Новое отсутствие
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DayPopover;
