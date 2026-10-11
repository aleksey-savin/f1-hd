import { useEffect } from "react";

import useInitialPrefsStore from "../store/prefs";
import { pageTitle } from "../util/brand.js";

// Заголовок вкладки — «{страница} · {название портала}». Название приходит
// из настроек («Бренд») и может доехать ПОЗЖЕ названия страницы: загрузчик
// маршрута ставит заголовок параллельно с загрузчиком корня. Поэтому страница
// запоминается, а заголовок пересобирается, когда название портала меняется.
let currentPage = "";

const compose = () => {
  document.title = pageTitle(
    currentPage,
    useInitialPrefsStore.getState().brand.productName,
  );
};

/**
 * Назвать вкладку по странице. Обычная функция, не хук: годится в загрузчике
 * маршрута, в эффекте и в теле компонента.
 */
export const setDocTitle = (page) => {
  currentPage = page ?? "";
  compose();
};

useInitialPrefsStore.subscribe((state, previous) => {
  if (state.brand.productName !== previous.brand.productName) compose();
});

const useDocTitle = (title) => {
  useEffect(() => {
    setDocTitle(title);
  }, [title]);
};

export default useDocTitle;
