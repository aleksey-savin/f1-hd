import { useEffect, useLayoutEffect } from "react";
import { useNavigate, useRouteError } from "react-router";

import useRouteErrorStore from "../store/route-error";
import { clearSession } from "./Auth/session";

import NotFound from "../components/Error/404";
import Forbidden from "../components/Error/403";
import InternalServerError from "../components/Error/500";
import ServiceUnavailable from "../components/Error/503";
import NetworkError from "../components/Error/NetworkError";

// Сетевой сбой fetch — TypeError с браузер-специфичным сообщением («Failed to
// fetch» / «NetworkError…» / «Load failed»); рендерные TypeError («Cannot read
// properties of…») под шаблон не подходят и честно уходят в 500.
const isNetworkFailure = (error) =>
  error instanceof TypeError &&
  /fetch|network|load failed/i.test(error.message ?? "");

const Error = () => {
  const error = useRouteError();
  const navigate = useNavigate();
  const setRouteError = useRouteErrorStore((s) => s.setActive);
  const status = error?.status;

  // Root по флагу кладёт страницу ошибки на канву (как мигрированный маршрут)
  // и прячет сайдбар. Layout-эффект — чтобы легаси-Card не мигнул до канвы.
  useLayoutEffect(() => {
    setRouteError(true);
    return () => setRouteError(false);
  }, [setRouteError]);

  // Недействительный или отозванный сеанс — не страница, а вход заново.
  // clearSession обязателен: без него следующий заход утыкался в тот же
  // мёртвый токен и снова оказывался здесь.
  useEffect(() => {
    if (status === 401) {
      clearSession();
      navigate("/auth");
    }
  }, [status, navigate]);

  if (status === 401) {
    return null;
  }
  if (status === 403) {
    return <Forbidden />;
  }
  if (status === 404) {
    return <NotFound />;
  }
  if ([502, 503, 504].includes(status)) {
    return <ServiceUnavailable status={status} />;
  }
  if (!status && isNetworkFailure(error)) {
    return <NetworkError />;
  }
  return <InternalServerError status={status} />;
};

export default Error;
