import { createContext } from "react";

// Скроллящийся контейнер оверлея (внутренность FormSheet). Длинная форма
// листается внутри шторки, а не окном, поэтому app/AnchorRail внутри неё обязан
// слушать этот элемент: на window скролла нет, и подсветка секции не работала бы.
// null — обычная страница, слушаем window.
export const OverlayScrollContext = createContext<HTMLElement | null>(null);
