import { useEffect, useState } from "react";
import { Link } from "react-router";

import { DeviceStatusText } from "@/components/app/device-status";
import Spinner from "@/components/app/Spinner";

import { getLocalStorageData } from "../../util/auth";
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
    const { token } = getLocalStorageData();
    let cancelled = false;
    fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/${deviceId}/tickets`,
      { headers: { Authorization: "Bearer " + token } },
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

  if (isLoading) return <Spinner className="tw:min-h-24" />;

  const tickets = data?.tickets || [];
  if (!tickets.length) return null;

  return (
    <div>
      {tickets.map((ticket) => (
        <Link
          key={ticket._id}
          to={`/tickets/${ticket._id}`}
          className="tw:flex tw:items-center tw:gap-3.5 tw:border-t tw:border-border-soft tw:py-2.5 tw:text-foreground tw:no-underline tw:first:border-t-0 tw:hover:text-accent-text"
        >
          <span className="tw:w-16 tw:flex-none tw:font-mono tw:text-sm tw:font-semibold tw:text-muted-foreground">
            №{ticket.num}
          </span>
          <span
            className="tw:min-w-0 tw:flex-1 tw:truncate"
            title={ticket.title}
          >
            {ticket.title}
          </span>
          {ticket.isAuto && (
            <span
              title="Заявка создана мониторингом"
              className="tw:flex-none tw:rounded-md tw:border tw:border-border tw:px-1.5 tw:text-xs tw:font-semibold tw:text-faint"
            >
              авто
            </span>
          )}
          <span className="tw:hidden tw:w-32 tw:flex-none tw:md:block">
            <DeviceStatusText tone={STATE_TONE[ticket.state] || "info"}>
              {ticket.state}
            </DeviceStatusText>
          </span>
          <span className="tw:hidden tw:w-24 tw:flex-none tw:text-sm tw:text-faint tw:sm:block">
            {formatShortDate(ticket.createdAt)}
          </span>
        </Link>
      ))}
      {data.total > tickets.length && (
        <div className="tw:border-t tw:border-border-soft tw:pt-2.5 tw:text-sm tw:text-faint">
          Показаны последние {tickets.length} из {data.total}
        </div>
      )}
    </div>
  );
};

export default TicketsPanel;
