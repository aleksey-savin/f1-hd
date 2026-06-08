import { RiCheckLine } from "react-icons/ri";

/**
 * Горизонтальный степпер: кружки с номерами/галочками, подписи и линия-индикатор.
 * Клик по шагу разрешён в edit-режиме (allowJump) или по уже достигнутым шагам.
 */
const WizardStepper = ({
  steps,
  currentStep,
  maxReached = 0,
  allowJump = false,
  onStepClick,
}) => {
  const lastIndex = steps.length - 1;

  return (
    <div className="d-flex mb-4">
      {steps.map((step, i) => {
        const isCompleted = i < currentStep;
        const isCurrent = i === currentStep;
        const clickable = allowJump || i <= maxReached;

        const circleClass = isCompleted
          ? "bg-success text-white"
          : isCurrent
            ? "bg-primary text-white"
            : "bg-secondary-subtle text-secondary";

        const labelClass = isCurrent
          ? "fw-semibold text-primary"
          : isCompleted
            ? "text-success"
            : "text-muted";

        const handleClick = clickable ? () => onStepClick(i) : undefined;
        const cursor = clickable ? "pointer" : "default";

        return (
          <div
            key={step.label}
            className="flex-fill text-center position-relative"
            style={{ minWidth: 0 }}
          >
            {/* Линия-индикатор за кружком (две половины) */}
            {i !== 0 && (
              <div
                className={i <= currentStep ? "bg-primary" : "bg-secondary-subtle"}
                style={{
                  position: "absolute",
                  top: 15,
                  left: 0,
                  width: "50%",
                  height: 2,
                }}
              />
            )}
            {i !== lastIndex && (
              <div
                className={i < currentStep ? "bg-primary" : "bg-secondary-subtle"}
                style={{
                  position: "absolute",
                  top: 15,
                  left: "50%",
                  width: "50%",
                  height: 2,
                }}
              />
            )}

            <div
              onClick={handleClick}
              className={`rounded-circle d-inline-flex align-items-center justify-content-center position-relative ${circleClass}`}
              style={{
                width: 32,
                height: 32,
                zIndex: 1,
                fontSize: 14,
                cursor,
              }}
            >
              {isCompleted ? <RiCheckLine /> : i + 1}
            </div>

            <div
              onClick={handleClick}
              className={`small mt-1 px-1 ${labelClass}`}
              style={{ cursor, lineHeight: 1.1 }}
            >
              {step.label}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default WizardStepper;
