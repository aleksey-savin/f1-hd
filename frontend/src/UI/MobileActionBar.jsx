import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import Spinner from "react-bootstrap/Spinner";

import { RiErrorWarningLine } from "react-icons/ri";

// Сколько показывать причину блокировки, прежде чем вернуть строку статуса.
const HINT_MS = 4000;

// Контекстная панель действий на мобильных. Пока она в DOM, панель занимает
// место плавающего острова навигации (тот же бокс и поверхность), а не висит
// над ним второй плашкой: на экране всегда ровно один плавающий объект.
// Позиционируется absolute внутри .mobile-shell — fixed на мобайле не
// используем (см. app-shell в index.css).
//
// actions: [{ key, icon, label, reason, danger }]. Непустая reason гасит
// действие, но кнопка остаётся нажимаемой: на тач-экране hover-тултипа нет, и
// тап должен объяснить причину, а не промолчать.
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

  const [shell, setShell] = useState(null);
  useEffect(() => setShell(document.querySelector(".mobile-shell")), []);

  const [hint, setHint] = useState(null);
  const hintTimer = useRef(null);

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
          className="mobile-actionbar"
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
          <div className="mobile-actionbar__status">
            <AnimatePresence mode="wait" initial={false}>
              {hint ? (
                <motion.p
                  key="hint"
                  className="mobile-actionbar__hint"
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
                  className="mobile-actionbar__count"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.12 }}
                >
                  <span>{statusText}</span>
                  {isLoading && (
                    <Spinner
                      animation="border"
                      size="sm"
                      role="status"
                      aria-label="Обновление данных"
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="button"
              className="mobile-actionbar__cancel"
              onClick={onCancel}
              disabled={isLoading}
            >
              {cancelLabel}
            </button>
          </div>

          <div className="mobile-actionbar__actions">
            {actions.map(({ key, icon: Icon, label, reason, danger }) => {
              const blocked = !!reason;

              return (
                <button
                  key={key}
                  type="button"
                  className={`mobile-actionbar__action${
                    blocked ? " is-blocked" : ""
                  }${danger ? " is-danger" : ""}`}
                  aria-disabled={blocked || isLoading}
                  onClick={() => {
                    if (isLoading) return;
                    if (blocked) return showHint(reason);
                    onPick(key);
                  }}
                >
                  <Icon className="mobile-actionbar__icon" aria-hidden="true" />
                  <span className="mobile-actionbar__label">{label}</span>
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
