import { useEffect, useRef } from "react";

// Порог накопленной дельты для одного шага уровня и пауза между шагами, чтобы
// инерция тачпада не проскакивала несколько уровней за один жест.
const THRESHOLD = 110;
const COOLDOWN_MS = 360;

// Колесо/тачпад → шаг по уровням иерархии. Вверх = «приблизить» (глубже, к
// рабочему месту), вниз = «отдалить». preventDefault вызываем только когда шаг
// реально возможен; на границах отпускаем — тогда скроллится страница, а не
// застревает. Слушатель вешаем нативно ({ passive: false }), т.к. React onWheel
// пассивный и не даёт preventDefault.
export default function useSemanticZoom({
  stageRef,
  levelIndex,
  maxIndex,
  navigate,
  enabled = true,
}) {
  const accum = useRef(0);
  const cooling = useRef(false);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || !enabled) return undefined;

    const onWheel = (event) => {
      // Нормализуем единицы (строки/страницы → пиксели) и клампим против инерции.
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? el.clientHeight || 800
            : 1;
      const dy = Math.max(-60, Math.min(60, event.deltaY * unit));
      const dir = dy < 0 ? 1 : -1;

      const atBoundary =
        (dir === 1 && levelIndex >= maxIndex) ||
        (dir === -1 && levelIndex <= 0);

      // На границе не перехватываем — пусть прокручивается страница.
      if (atBoundary) {
        accum.current = 0;
        return;
      }

      event.preventDefault();
      if (cooling.current) return;

      accum.current += dy;
      if (Math.abs(accum.current) >= THRESHOLD) {
        navigate(levelIndex + (accum.current < 0 ? 1 : -1));
        accum.current = 0;
        cooling.current = true;
        setTimeout(() => {
          cooling.current = false;
        }, COOLDOWN_MS);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stageRef, enabled, levelIndex, maxIndex, navigate]);
}
