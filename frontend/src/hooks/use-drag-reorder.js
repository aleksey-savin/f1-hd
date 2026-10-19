import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Перестановка строк списка: перетаскивание (десктоп, HTML5 drag-and-drop) и
// FLIP-анимация «доезда» строк до новых позиций. Общие для карточки типа
// (атрибуты внутри группы) и шторки «Группы атрибутов».

/** Копия списка, где элемент с позиции from стоит на позиции to. */
export const moveItem = (list, from, to) => {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

/**
 * Перетаскивание строк. `rowProps(bucket, index, id)` — пропсы строки; бросок
 * учитывается только внутри своей «корзины» (bucket — например, группа
 * атрибутов): над чужой индикатор не рисуется, сброс туда игнорируется.
 * На сбросе зовётся `onMove(bucket, from, to)` — индексы внутри корзины, to —
 * итоговая позиция (см. moveItem).
 *
 * Индикатор места вставки стоит там, куда строка ляжет: при движении вверх —
 * над строкой-целью, вниз — под ней (`indicator(id)` → "before" | "after").
 */
export function useDragReorder({ onMove }) {
  // ref обновляется синхронно — гарды не зависят от того, успел ли React
  // перерисоваться после dragstart
  const source = useRef(null);
  const [draggingId, setDraggingId] = useState(null);
  const [over, setOver] = useState(null);

  const clear = () => {
    source.current = null;
    setDraggingId(null);
    setOver(null);
  };

  const rowProps = (bucket, index, id) => ({
    draggable: true,
    onDragStart: (event) => {
      source.current = { bucket, index };
      setDraggingId(id);
      event.dataTransfer.effectAllowed = "move";
      // Firefox не инициирует drag без данных в dataTransfer
      try {
        event.dataTransfer.setData("text/plain", String(id));
      } catch {
        /* некоторые окружения запрещают setData — не критично */
      }
    },
    onDragEnter: () => {
      const from = source.current;
      if (!from || from.bucket !== bucket || from.index === index) {
        setOver(null);
        return;
      }
      setOver({ id, position: index > from.index ? "after" : "before" });
    },
    onDragOver: (event) => event.preventDefault(),
    onDragEnd: clear,
    onDrop: (event) => {
      event.preventDefault();
      const from = source.current;
      clear();
      if (!from || from.bucket !== bucket || from.index === index) return;
      onMove(bucket, from.index, index);
    },
  });

  const indicator = (id) => (over?.id === id ? over.position : null);

  return { rowProps, draggingId, indicator };
}

/** Классы акцентной линии места вставки (строке нужен `relative`). */
export const dropLineClass = (position) =>
  position
    ? `before:absolute before:inset-x-0 before:z-10 before:h-0.5 before:rounded-full before:bg-primary ${
        position === "after" ? "before:bottom-0" : "before:-top-px"
      }`
    : "";

/**
 * FLIP: строки плавно «доезжают» до новых позиций при любой смене порядка
 * (перетаскивание, «Выше/Ниже») и при удалении соседних. `trigger` — список в
 * порядке показа; `rowRef(id)` — ref-колбэк строки. offsetTop берём как
 * раскладочную позицию — она не зависит от самого transform, поэтому частые
 * пересортировки не сбивают замер. Уважаем prefers-reduced-motion.
 */
export function useFlipRows(trigger) {
  const nodes = useRef(new Map());
  const prevTops = useRef(new Map());
  const reduceMotion = useRef(false);

  useEffect(() => {
    reduceMotion.current =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useLayoutEffect(() => {
    for (const [id, node] of nodes.current) {
      const top = node.offsetTop;
      const prev = prevTops.current.get(id);
      if (prev != null && !reduceMotion.current) {
        const dy = prev - top;
        if (dy) {
          node.style.transition = "none";
          node.style.transform = `translateY(${dy}px)`;
          node.getBoundingClientRect(); // reflow с инвертированным сдвигом
          node.style.transition = "transform 220ms cubic-bezier(0.2, 0, 0, 1)";
          node.style.transform = "";
        }
      }
      prevTops.current.set(id, top);
    }
    // подчищаем исчезнувшие строки, чтобы карта не росла
    for (const id of prevTops.current.keys()) {
      if (!nodes.current.has(id)) prevTops.current.delete(id);
    }
  }, [trigger]);

  return useCallback(
    (id) => (el) => {
      if (el) nodes.current.set(id, el);
      else nodes.current.delete(id);
    },
    [],
  );
}
