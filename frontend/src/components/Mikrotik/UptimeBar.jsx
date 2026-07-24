import { cn } from "@/lib/utils";

const TONE_BG = {
  ok: "tw:bg-primary/75",
  warn: "tw:bg-warning",
  down: "tw:bg-destructive",
  none: "tw:bg-border",
};

// Лента доступности (язык статус-пейджей): сегмент = окно времени. В строке
// списка — 30 фиксированных «палочек» по дням, на странице записи (size="lg")
// сегменты тянутся на ширину панели. Идущий простой пульсирует (reduced-motion
// гасит анимацию). Числовое значение даёт соседний текст — лента декоративна.
const UptimeBar = ({ segments, size = "sm", className }) => {
  if (!segments?.length) return null;
  return (
    <div
      aria-hidden
      className={cn(
        "tw:flex tw:items-center",
        size === "lg" ? "tw:h-6 tw:gap-1" : "tw:h-3.5 tw:gap-0.5",
        className,
      )}
    >
      {segments.map((segment, index) => (
        <span
          key={index}
          className={cn(
            size === "lg"
              ? "tw:h-5 tw:min-w-0 tw:flex-1 tw:rounded-xs"
              : "tw:h-3.5 tw:w-0.5 tw:flex-none tw:rounded-full",
            TONE_BG[segment.tone] || TONE_BG.none,
            segment.pulse &&
              "tw:animate-pulse tw:motion-reduce:animate-none",
          )}
        />
      ))}
    </div>
  );
};

export default UptimeBar;
