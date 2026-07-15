import { useEffect, useRef, useState } from "react";
import { useFetcher, useFetchers, useRevalidator } from "react-router";

import { RiTelegramLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import SettingRow from "@/components/app/SettingRow";
import { cn } from "@/lib/utils";
import useToastStore from "../../../store/toast-store";

// Секция «Интеграции»: Telegram-бот. Статус — цветной текст с точкой (язык
// статус-борда), не бейдж. «Подключить» ведёт в бота с deep-link на userId —
// привязку подтверждает сам бот (/start → /api/tg/auth), поэтому после клика
// страница поллит loader ревалидацией, пока статус не станет «Подключён».
// «Отключить» — router-action (intent integrations-update очищает chatId).
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

const Integrations = ({ user }) => {
  const fetcher = useFetcher();
  const fetchers = useFetchers();
  const revalidator = useRevalidator();
  const { showToast } = useToastStore();

  const connected = !!user.telegramBot?.isActive;
  const [awaitingLink, setAwaitingLink] = useState(false);

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
          "tw:me-1.5 tw:mb-px tw:inline-block tw:size-1.5 tw:rounded-full",
          connected
            ? "tw:bg-primary"
            : awaitingLink
              ? "tw:bg-warning"
              : "tw:bg-faint",
        )}
      />
      <span
        className={cn(
          "tw:font-medium",
          connected ? "tw:text-accent-text" : "tw:text-muted-foreground",
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
          : " · уведомления в Telegram не отправляются"}
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
        <Button asChild variant="outline" size="sm">
          <a
            href={`https://t.me/${import.meta.env.VITE_TG_BOT_NAME}?start=${user._id}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => setAwaitingLink(true)}
          >
            Подключить
          </a>
        </Button>
      )}
    </SettingRow>
  );
};

export default Integrations;
