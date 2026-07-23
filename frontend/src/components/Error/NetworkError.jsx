import { useEffect } from "react";

import { Button } from "@/components/ui/button";

import ErrorScreen from "./ErrorScreen";
import { useAvailabilityProbe } from "./use-availability-probe";

// Запрос не дошёл до сервера (Wi-Fi, VPN, сеть): HTTP-кода нет — кот соло.
// Как только браузер сообщит о возвращении сети, пробуем сами.
const NetworkError = () => {
  const { probe, probing } = useAvailabilityProbe();

  useEffect(() => {
    window.addEventListener("online", probe);
    return () => window.removeEventListener("online", probe);
  }, [probe]);

  return (
    <ErrorScreen
      code={null}
      title="Нет соединения"
      body="Не получилось связаться с сервером. Проверьте интернет — продолжим сами, как только связь вернётся."
      actions={
        <Button onClick={probe} disabled={probing}>
          Повторить
        </Button>
      }
      auto="повторим, когда сеть появится"
      tech={{ tone: "muted", text: "сеть · запрос не дошёл до сервера" }}
    />
  );
};

export default NetworkError;
