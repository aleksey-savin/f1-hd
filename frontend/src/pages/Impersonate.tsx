import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import AlertMessage from "@/components/app/AlertMessage";
import { Button } from "@/components/ui/button";
import { API, clearSession, storeSession } from "./Auth/session";

/**
 * Открытие сеанса под чужой учётной записью по ссылке из карточки человека.
 *
 * Код приходит В ЯКОРЕ адреса (`/impersonate#…`), а не в query: то, что после
 * решётки, браузер серверу не отправляет, поэтому код не попадает ни в
 * `access.log` nginx, ни в логи прокси. Читаем его, обмениваем на сеанс и
 * сразу вычищаем из адресной строки — в истории браузера он тоже не нужен.
 *
 * Страница рассчитана на ЧИСТЫЙ браузер (инкогнито): чужой сеанс здесь
 * единственный, и никакой свой он не затирает. Если человек всё же открыл
 * ссылку в рабочем окне, прежний сеанс будет заменён — предупреждаем об этом
 * ровно в тот момент, когда это уже случилось, потому что до обмена кода
 * узнать, чей сеанс лежит рядом, нельзя.
 */
const ImpersonatePage = () => {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  // React 19 в разработке монтирует дважды, а код одноразовый: второй обмен
  // вернул бы «ссылка уже использована» и показал ошибку на ровном месте.
  const claimed = useRef(false);

  useEffect(() => {
    if (claimed.current) return;
    claimed.current = true;

    const code = window.location.hash.replace(/^#/, "");
    if (!code) {
      setError("В ссылке нет кода. Скопируйте её целиком.");
      return;
    }

    // Из адресной строки код убираем сразу — до сетевого запроса.
    window.history.replaceState(null, "", window.location.pathname);

    (async () => {
      try {
        const response = await fetch(`${API}/api/impersonate/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await response.json();

        if (!response.ok) {
          setError(data.message || "Не удалось открыть сеанс");
          return;
        }

        // Прежний сеанс этой вкладки гасим локально: два набора ключей в одном
        // localStorage — это половина одного человека и половина другого.
        clearSession();
        await storeSession({
          token: data.token,
          expiryDate: data.expiryDate,
          userId: String(data.userId),
        });

        navigate("/dashboard", { replace: true });
      } catch {
        setError("Сервер недоступен. Попробуйте открыть ссылку ещё раз.");
      }
    })();
  }, [navigate]);

  if (!error) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-muted-foreground">
        Открываем сеанс…
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        <AlertMessage variant="danger" message={error} />
        <p className="my-0 text-sm text-muted-foreground">
          Ссылка одноразовая и живёт десять минут. Попросите администратора
          выдать новую.
        </p>
        <Button variant="outline" onClick={() => navigate("/auth")}>
          На страницу входа
        </Button>
      </div>
    </div>
  );
};

export default ImpersonatePage;
