import { createContext } from "react";

// true — поддерево рендерится внутри МОДАЛЬНОГО radix-оверлея (FormSheet,
// Sheet фильтра, Dialog). Модальный radix вешает pointer-events: none на body
// и закрывается по pointerdown снаружи контента, поэтому порталы «в body»
// (меню react-select) там некликабельны и роняют шторку. UI/Select по этому
// контексту переключается на инлайн-меню без портала.
export const InsideOverlayContext = createContext(false);

// Скроллящийся контейнер оверлея (внутренность FormSheet). Длинная форма
// листается внутри шторки, а не окном, поэтому app/AnchorRail внутри неё обязан
// слушать этот элемент: на window скролла нет, и подсветка секции не работала бы.
// null — обычная страница, слушаем window.
export const OverlayScrollContext = createContext<HTMLElement | null>(null);
