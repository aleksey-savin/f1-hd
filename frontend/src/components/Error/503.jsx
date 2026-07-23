import { useEffect } from "react";

import { Button } from "@/components/ui/button";

import ErrorScreen from "./ErrorScreen";
import { useAvailabilityProbe } from "./use-availability-probe";

const RETRY_INTERVAL_MS = 5000;

// 502/503/504 — бэкенд перезапускается (деплой, рестарт): страница проверяет
// сама и откроется без участия пользователя, как только сервис вернётся.
const ServiceUnavailable = ({ status = 503 }) => {
  const { probe, probing } = useAvailabilityProbe();

  useEffect(() => {
    const timer = setInterval(probe, RETRY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [probe]);

  const digits = String(status);

  return (
    <ErrorScreen
      code={[digits[0], digits[2]]}
      title="Обновляемся"
      body="Выкатываем новую версию — обычно это меньше минуты. Страница откроется сама, как только сервис вернётся."
      actions={
        <Button onClick={probe} disabled={probing}>
          Проверить сейчас
        </Button>
      }
      auto="проверим снова через 5 с"
      tech={{ tone: "warning", text: `${status} · сервис временно недоступен` }}
    />
  );
};

export default ServiceUnavailable;
