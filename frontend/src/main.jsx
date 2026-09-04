import ReactDOM from "react-dom/client";
import { ThemeProvider } from "./store/theme-context";
import * as Sentry from "@sentry/react";

import App from "./App";

import "@fontsource-variable/inter";
import "./styles/tailwind.css";

import("./index.css");

if (process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: "https://209b71c7ccb137805dac5178fb84e06d@o4509229246840832.ingest.de.sentry.io/4509229249527888",
    sendDefaultPii: true,
  });
}

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
