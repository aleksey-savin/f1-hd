import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { RiErrorWarningLine, RiLoader4Line } from "react-icons/ri";

import { cn } from "@/lib/utils";

// Сколько показывать причину блокировки, прежде чем вернуть строку статуса.
const HINT_MS = 4000;

// Мобильная половина app/BulkActionBar — контекстная панель действий на
// мобильных (её же напрямую использует легаси-панель заявок). Пока она в DOM,
// панель занимает место плавающего острова навигации (тот же бокс и
// поверхность), а не висит над ним второй плашкой: на экране всегда ровно один
// плавающий объект. Позиционируется absolute внутри .mobile-shell — fixed на
// мобайле не используем (см. app-shell в index.css).
//
// Непустая `reason` гасит действие, но кнопка остаётся нажимаемой: на тач-экране
// hover-тултипа нет, и тап должен объяснить причину, а не промолчать.
//
// Типы описаны JSDoc'ом: файл остаётся .jsx (react-dom без @types), но props
// должны выводиться — иначе `actions` схлопывается в never[] у вызывающего
// app/BulkActionBar.tsx.
/**
 * @typedef {import("@/components/app/BulkActionBar").BulkAction} BarAction
 *
 * @param {object} props
 * @param {boolean} [props.show]
 * @param {import("react").ReactNode} [props.statusText]
 * @param {BarAction[]} [props.actions]
 * @param {boolean} [props.isLoading]
 * @param {(key: string) => void} props.onPick
 * @param {(() => void) | undefined} [props.onCancel]
 * @param {string} [props.cancelLabel]
 * @param {string} [props.ariaLabel]
 */
const MobileActionBar = ({
  show,
  statusText,
  actions = [],
  isLoading,
  onPick,
  onCancel,
  cancelLabel = "Отмена",
  ariaLabel = "Действия",
}) => {
  const reduceMotion = useReducedMotion();

  const [shell, setShell] = useState(/** @type {Element | null} */ (null));
  useEffect(() => setShell(document.querySelector(".mobile-shell")), []);

  const [hint, setHint] = useState(/** @type {string | null} */ (null));
  const hintTimer = useRef(undefined);

  const showHint = (reason) => {
    clearTimeout(hintTimer.current);
    setHint(reason);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  };

  // Сменился статус (например, выделение) — прежняя причина устарела.
  useEffect(() => {
    clearTimeout(hintTimer.current);
    setHint(null);
  }, [statusText]);

  useEffect(() => () => clearTimeout(hintTimer.current), []);

  if (!shell) return null;

  return createPortal(
    <AnimatePresence>
      {show && (
        <motion.div
          className="mobile-actionbar border border-border bg-card/88 px-1.5 pb-1.5"
          role="toolbar"
          aria-label={ariaLabel}
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 420, damping: 34 }
          }
        >
          <div className="flex items-center justify-between gap-2 border-b border-border pr-1 pl-2.5">
            <AnimatePresence mode="wait" initial={false}>
              {hint ? (
                <motion.p
                  key="hint"
                  className="my-0 flex min-w-0 flex-1 items-start gap-1.5 py-2 text-xs leading-tight [&>svg]:mt-0.5 [&>svg]:flex-none [&>svg]:text-warning"
                  role="status"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.12 }}
                >
                  <RiErrorWarningLine aria-hidden="true" />
                  <span>{hint}</span>
                </motion.p>
              ) : (
                <motion.div
                  key="status"
                  className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.12 }}
                >
                  <span>{statusText}</span>
                  {isLoading && (
                    <RiLoader4Line
                      className="animate-spin"
                      role="status"
                      aria-label="Обновление данных"
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Выхода может не быть: в списках с отдельным режимом выбора он
                живёт в липкой шапке (app/SelectionBar), и второй «Отмена»
                здесь был бы дублем */}
            {onCancel && (
              <button
                type="button"
                className="tap-none min-h-11 min-w-11 flex-none cursor-pointer appearance-none self-stretch border-0 bg-transparent px-2 text-sm font-semibold text-primary focus-visible:rounded-xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                onClick={onCancel}
                disabled={isLoading}
              >
                {cancelLabel}
              </button>
            )}
          </div>

          {/* Ряд действий повторяет геометрию вкладок острова: тач-таргет ≥44px
              и подпись под иконкой — смысл несёт подпись, а не цвет. Поэтому
              цветом выделено ровно одно действие, разрушающее. */}
          <div className="flex items-stretch">
            {actions.map(({ key, icon: Icon, label, reason, danger }) => {
              const blocked = !!reason;

              return (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    "tap-none flex min-h-14 flex-1 cursor-pointer appearance-none flex-col items-center justify-center gap-1 rounded-xl border-0 bg-transparent px-0.5 py-1 transition-[opacity,background-color] motion-reduce:transition-none active:bg-primary/15 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                    danger ? "text-destructive" : "text-foreground",
                    // Заблокированное приглушено, но остаётся нажимаемым: тап
                    // должен показать причину, а не промолчать
                    blocked && "opacity-35",
                  )}
                  aria-disabled={blocked || isLoading}
                  onClick={() => {
                    if (isLoading) return;
                    if (blocked) return showHint(reason);
                    onPick(key);
                  }}
                >
                  <Icon className="size-6" aria-hidden="true" />
                  <span className="max-w-full text-center text-xs leading-tight break-words">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    shell,
  );
};

export default MobileActionBar;
