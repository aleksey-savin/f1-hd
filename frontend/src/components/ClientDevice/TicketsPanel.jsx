import { useEffect, useState } from "react";
import { Link } from "react-router";

import { DeviceStatusText } from "@/components/app/device-status";
import Spinner from "@/components/app/Spinner";
import useLiveTopic from "@/hooks/use-live-topic";

import { formatShortDate } from "../../util/format-date";

// Состояние заявки → тон статус-текста (тот же язык, что у учётных статусов
// техники). Соответствие взято из строки списка заявок.
const STATE_TONE = {
  Новая: "warn",
  "Не в работе": "warn",
  "В работе": "info",
  "На согласовании": "info",
  Выполнена: "ok",
  Закрыта: "off",
};

/**
 * История устройства: заявки, ссылающиеся на него. Ссылку сейчас ставит только
 * автоматика мониторинга (эпизоды недоступности), поэтому такие строки помечены
 * «авто» — по ним читается история простоев. Ручное создание заявки устройство
 * пока не выбирает, и список честно короткий.
 *
 * Секция сама решает, показываться ли: пустую историю не рисуем — заголовок без
 * содержимого не информация.
 */
const TicketsPanel = ({ deviceId, onEmpty }) => {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/${deviceId}/tickets`,
      {},
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setIsLoading(false);
        if (!result?.tickets?.length) onEmpty?.();
      })
      .catch(() => {
        if (cancelled) return;
        setIsLoading(false);
        onEmpty?.();
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, onEmpty]);

  // Эпизод недоступности открывает и закрывает заявку, пока карточка открыта —
  // тихо перечитываем по пульсу (docs/live-updates.md), не чаще раза в 30 с
  useLiveTopic(
    "tickets",
    async () => {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/${deviceId}/tickets`,
      );
      if (response.ok) setData(await response.json());
    },
    { enabled: !isLoading, minIntervalMs: 30_000 },
  );

  if (isLoading) return <Spinner className="min-h-24" />;

  const tickets = data?.tickets || [];
  if (!tickets.length) return null;

  return (
    <div>
      {tickets.map((ticket) => (
        <Link
          key={ticket._id}
          // В адресе заявки её НОМЕР, а не идентификатор: маршрут объявлен как
          // `:ticketNum`, и контроллер ищет findOne({ num }). С _id ссылка
          // отдавала 404 всегда.
          to={`/tickets/${ticket.num}`}
          className="flex items-center gap-3.5 border-t border-border-soft py-2.5 text-foreground no-underline first:border-t-0 hover:text-accent-text"
        >
          <span className="w-16 flex-none font-mono text-sm font-semibold text-muted-foreground">
            {ticket.num}
          </span>
          <span className="min-w-0 flex-1 truncate" title={ticket.title}>
            {ticket.title}
          </span>
          {ticket.isAuto && (
            <span
              title="Заявка создана мониторингом"
              className="flex-none rounded-md border border-border px-1.5 text-xs font-semibold text-faint"
            >
              авто
            </span>
          )}
          <span className="hidden w-32 flex-none md:block">
            <DeviceStatusText tone={STATE_TONE[ticket.state] || "info"}>
              {ticket.state}
            </DeviceStatusText>
          </span>
          <span className="hidden w-24 flex-none text-sm text-faint sm:block">
            {formatShortDate(ticket.createdAt)}
          </span>
        </Link>
      ))}
      {data.total > tickets.length && (
        <div className="border-t border-border-soft pt-2.5 text-sm text-faint">
          Показаны последние {tickets.length} из {data.total}
        </div>
      )}
    </div>
  );
};

export default TicketsPanel;
