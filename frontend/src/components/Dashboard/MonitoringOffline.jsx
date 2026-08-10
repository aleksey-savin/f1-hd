import { useEffect, useState } from "react";
import { Link } from "react-router";

import { RiAlertLine } from "react-icons/ri";

import { Eyebrow, Panel } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
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
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/inventory/mikrotik-devices/offline`,
        );
        if (!response.ok)
          throw new Error(`mikrotik offline ${response.status}`);
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
          <div className="flex gap-3">
            <span className="flex size-8 flex-none items-center justify-center rounded-lg bg-warning/15 text-warning">
              <RiAlertLine size={16} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">
                Опрос не отвечает с {formatDayMonth(data.since)}
              </div>
              <p className="mt-1 mb-0 text-sm text-muted-foreground">
                Все {data.total} устройств ушли в офлайн одним проходом
                {data.dominantError ? " и с одной ошибкой" : ""}. Похоже на сбой
                опроса, а не на {data.total} аварий.
              </p>
              {data.dominantError && (
                <p className="mt-1 mb-0 font-mono text-xs text-faint">
                  {data.dominantError}
                </p>
              )}
            </div>
            <Button
              asChild
              variant="outline"
              size="xs"
              className="flex-none self-center"
            >
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
            className="text-sm font-medium text-accent-text no-underline"
          >
            Все устройства →
          </Link>
        }
      >
        Мониторинг
      </Eyebrow>
      <Panel>
        <div className="-mx-5 -my-5">
          {data.items.map((item) => {
            // Меньше часа — ещё может само подняться, дольше — уже инцидент.
            const fresh =
              item.offlineSince &&
              Date.now() - new Date(item.offlineSince).getTime() < 3600000;
            return (
              <Link
                key={item._id}
                to={`/devices/mikrotik/records/${item._id}`}
                className="flex items-center gap-3 border-b border-border-soft px-5 py-2.5 text-foreground no-underline transition-colors last:border-b-0 hover:bg-accent/60 hover:text-foreground"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {item.name}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {item.company || "Без компании"}
                  </span>
                </span>
                <span
                  className={
                    "flex-none text-sm whitespace-nowrap tabular-nums " +
                    (fresh ? "text-warning" : "text-destructive")
                  }
                >
                  <span
                    aria-hidden
                    className={
                      "me-1.5 inline-block size-1.5 rounded-full align-middle " +
                      (fresh ? "bg-warning" : "bg-destructive")
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
