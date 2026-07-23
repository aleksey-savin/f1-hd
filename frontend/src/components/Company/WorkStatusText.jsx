import { cn } from "@/lib/utils";

import useWorkingStatus from "./useWorkingStatus";

// Живой график работы в строке списка, hero и секции графика карточки.
// Состояние читается первым словом: цвет присутствия (--ws-st-office;
// «компания на связи» и «сотрудник в офисе» — один сигнал в системе) несут
// только точка и «открыто», длительность приглушена («открыто · ещё 4 ч 43
// мин»). Закрыто — целиком тихая фраза (закрытый офис — не ошибка), «график
// не указан» — полая точка. verbose — полная форма фразы для секции графика
// («до закрытия …» вместо «ещё …»), halo — кольцо у точки (hero карточки).
const WorkStatusText = ({ workSchedule, verbose = false, halo = false, className }) => {
  const status = useWorkingStatus(workSchedule);
  const open = status.isOpened;
  const text = verbose ? status.verbose : status.detail;

  return (
    <span
      className={cn(
        "tw:inline-flex tw:items-center tw:gap-1.5 tw:text-sm tw:whitespace-nowrap tw:tabular-nums",
        !open && "tw:text-faint",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "tw:size-2 tw:flex-none tw:rounded-full",
          status.unknown
            ? "tw:bg-transparent tw:inset-ring tw:inset-ring-faint"
            : "tw:bg-current",
          halo && open && "tw:ring-4 tw:ring-primary/20",
        )}
        style={open ? { color: "var(--ws-st-office)" } : undefined}
      />
      {open ? (
        <span>
          <span
            className="tw:font-medium"
            style={{ color: "var(--ws-st-office)" }}
          >
            открыто
          </span>
          <span className="tw:text-muted-foreground"> · {text}</span>
        </span>
      ) : (
        text
      )}
    </span>
  );
};

export default WorkStatusText;
