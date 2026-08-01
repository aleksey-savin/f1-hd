import { cn } from "@/lib/utils";

const TONE_BG = {
  ok: "bg-primary/75",
  warn: "bg-warning",
  down: "bg-destructive",
  none: "bg-border",
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
        "flex items-center",
        size === "lg" ? "h-6 gap-1" : "h-3.5 gap-0.5",
        className,
      )}
    >
      {segments.map((segment, index) => (
        <span
          key={index}
          className={cn(
            size === "lg"
              ? "h-5 min-w-0 flex-1 rounded-xs"
              : "h-3.5 w-0.5 flex-none rounded-full",
            TONE_BG[segment.tone] || TONE_BG.none,
            segment.pulse && "animate-pulse motion-reduce:animate-none",
          )}
        />
      ))}
    </div>
  );
};

export default UptimeBar;
