import { useState } from "react";
import { RiListUnordered, RiMap2Line } from "react-icons/ri";

// Вид окружения: «Список» (по умолчанию) — уровни строками с переходом выше и
// ниже; «План» — семантический зум со сценой. Выбор — удобство зрителя: живёт
// в этом браузере, без хранилища открывается список.
const STORAGE_KEY = "environmentView";

export const ENVIRONMENT_VIEW_OPTIONS = [
  { value: "list", label: "Список", icon: <RiListUnordered size={15} /> },
  { value: "plan", label: "План", icon: <RiMap2Line size={15} /> },
];

const readView = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "plan" ? "plan" : "list";
  } catch {
    return "list";
  }
};

export const useEnvironmentView = () => {
  const [view, setView] = useState(readView);
  const changeView = (next) => {
    setView(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Хранилище закрыто (приватное окно) — выбор живёт до ухода со страницы
    }
  };
  return [view, changeView];
};
