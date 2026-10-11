import ReactDOM from "react-dom/client";
import { ThemeProvider } from "./store/theme-context";
import * as Sentry from "@sentry/react";

import App from "./App";
import { adoptBrand } from "./store/prefs";
import { setDocTitle } from "./hooks/use-doc-title";
import { applyAccent, applyIcon, readCachedBrand } from "./util/brand.js";

import "@fontsource-variable/inter";
import "./styles/tailwind.css";

import("./index.css");

// Бренд с прошлой загрузки — до первой отрисовки: иначе портал со своим цветом
// на мгновение показался бы в цвете и под названием по умолчанию. Значение
// сервера приходит следом (загрузчики маршрутов и запрос ниже) и побеждает.
const cachedBrand = readCachedBrand();
applyAccent(cachedBrand.accent);
applyIcon(cachedBrand.icon);
setDocTitle("");

// После деплоя у клиента остаётся старый index.js со ссылками на чанки с
// прежними хешами, а nginx отдаёт ассеты как immutable и без фолбэка — поэтому
// ленивый import() удалённого чанка (тема, маршрут, …) ловит 404 и Vite кидает
// "Unable to preload CSS/Failed to fetch dynamically imported module".
// preventDefault() глушит необработанную ошибку (иначе она летит в Sentry и
// может уронить дерево), а перезагрузка подтягивает свежий index.html с
// актуальными хешами. Троттлинг по sessionStorage защищает от цикла, если
// ассет реально отсутствует, а не просто устарел.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();

  const KEY = "vite:lastPreloadReload";
  const now = Date.now();
  const last = Number(sessionStorage.getItem(KEY) || 0);

  if (now - last > 10000) {
    sessionStorage.setItem(KEY, String(now));
    window.location.reload();
  }
});

const container = document.getElementById("root");
const root = ReactDOM.createRoot(container);

root.render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);

// Трекинг ошибок включается конфигурацией сервера: адрес приёмника (DSN)
// приходит из публичных настроек и задаётся переменной SENTRY_DSN в .env.
// Пустое значение — Sentry не инициализируется вовсе. Запрос идёт после
// монтирования и один на загрузку страницы: общего загрузчика у экранов входа
// и у приложения нет. Сбой запроса — не повод тревожить человека: остаёмся
// без трекинга до следующей загрузки.
//
// Тем же ответом приходит бренд. Экраны входа и оболочка применяют его сами,
// из своих загрузчиков; здесь он подхватывается для страниц без загрузчика
// настроек (открытая страница согласования, экран ошибки).
async function initErrorTracking() {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/preferences-auth`,
    );
    if (!response.ok) return;

    const { sentryDsn, brand } = await response.json();
    if (brand) adoptBrand(brand);
    if (typeof sentryDsn !== "string" || !sentryDsn) return;

    Sentry.init({ dsn: sentryDsn, sendDefaultPii: false });
  } catch {
    // сеть моргнула или ответ не разобрался — работаем без трекинга
  }
}

initErrorTracking();
