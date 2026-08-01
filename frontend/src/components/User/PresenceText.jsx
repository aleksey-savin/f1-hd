import { cn } from "@/lib/utils";

// Присутствие фразой: цветная точка + подпись статуса (+ заметка сотрудника).
// Общая для строки списка, контакт-шторки и героя карточки — размер/жирность
// задаёт вызывающий через className. Не задан статус — приглушаем.
const PresenceText = ({ presence, className, showNote = true }) => {
  const { meta, unset, note } = presence;

  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      style={{ color: unset ? "var(--faint)" : meta.color }}
    >
      <span
        aria-hidden
        className="size-2 flex-none rounded-full"
        style={{ background: unset ? "var(--ws-st-unset)" : meta.color }}
      />
      {meta.label}
      {showNote && note && (
        <span className="font-normal text-faint">· {note}</span>
      )}
    </span>
  );
};

export default PresenceText;
