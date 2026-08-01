import { cn } from "@/lib/utils";

import useWorkingStatus from "./useWorkingStatus";

// Живой график работы в строке списка, hero и секции графика карточки.
// Состояние читается первым словом: цвет присутствия (--ws-st-office;
// «компания на связи» и «сотрудник в офисе» — один сигнал в системе) несут
// только точка и «открыто», длительность приглушена («открыто · ещё 4 ч 43
// мин»). Закрыто — целиком тихая фраза (закрытый офис — не ошибка), «график
// не указан» — полая точка. verbose — полная форма фразы для секции графика
// («до закрытия …» вместо «ещё …»), halo — кольцо у точки (hero карточки).
const WorkStatusText = ({
  workSchedule,
  timezone,
  verbose = false,
  halo = false,
  className,
}) => {
  const status = useWorkingStatus(workSchedule, timezone);
  const open = status.isOpened;
  const text = verbose ? status.verbose : status.detail;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm whitespace-nowrap tabular-nums",
        !open && "text-faint",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 flex-none rounded-full",
          status.unknown
            ? "bg-transparent inset-ring inset-ring-faint"
            : "bg-current",
          halo && open && "ring-4 ring-primary/20",
        )}
        style={open ? { color: "var(--ws-st-office)" } : undefined}
      />
      {open ? (
        <span>
          <span
            className="font-medium"
            style={{ color: "var(--ws-st-office)" }}
          >
            открыто
          </span>
          <span className="text-muted-foreground"> · {text}</span>
        </span>
      ) : (
        text
      )}
    </span>
  );
};

export default WorkStatusText;
