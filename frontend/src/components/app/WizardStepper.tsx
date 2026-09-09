import { RiCheckLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

type Step = { label: string };

// Горизонтальный степпер мастера (эталон — макет формы услуги): кружки с
// номером/галочкой, подписи, линия-индикатор между пройденными шагами. Клик по
// шагу разрешён по уже достигнутым (`maxReached`) — степпер живёт только в
// создании, правка идёт плоскими секциями (см. ux-ui-guide).
const WizardStepper = ({
  steps,
  current,
  maxReached = 0,
  onStepClick,
  className,
}: {
  steps: Step[];
  current: number;
  maxReached?: number;
  onStepClick?: (index: number) => void;
  className?: string;
}) => {
  const last = steps.length - 1;

  return (
    <div className={cn("flex", className)}>
      {steps.map((step, i) => {
        const done = i < current;
        const cur = i === current;
        const clickable = !!onStepClick && i <= maxReached;
        const go = clickable ? () => onStepClick?.(i) : undefined;

        return (
          <div key={step.label} className="relative min-w-0 flex-1 text-center">
            {/* Половины линии-коннектора за кружком */}
            {i !== 0 && (
              <span
                className={cn(
                  "absolute top-4 left-0 h-0.5 w-1/2",
                  i <= current ? "bg-primary" : "bg-border",
                )}
              />
            )}
            {i !== last && (
              <span
                className={cn(
                  "absolute top-4 left-1/2 h-0.5 w-1/2",
                  i < current ? "bg-primary" : "bg-border",
                )}
              />
            )}

            <button
              type="button"
              disabled={!clickable}
              onClick={go}
              className={cn(
                "relative z-10 flex w-full flex-col items-center gap-1.5 appearance-none border-0 bg-transparent p-0 outline-none",
                clickable ? "cursor-pointer" : "cursor-default",
              )}
            >
              <span
                className={cn(
                  "grid size-8 place-items-center rounded-full text-sm font-semibold",
                  done || cur
                    ? "bg-primary text-white"
                    : "bg-accent text-faint inset-ring inset-ring-border",
                )}
              >
                {done ? <RiCheckLine /> : i + 1}
              </span>
              <span
                className={cn(
                  "px-1 text-xs leading-tight",
                  cur
                    ? "font-semibold text-accent-text"
                    : done
                      ? "font-medium text-muted-foreground"
                      : "font-medium text-faint",
                )}
              >
                {step.label}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default WizardStepper;
