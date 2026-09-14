import { useEffect, useRef, useState } from "react";
import { useFetcher, useFetchers, useRevalidator } from "react-router";

import { RiTelegramLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import SettingRow from "@/components/app/SettingRow";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import useToastStore from "../../../store/toast-store";

// Секция «Интеграции»: Telegram-бот. Статус — цветной текст с точкой (язык
// статус-борда), не бейдж. «Подключить» ведёт в бота с deep-link на ОДНОРАЗОВЫЙ
// КОД — привязку подтверждает сам бот (/start → /api/tg/auth), поэтому после
// клика страница поллит loader ревалидацией, пока статус не станет «Подключён».
// «Отключить» — router-action (intent integrations-update очищает chatId).
//
// В ссылке был `user._id`, и это была дыра: идентификатор не секрет (он приезжает
// в браузер в каждой заявке), поэтому `/start <чужой id>` привязывал чужую
// учётку к своему телеграму. Теперь код берётся с сервера на каждый клик, живёт
// пятнадцать минут и обменивается один раз — см. backend/services/telegramPairing.
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

const Integrations = ({ user, botUsername }) => {
  const fetcher = useFetcher();
  const fetchers = useFetchers();
  const revalidator = useRevalidator();
  const { showToast } = useToastStore();

  const connected = !!user.telegramBot?.isActive;
  const [awaitingLink, setAwaitingLink] = useState(false);
  const [pairing, setPairing] = useState(false);

  /**
   * Код берётся на КАЖДЫЙ клик и живёт пятнадцать минут: держать его заранее
   * негде — выписанный код это живой ключ к учётной записи, и выписывать его
   * при каждом открытии страницы значило бы плодить ключи, которых никто не
   * просил.
   */
  const connect = async () => {
    if (pairing || !botUsername) return;
    setPairing(true);

    // Вкладку открываем СИНХРОННО, до запроса: открытую после `await` браузер
    // уже не считает следствием клика и блокирует как всплывающую.
    const target = window.open("", "_blank");

    try {
      const { code } = await api("/api/me/telegram/pairing-code", {
        method: "POST",
      });
      // Имя бота приходит с сервера (его сообщает сам tg-service), а не
      // зашивается в сборку: образ фронта одинаков для всех установок.
      const url = `https://t.me/${botUsername}?start=${code}`;

      if (target) {
        // Обратную ссылку рвём ДО перехода, пока вкладка ещё about:blank и
        // своя: с живым `opener` открытая страница может переписать нашу
        // вкладку. У прежней разметки это делал `rel="noreferrer"`.
        target.opener = null;
        target.location = url;
      } else {
        // Блокировщик всплывающих окон: уходим текущей вкладкой. Телеграм
        // откроется приложением, а вернувшись, человек увидит уже «Подключён».
        window.location.href = url;
      }
      setAwaitingLink(true);
    } catch (error) {
      target?.close();
      showToast("danger", error?.message || "Не удалось подготовить привязку");
    } finally {
      setPairing(false);
    }
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) {
      showToast(
        fetcher.data.error ? "danger" : "success",
        fetcher.data.message,
      );
    }
  }, [fetcher.state, fetcher.data]);

  // Ревалидировать можно только когда все fetcher'ы страницы idle — иначе
  // роутер теряет их результаты («Did not find corresponding fetcher result»)
  const fetchersIdle =
    fetchers.every((f) => f.state === "idle") && fetcher.state === "idle";
  const canRevalidateRef = useRef(fetchersIdle);
  canRevalidateRef.current = fetchersIdle && revalidator.state === "idle";
  const revalidateRef = useRef(revalidator.revalidate);
  revalidateRef.current = revalidator.revalidate;

  useEffect(() => {
    if (!awaitingLink || connected) return;

    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setAwaitingLink(false);
        return;
      }
      if (canRevalidateRef.current) {
        revalidateRef.current();
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [awaitingLink, connected]);

  // Бот подтвердил привязку, пока мы ждали — сообщаем результат
  useEffect(() => {
    if (awaitingLink && connected) {
      setAwaitingLink(false);
      showToast("success", "Telegram-бот подключён");
    }
  }, [connected, awaitingLink]);

  const status = (
    <>
      <span
        aria-hidden
        className={cn(
          "me-1.5 mb-px inline-block size-1.5 rounded-full",
          connected ? "bg-primary" : awaitingLink ? "bg-warning" : "bg-faint",
        )}
      />
      <span
        className={cn(
          "font-medium",
          connected ? "text-accent-text" : "text-muted-foreground",
        )}
      >
        {connected
          ? "Подключён"
          : awaitingLink
            ? "Ожидает подтверждения"
            : "Не подключён"}
      </span>
      {connected
        ? " · заявки и статусы приходят в личный чат"
        : awaitingLink
          ? " · откройте чат с ботом и нажмите Start — статус обновится сам"
          : botUsername
            ? " · уведомления в Telegram не отправляются"
            : " · Telegram-бот на этом сервере не настроен"}
    </>
  );

  return (
    <SettingRow
      leading={<RiTelegramLine size={18} aria-hidden />}
      title="Telegram-бот"
      hint={status}
    >
      {connected ? (
        <fetcher.Form method="post">
          <input type="hidden" name="id" value={user._id} />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            name="intent"
            value="integrations-update"
            disabled={fetcher.state !== "idle"}
          >
            Отключить
          </Button>
        </fetcher.Form>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={connect}
          disabled={pairing || !botUsername}
        >
          Подключить
        </Button>
      )}
    </SettingRow>
  );
};

export default Integrations;
