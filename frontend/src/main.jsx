import React, { lazy, Suspense, useContext } from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { ThemeContext, ThemeProvider } from "./store/theme-context";
import * as Sentry from "@sentry/react";

import App from "./App";
import store from "./store/index";
import BackToTop from "./UI/BackToTop";


import 'sortable-tablesort/dist/sortable.min.css'
import 'sortable-tablesort/dist/sortable.min.js'

import("./index.css");

if (process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: "https://209b71c7ccb137805dac5178fb84e06d@o4509229246840832.ingest.de.sentry.io/4509229249527888",
    sendDefaultPii: true,
  });
}

const LightTheme = lazy(() => import("./layout/LightTheme"));
const DarkTheme = lazy(() => import("./layout/DarkTheme"));

const ThemeSelector = ({ children }) => {
  const { isDark } = useContext(ThemeContext);

  return (
    <>
      <Suspense fallback={null}>
        {!isDark ? <LightTheme /> : <DarkTheme />}
      </Suspense>
      {children}
    </>
  );
};

const container = document.getElementById("root");
const root = ReactDOM.createRoot(container);

root.render(
  <Provider store={store}>
    <ThemeProvider>
      <ThemeSelector>
        <App />
        <BackToTop />
      </ThemeSelector>
    </ThemeProvider>
  </Provider>
);
