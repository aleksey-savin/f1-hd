import { RiCheckLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

type Step = { label: string };

// Горизонтальный степпер мастера (эталон — макет формы услуги): кружки с
// номером/галочкой, подписи, линия-индикатор между пройденными шагами. Клик по
// шагу разрешён в edit-режиме (allowJump) или по уже достигнутым шагам.
const WizardStepper = ({
  steps,
  current,
  maxReached = 0,
  allowJump = false,
  onStepClick,
  className,
}: {
  steps: Step[];
  current: number;
  maxReached?: number;
  allowJump?: boolean;
  onStepClick?: (index: number) => void;
  className?: string;
}) => {
  const last = steps.length - 1;

  return (
    <div className={cn("tw:flex", className)}>
      {steps.map((step, i) => {
        const done = i < current;
        const cur = i === current;
        const clickable = !!onStepClick && (allowJump || i <= maxReached);
        const go = clickable ? () => onStepClick?.(i) : undefined;

        return (
          <div
            key={step.label}
            className="tw:relative tw:min-w-0 tw:flex-1 tw:text-center"
          >
            {/* Половины линии-коннектора за кружком */}
            {i !== 0 && (
              <span
                className={cn(
                  "tw:absolute tw:top-4 tw:left-0 tw:h-0.5 tw:w-1/2",
                  i <= current ? "tw:bg-primary" : "tw:bg-border",
                )}
              />
            )}
            {i !== last && (
              <span
                className={cn(
                  "tw:absolute tw:top-4 tw:left-1/2 tw:h-0.5 tw:w-1/2",
                  i < current ? "tw:bg-primary" : "tw:bg-border",
                )}
              />
            )}

            <button
              type="button"
              disabled={!clickable}
              onClick={go}
              className={cn(
                "tw:relative tw:z-10 tw:flex tw:w-full tw:flex-col tw:items-center tw:gap-1.5 tw:appearance-none tw:border-0 tw:bg-transparent tw:p-0 tw:outline-none",
                clickable ? "tw:cursor-pointer" : "tw:cursor-default",
              )}
            >
              <span
                className={cn(
                  "tw:grid tw:size-8 tw:place-items-center tw:rounded-full tw:text-sm tw:font-semibold",
                  done || cur
                    ? "tw:bg-primary tw:text-white"
                    : "tw:bg-accent tw:text-faint tw:inset-ring tw:inset-ring-border",
                )}
              >
                {done ? <RiCheckLine /> : i + 1}
              </span>
              <span
                className={cn(
                  "tw:px-1 tw:text-xs tw:leading-tight",
                  cur
                    ? "tw:font-semibold tw:text-accent-text"
                    : done
                      ? "tw:font-medium tw:text-muted-foreground"
                      : "tw:font-medium tw:text-faint",
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
