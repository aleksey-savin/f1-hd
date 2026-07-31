import { useEffect, useState } from "react";
import { Link } from "react-router";

import { RiAlertLine } from "react-icons/ri";

import { Eyebrow, Panel } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import { getLocalStorageData } from "../../util/auth";
import { formatDayMonth } from "../../util/format-date";

/**
 * «Мониторинг» — устройства Mikrotik, которые сейчас не отвечают.
 *
 * От заявок блок не зависит: переключатель «создавать заявку при
 * недоступности» выключен по умолчанию, и тогда упавший роутер не всплывает
 * нигде, кроме своего раздела. Состояние читается напрямую.
 *
 * Два состояния, и второе важнее. Когда падает сам опрос (протухли доступы,
 * лёг воркер, нет маршрута), офлайн уходит весь парк разом и с одной ошибкой —
 * это ОДНА авария, а не N. Список из N строк в таком случае врёт ровно так же,
 * как «просрочено» у заявок, поэтому бэкенд отдаёт `pollLooksBroken`, а блок
 * сворачивается в строку состояния. Различить их на глаз нельзя, а цена
 * ошибки разная: в первом случае едут к клиенту, во втором чинят у себя.
 */

// «3 ч 12 мин» — сколько молчит. Сутками и больше — днями, минуты там не нужны.
const downtimeText = (since) => {
  if (!since) return "";
  const ms = Date.now() - new Date(since).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч ${minutes % 60} мин`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 день" : `${days} дней`;
};

const MonitoringOffline = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    const load = async () => {
      const { token } = getLocalStorageData();
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/inventory/mikrotik-devices/offline`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (!response.ok) throw new Error(`mikrotik offline ${response.status}`);
        setData(await response.json());
      } catch (error) {
        console.error("Не удалось загрузить состояние мониторинга:", error);
      }
    };
    load();
  }, []);

  if (!data || data.total === 0) return null;

  if (data.pollLooksBroken) {
    return (
      <section>
        <Eyebrow>Мониторинг</Eyebrow>
        <Panel>
          <div className="tw:flex tw:gap-3">
            <span className="tw:flex tw:size-8 tw:flex-none tw:items-center tw:justify-center tw:rounded-lg tw:bg-warning/15 tw:text-warning">
              <RiAlertLine size={16} aria-hidden />
            </span>
            <div className="tw:min-w-0 tw:flex-1">
              <div className="tw:text-sm tw:font-semibold">
                Опрос не отвечает с {formatDayMonth(data.since)}
              </div>
              <p className="tw:mt-1 tw:mb-0 tw:text-sm tw:text-muted-foreground">
                Все {data.total} устройств ушли в офлайн одним проходом
                {data.dominantError ? " и с одной ошибкой" : ""}. Похоже на сбой
                опроса, а не на {data.total} аварий.
              </p>
              {data.dominantError && (
                <p className="tw:mt-1 tw:mb-0 tw:font-mono tw:text-xs tw:text-faint">
                  {data.dominantError}
                </p>
              )}
            </div>
            <Button asChild variant="outline" size="xs" className="tw:flex-none tw:self-center">
              <Link to="/devices/mikrotik">Открыть</Link>
            </Button>
          </div>
        </Panel>
      </section>
    );
  }

  return (
    <section>
      <Eyebrow
        count={data.total}
        action={
          <Link
            to="/devices/mikrotik"
            className="tw:text-sm tw:font-medium tw:text-accent-text tw:no-underline"
          >
            Все устройства →
          </Link>
        }
      >
        Мониторинг
      </Eyebrow>
      <Panel>
        <div className="tw:-mx-5 tw:-my-5">
          {data.items.map((item) => {
            // Меньше часа — ещё может само подняться, дольше — уже инцидент.
            const fresh =
              item.offlineSince &&
              Date.now() - new Date(item.offlineSince).getTime() < 3600000;
            return (
              <Link
                key={item._id}
                to={`/devices/mikrotik/records/${item._id}`}
                className="tw:flex tw:items-center tw:gap-3 tw:border-b tw:border-border-soft tw:px-5 tw:py-2.5 tw:text-foreground tw:no-underline tw:transition-colors tw:last:border-b-0 tw:hover:bg-accent/60 tw:hover:text-foreground"
              >
                <span className="tw:min-w-0 tw:flex-1">
                  <span className="tw:block tw:truncate tw:text-sm tw:font-medium">
                    {item.name}
                  </span>
                  <span className="tw:block tw:truncate tw:text-sm tw:text-muted-foreground">
                    {item.company || "Без компании"}
                  </span>
                </span>
                <span
                  className={
                    "tw:flex-none tw:text-sm tw:whitespace-nowrap tw:tabular-nums " +
                    (fresh ? "tw:text-warning" : "tw:text-destructive")
                  }
                >
                  <span
                    aria-hidden
                    className={
                      "tw:me-1.5 tw:inline-block tw:size-1.5 tw:rounded-full tw:align-middle " +
                      (fresh ? "tw:bg-warning" : "tw:bg-destructive")
                    }
                  />
                  {downtimeText(item.offlineSince)}
                </span>
              </Link>
            );
          })}
        </div>
      </Panel>
    </section>
  );
};

export default MonitoringOffline;
