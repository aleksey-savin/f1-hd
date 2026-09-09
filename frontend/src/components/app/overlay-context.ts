import { createContext, useContext, useEffect, useState } from "react";
import type { RefObject } from "react";

// Скроллящийся контейнер оверлея (внутренность FormSheet). Длинная форма
// листается внутри шторки, а не окном, поэтому app/AnchorRail внутри неё обязан
// слушать этот элемент: на window скролла нет, и подсветка секции не работала бы.
// null — обычная страница, слушаем window.
export const OverlayScrollContext = createContext<HTMLElement | null>(null);

// Контент шторки/диалога — по слоту shadcn. У поповера слот свой, поэтому
// вложенный поповер за оверлей не считается: блокировку ставит только диалог.
const OVERLAY_CONTENT_SELECTOR = [
  '[data-slot="sheet-content"]',
  '[data-slot="dialog-content"]',
  '[data-slot="alert-dialog-content"]',
].join(",");

/**
 * Мы внутри шторки или диалога?
 *
 * Нужно выпадающим спискам. Radix-диалог глушит колесо везде, кроме своего
 * контента: он отдаёт в `react-remove-scroll` шардом ровно `contentRef`, а
 * поповер портуется в `body` — мимо разрешённого поддерева, и список внутри
 * него не прокручивался вовсе (стрелками ходил, колесом и пальцем — нет).
 *
 * Лечится модальным поповером: тот ставит СВОЮ блокировку, а в
 * `react-remove-scroll` блокировки живут стеком, и активна только верхняя —
 * диалог замолкает, пока список открыт. Вне оверлея модальность не нужна и
 * вредна: она прячет полосу прокрутки страницы, и та дёргается при каждом
 * открытии.
 *
 * Оверлей узнаём двумя путями. Контекст ставит только `app/FormSheet` (ему
 * элемент нужен и для рейла секций), поэтому основной путь — ССЫЛКА НА
 * ТРИГГЕР: ищем контент диалога среди предков. Так работает любой оверлей
 * приложения — фильтр-шторка списка, диалоги привязки и подтверждения, — а не
 * только тот, что не забыли обернуть провайдером.
 */
export const useInOverlay = (triggerRef?: RefObject<HTMLElement | null>) => {
  const inFormSheet = useContext(OverlayScrollContext) !== null;
  const [inDialog, setInDialog] = useState(false);

  // После монтирования: предки триггера уже на месте (контент диалога рисуется
  // раньше своих детей), а до первого клика по нему — целая вечность.
  useEffect(() => {
    if (!triggerRef) return;
    setInDialog(
      Boolean(triggerRef.current?.closest(OVERLAY_CONTENT_SELECTOR)),
    );
  }, [triggerRef]);

  return inFormSheet || inDialog;
};
