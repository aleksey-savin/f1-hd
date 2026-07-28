import type { ComponentType, ReactNode } from "react";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { isMobile } from "react-device-detect";
import { RiCloseLine, RiLoader4Line } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import MobileActionBar from "@/components/app/MobileActionBar";

// Плавающая панель массовых действий над выделением в списке.
//
// Один массив `actions` — источник правды для обеих поверхностей: на десктопе
// это панель у нижнего края, на мобайле — остров `app/MobileActionBar`,
// занимающий место таб-бара (на экране всегда ровно один плавающий объект).
//
// Заблокированное действие (непустая `reason`) остаётся нажимаемым и объясняет
// причину: на десктопе — тултипом по наведению, на мобилке — подменой строки
// статуса по тапу. Причина обязана называть объекты по имени, а не по id.
export type BulkAction = {
  key: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  /** Причина блокировки; пустая — действие доступно. */
  reason?: string | null;
  /** Разрушающее — единственное цветное действие в панели. */
  danger?: boolean;
};

const BulkActionBar = ({
  count,
  actions,
  isLoading = false,
  onPick,
  onClear,
  statusText,
  ariaLabel = "Действия над выбранными",
  clearLabel = "Сбросить",
}: {
  count: number;
  actions: BulkAction[];
  isLoading?: boolean;
  onPick: (key: string) => void;
  onClear: () => void;
  /** По умолчанию — «Выбрано: N». */
  statusText?: ReactNode;
  ariaLabel?: string;
  clearLabel?: string;
}) => {
  const reduceMotion = useReducedMotion();

  if (actions.length === 0) {
    return null;
  }

  const status = statusText ?? `Выбрано: ${count}`;

  if (isMobile) {
    return (
      <MobileActionBar
        show={count > 0}
        statusText={status}
        actions={actions}
        isLoading={isLoading}
        onPick={onPick}
        onCancel={onClear}
        cancelLabel={clearLabel}
        ariaLabel={ariaLabel}
      />
    );
  }

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 420, damping: 34 }
          }
          className="tw:fixed tw:inset-x-0 tw:bottom-4 tw:flex tw:justify-center tw:px-4"
          // Легаси-шкала z (tw-сетка заканчивается на 50): выше radix-оверлеев
          // приложения, как и прежняя панель заявок
          style={{ zIndex: 1100 }}
        >
          <TooltipProvider delayDuration={150}>
            <div
              role="toolbar"
              aria-label={ariaLabel}
              className="tw:flex tw:max-w-full tw:flex-wrap tw:items-center tw:gap-2 tw:rounded-xl tw:border tw:border-border tw:bg-card tw:px-3 tw:py-2 tw:shadow-lg"
            >
              <span className="tw:inline-flex tw:items-center tw:gap-2 tw:pe-1 tw:text-sm tw:font-semibold tw:whitespace-nowrap">
                {status}
                {isLoading && (
                  <RiLoader4Line
                    className="tw:animate-spin tw:text-faint"
                    role="status"
                    aria-label="Выполняется"
                  />
                )}
              </span>

              {actions.map(({ key, icon: Icon, label, reason, danger }) => {
                const blocked = !!reason;
                const button = (
                  <Button
                    size="sm"
                    variant={danger ? "destructive" : "outline"}
                    // Заблокированная кнопка не disabled: тултип должен ловить
                    // наведение, а причина — доходить до пользователя.
                    aria-disabled={blocked || isLoading}
                    className={blocked ? "tw:opacity-50" : undefined}
                    onClick={() => {
                      if (blocked || isLoading) return;
                      onPick(key);
                    }}
                  >
                    <Icon /> {label}
                  </Button>
                );

                if (!blocked) {
                  return <span key={key}>{button}</span>;
                }

                return (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>{button}</TooltipTrigger>
                    <TooltipContent style={{ zIndex: 1101 }}>
                      {reason}
                    </TooltipContent>
                  </Tooltip>
                );
              })}

              <Button
                size="sm"
                variant="ghost"
                onClick={onClear}
                disabled={isLoading}
              >
                <RiCloseLine /> {clearLabel}
              </Button>
            </div>
          </TooltipProvider>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default BulkActionBar;
