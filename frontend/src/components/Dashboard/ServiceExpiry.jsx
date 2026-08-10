import { useEffect, useState } from "react";
import { Link } from "react-router";

import { Eyebrow, Panel } from "@/components/app/Panel";
import { businessDaysAgo } from "../../util/format-date";

/**
 * «Сроки на исходе» — домены, почта и подписки, у которых кончается оплата.
 *
 * Данные собирает ночной сканер по markdown-таблицам в заметках базы знаний
 * (`services/serviceExpiryScanner`), поэтому у каждой строки есть исходная
 * заметка — туда и ведёт клик, там же лежат реквизиты продления.
 *
 * Кому что видно, решает ручка: сотруднику — по правилам базы знаний,
 * ответственному со стороны клиента — только его компания. Блока не будет
 * вовсе, если в настройках выключено отслеживание сроков.
 */

// «через 21 день» / «истёк 4 мес назад» — срок словами, знак несёт цвет.
const expiryText = (expiresAt) => {
  const days = businessDaysAgo(expiresAt);
  if (days === null) return "";
  if (days === 0) return "сегодня";
  if (days > 0) {
    const months = Math.floor(days / 30);
    if (days === 1) return "истёк вчера";
    if (months >= 2) return `истёк ${months} мес назад`;
    return `истёк ${days} дн назад`;
  }
  const left = -days;
  if (left === 1) return "завтра";
  if (left < 5) return `через ${left} дня`;
  return `через ${left} дней`;
};

const ServiceExpiry = ({ showCompany = false }) => {
  const [services, setServices] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/knowledge-notes/service-expiry`,
        );
        if (!response.ok) throw new Error(`service-expiry ${response.status}`);
        const data = await response.json();
        setServices(data.services ?? []);
      } catch (error) {
        console.error("Не удалось загрузить сроки услуг:", error);
      }
    };
    load();
  }, []);

  if (services.length === 0) return null;

  return (
    <section>
      <Eyebrow count={services.length}>Сроки на исходе</Eyebrow>
      <Panel>
        <div className="-mx-5 -my-5">
          {services.map((service) => {
            const overdue = service.overdue;
            return (
              <Link
                key={`${service.noteId}-${service.service}`}
                to={`/knowledge-base/${service.noteId}`}
                className="flex items-center gap-3 border-b border-border-soft px-5 py-2.5 text-foreground no-underline transition-colors last:border-b-0 hover:bg-accent/60 hover:text-foreground"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {service.service}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {[
                      service.noteTitle,
                      showCompany
                        ? (service.companies ?? [])
                            .map((company) => company.alias)
                            .join(", ")
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span
                  className={
                    "flex-none text-sm tabular-nums " +
                    (overdue ? "text-destructive" : "text-warning")
                  }
                >
                  {expiryText(service.expiresAt)}
                </span>
              </Link>
            );
          })}
        </div>
      </Panel>
    </section>
  );
};

export default ServiceExpiry;
