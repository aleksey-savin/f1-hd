import { useContext, useEffect, useState } from "react";

import { Link } from "react-router";
import { RiBookOpenLine } from "react-icons/ri";

import AppBanner from "@/components/app/AppBanner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";
// Срок продления — календарная дата (в БД UTC-полночь), поэтому UTC-форматтер
import { formatCalendarDate } from "../../util/format-date";
import { MODERATION_FILTERS } from "./Filter";
import useModerationSummary from "./useModerationSummary";

/**
 * Баннер уровня оболочки: очереди модерации базы знаний и услуги, которым пора
 * продление.
 *
 * Раньше это были две карточки на странице заявок, свёрстанные как заявка, —
 * они и читались как заявки. Предмет тут чужой: он не про заявки и не про
 * конкретную страницу, поэтому живёт рядом с «Доступна новая версия» —
 * непрозрачной карточкой-«листом» поверх любых обоев, со счётчиками, действием
 * и крестиком.
 *
 * Услуги — не очередь базы знаний (своего deep-link у них нет), поэтому их
 * список раскрывается поповером: «нужно ли идти» отвечает счётчик, «за чем
 * именно» — строки внутри.
 */
const ModerationBanner = ({ onDismiss }) => {
  const { token } = getLocalStorageData();
  const { permissions, isAdmin } = useContext(AuthedUserContext);
  const { counts, isModerator, scanForSecrets } = useModerationSummary();

  const canSeeKnowledgeBase = isAdmin || permissions?.canSeeKnowledgeBase;
  const [services, setServices] = useState([]);

  useEffect(() => {
    if (!canSeeKnowledgeBase) return;
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/knowledge-notes/service-expiry`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (!response.ok) return;
        const data = await response.json();
        if (active) {
          setServices(Array.isArray(data.services) ? data.services : []);
        }
      } catch {
        // Тихо: баннер просто не покажется — это подсказка, а не данные страницы
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [canSeeKnowledgeBase, token]);

  // Очередь секретов — только при включённом сканере: иначе счётчик мог остаться
  // от прошлых сканов и вёл бы в пустую очередь
  const queues = isModerator
    ? MODERATION_FILTERS.filter(
        (queue) =>
          counts[queue.countKey] > 0 &&
          (!queue.needsSecretsScan || scanForSecrets),
      )
    : [];

  if (queues.length === 0 && services.length === 0) return null;

  const overdueServices = services.filter((service) => service.overdue).length;
  const chip =
    "tw:inline-flex tw:h-7 tw:flex-none tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-1.5 tw:rounded-full tw:border tw:border-border tw:bg-transparent tw:px-2.5 tw:text-sm tw:text-muted-foreground tw:no-underline tw:transition-colors tw:hover:bg-accent tw:hover:text-foreground tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50";

  return (
    <AppBanner
      tone="info"
      icon={<RiBookOpenLine />}
      title="База знаний ждёт внимания"
      onDismiss={onDismiss}
      className="tw:mx-auto tw:w-full tw:max-w-7xl tw:mb-6"
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/knowledge-base">Открыть</Link>
        </Button>
      }
    >
      <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        {queues.map((queue) => (
          <Link
            key={queue.mode}
            to={`/knowledge-base?moderation=${queue.mode}`}
            className={chip}
          >
            {queue.label}
            <span className="tw:font-semibold tw:text-foreground tw:tabular-nums">
              {counts[queue.countKey]}
            </span>
          </Link>
        ))}

        {services.length > 0 && (
          <Popover>
            <PopoverTrigger className={chip}>
              Продление услуг
              <span
                className={cn(
                  "tw:font-semibold tw:tabular-nums",
                  overdueServices > 0
                    ? "tw:text-destructive"
                    : "tw:text-foreground",
                )}
              >
                {services.length}
              </span>
            </PopoverTrigger>
            <PopoverContent align="start" className="tw:w-80 tw:p-2">
              <ul className="tw:m-0 tw:list-none tw:space-y-px tw:p-0">
                {services.map((service) => (
                  <li key={service.service}>
                    <Link
                      to={`/knowledge-base/${service.noteId}`}
                      className="tw:flex tw:items-baseline tw:gap-2 tw:rounded-md tw:px-2 tw:py-1.5 tw:text-sm tw:text-foreground tw:no-underline tw:hover:bg-accent"
                    >
                      <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:font-medium">
                        {service.service}
                      </span>
                      <span
                        className={cn(
                          "tw:flex-none tw:text-xs tw:tabular-nums",
                          service.overdue
                            ? "tw:text-destructive"
                            : "tw:text-muted-foreground",
                        )}
                      >
                        до {formatCalendarDate(service.expiresAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        )}
      </span>
    </AppBanner>
  );
};

export default ModerationBanner;
