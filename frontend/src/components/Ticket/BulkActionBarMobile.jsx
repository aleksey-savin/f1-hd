import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import Spinner from "react-bootstrap/Spinner";

import { RiErrorWarningLine } from "react-icons/ri";

// Сколько показывать причину блокировки, прежде чем вернуть счётчик.
const HINT_MS = 4000;

// Контекстная панель массовых действий на мобильных. Пока выделены заявки, она
// занимает место плавающего острова навигации (тот же бокс и поверхность), а не
// висит над ним второй плашкой. Позиционируется absolute внутри .mobile-shell —
// fixed на мобайле не используем (см. app-shell в index.css).
const BulkActionBarMobile = ({ count, actions, isLoading, onPick, onReset }) => {
  const reduceMotion = useReducedMotion();

  const [shell, setShell] = useState(null);
  useEffect(() => setShell(document.querySelector(".mobile-shell")), []);

  // На тач-экране hover-тултипа нет, поэтому заблокированная кнопка остаётся
  // нажимаемой: тап подменяет строку счётчика причиной блокировки.
  const [hint, setHint] = useState(null);
  const hintTimer = useRef(null);

  const showHint = (reason) => {
    clearTimeout(hintTimer.current);
    setHint(reason);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  };

  // Сменилось выделение — прежняя причина устарела.
  useEffect(() => {
    clearTimeout(hintTimer.current);
    setHint(null);
  }, [count]);

  useEffect(() => () => clearTimeout(hintTimer.current), []);

  if (!shell) return null;

  return createPortal(
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          className="mobile-actionbar"
          role="toolbar"
          aria-label="Действия над выбранными заявками"
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
                  key="count"
                  className="mobile-actionbar__count"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.12 }}
                >
                  <span>Выбрано: {count}</span>
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
              onClick={onReset}
              disabled={isLoading}
            >
              Отмена
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

export default BulkActionBarMobile;
