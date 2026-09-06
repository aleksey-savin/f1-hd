import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Режим выбора нескольких записей списка — отдельное состояние, а не побочный
// эффект клика по строке. Во всём приложении клик по строке ведёт на карточку, и
// это правило не ломается: выделение живёт в своём режиме.
//
// Вход: чекбокс строки (проявляется по наведению), кнопка «Выбрать» в тулбаре,
// долгий тап на мобилке. Cmd/Ctrl+click НЕ занимаем — браузер держит его
// под «открыть в новой вкладке».
//
// Выход: `exit()` («Отмена» в шапке выбора) или Escape. Снятие последней галочки
// режим не выключает: человек снимает лишнее, чтобы выбрать другое.
//
// Порядок `items` задаёт диапазон для Shift+клика, поэтому в хук передаётся тот
// же отфильтрованный и отсортированный массив, который рендерит список.

const LONG_PRESS_MS = 450;
// Палец редко стоит идеально ровно; больше 10 px — это уже прокрутка, и она
// важнее жеста (список листают куда чаще, чем выбирают).
const MOVE_TOLERANCE_PX = 10;
// Клик, пришедший после сработавшего долгого тапа, гасим — иначе tap откроет
// заявку поверх только что включённого режима.
const CLICK_SUPPRESS_MS = 500;

const useListSelection = ({ items = [], enabled = true }) => {
  const [isActive, setIsActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  // id последней тронутой строки — база отсчёта для Shift+клика
  const anchorRef = useRef(null);
  const pressRef = useRef({ timer: undefined, x: 0, y: 0, active: false });
  const suppressClickRef = useRef(false);

  const ids = useMemo(() => items.map((item) => String(item._id)), [items]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const cancelPress = useCallback(() => {
    clearTimeout(pressRef.current.timer);
    pressRef.current.timer = undefined;
    pressRef.current.active = false;
  }, []);

  useEffect(() => cancelPress, [cancelPress]);

  const exit = useCallback(() => {
    setIsActive(false);
    setSelectedIds([]);
    anchorRef.current = null;
  }, []);

  const enter = useCallback(
    (id) => {
      if (!enabled) return;
      setIsActive(true);
      if (id === undefined || id === null) return;
      const key = String(id);
      anchorRef.current = key;
      setSelectedIds((prev) => (prev.includes(key) ? prev : [...prev, key]));
    },
    [enabled],
  );

  const toggle = useCallback(
    (id, { range = false } = {}) => {
      if (!enabled) return;
      const key = String(id);
      setIsActive(true);

      // Shift+клик добавляет весь отрезок от предыдущей тронутой строки: на
      // «закрыть двадцать заявок» это единственное, что реально экономит время.
      if (range && anchorRef.current) {
        const from = ids.indexOf(anchorRef.current);
        const to = ids.indexOf(key);
        if (from !== -1 && to !== -1) {
          const slice = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
          setSelectedIds((prev) => [
            ...prev,
            ...slice.filter((item) => !prev.includes(item)),
          ]);
          anchorRef.current = key;
          return;
        }
      }

      anchorRef.current = key;
      setSelectedIds((prev) =>
        prev.includes(key)
          ? prev.filter((item) => item !== key)
          : [...prev, key],
      );
    },
    [enabled, ids],
  );

  const selectAll = useCallback(() => {
    if (!enabled) return;
    setIsActive(true);
    setSelectedIds(ids);
  }, [enabled, ids]);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  // Строки, исчезнувшие из выборки (закрыты, удалены, отфильтрованы), не должны
  // оставаться в выделении и попадать в следующее массовое действие.
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = prev.filter((id) => ids.includes(id));
      return next.length === prev.length ? prev : next;
    });
  }, [ids]);

  // Escape выходит из режима — как из любой шторки приложения. Но если открыт
  // диалог (подтверждение массового действия), Escape принадлежит ему: закрывая
  // диалог, человек отказывается от действия, а не от выбора заявок.
  useEffect(() => {
    if (!isActive) return;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      const overlayOpen = document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
      );
      if (overlayOpen) return;
      exit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isActive, exit]);

  // Долгий тап — вход в режим на мобилке. Только для тач/пера: у мыши для этого
  // есть чекбокс в жёлобе.
  const pressProps = useCallback(
    (id) => {
      if (!enabled || isActive) return {};
      return {
        onPointerDown: (event) => {
          if (event.pointerType === "mouse") return;
          pressRef.current.x = event.clientX;
          pressRef.current.y = event.clientY;
          pressRef.current.active = true;
          clearTimeout(pressRef.current.timer);
          pressRef.current.timer = setTimeout(() => {
            pressRef.current.timer = undefined;
            if (!pressRef.current.active) return;
            // Дальше режим включён и обработчики жеста больше не вешаются:
            // сбрасываем флаг сами, иначе он остался бы «нажатым» навсегда
            pressRef.current.active = false;
            suppressClickRef.current = true;
            setTimeout(() => {
              suppressClickRef.current = false;
            }, CLICK_SUPPRESS_MS);
            navigator.vibrate?.(10);
            enter(id);
          }, LONG_PRESS_MS);
        },
        onPointerMove: (event) => {
          if (!pressRef.current.timer) return;
          const dx = Math.abs(event.clientX - pressRef.current.x);
          const dy = Math.abs(event.clientY - pressRef.current.y);
          if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) cancelPress();
        },
        onPointerUp: cancelPress,
        onPointerCancel: cancelPress,
        // iOS Safari на долгое нажатие по ссылке показывает превью и меню
        // «Открыть/Скопировать» — оно бы перебило наш жест
        onContextMenu: (event) => {
          if (pressRef.current.active || suppressClickRef.current) {
            event.preventDefault();
          }
        },
      };
    },
    [enabled, isActive, enter, cancelPress],
  );

  // Возвращает true один раз — для клика, который сгенерировал долгий тап
  const consumeSuppressedClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  return {
    isActive,
    selectedIds,
    count: selectedIds.length,
    isSelected: useCallback((id) => selectedSet.has(String(id)), [selectedSet]),
    allSelected: ids.length > 0 && selectedIds.length === ids.length,
    someSelected: selectedIds.length > 0 && selectedIds.length < ids.length,
    total: ids.length,
    enter,
    exit,
    toggle,
    selectAll,
    clearSelection,
    pressProps,
    consumeSuppressedClick,
  };
};

export default useListSelection;
