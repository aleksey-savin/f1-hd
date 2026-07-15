import { createContext } from "react";

// true — поддерево рендерится внутри МОДАЛЬНОГО radix-оверлея (FormSheet,
// Sheet фильтра, Dialog). Модальный radix вешает pointer-events: none на body
// и закрывается по pointerdown снаружи контента, поэтому порталы «в body»
// (меню react-select) там некликабельны и роняют шторку. UI/Select по этому
// контексту переключается на инлайн-меню без портала.
export const InsideOverlayContext = createContext(false);
