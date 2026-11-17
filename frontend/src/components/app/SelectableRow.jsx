import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

// Checkbox рядом со строкой, не внутри ссылки; один жест и для реестра, и для ВМ.
export default function SelectableRow({
  selection,
  id,
  label,
  enabled,
  children,
}) {
  if (!enabled) return children;
  const selected = selection.isSelected(id);
  const revealed = selection.isActive || selected;
  return (
    <div
      className={cn(
        "longpress-target group/selection relative",
        revealed && "max-md:pl-8",
        "md:pl-7",
        selected && "bg-primary/10",
      )}
      {...selection.pressProps(id)}
      onKeyDownCapture={(event) => {
        if (
          !selection.isActive ||
          !event.currentTarget.contains(event.target) ||
          event.target.closest("[data-selection-checkbox]")
        )
          return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          selection.toggle(id, { range: event.shiftKey });
        }
      }}
      onClickCapture={(event) => {
        if (!event.currentTarget.contains(event.target)) return;
        if (event.target.closest("[data-selection-checkbox]")) return;
        if (selection.consumeSuppressedClick()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.ctrlKey || event.metaKey) return;
        if (selection.isActive) {
          event.preventDefault();
          event.stopPropagation();
          selection.toggle(id, { range: event.shiftKey });
        }
      }}
    >
      <Checkbox
        data-selection-checkbox
        checked={selected}
        aria-label={`Выбрать ${label}`}
        onClick={(event) => {
          event.stopPropagation();
          selection.toggle(id, { range: event.shiftKey });
        }}
        className={cn(
          "absolute left-3 top-1/2 z-10 -translate-y-1/2 transition-opacity",
          revealed
            ? "opacity-100"
            : "opacity-0 group-hover/selection:opacity-85 group-hover/selection:delay-200 focus-visible:opacity-100 pointer-coarse:pointer-events-none",
        )}
      />
      {children}
    </div>
  );
}
