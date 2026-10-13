import { useCallback, useContext, useEffect, useState } from "react";
import { Link } from "react-router";

import { RiAlertLine } from "react-icons/ri";

import { useCrumbFrom } from "@/components/app/Crumbs";
import { DeviceStatusText } from "@/components/app/device-status";
import { Eyebrow, Panel } from "@/components/app/Panel";
import useLiveTopic from "@/hooks/use-live-topic";
import { fetchAwaitingMe } from "@/store/mikrotik-changes";
import useInitialPrefsStore from "@/store/prefs";
import { AuthedUserContext } from "@/store/authed-user-context";
import {
  RISK_HEADLINE,
  commandsCount,
  expiresSoon,
  expiryLabel,
} from "@/util/mikrotik-changes";
import { displayTimeZone } from "@/util/format-date";

/**
 * «Запросы ИИ-агентов ждут вашего решения» — запросы на изменение Mikrotik,
 * где очередь сейчас за вошедшим (макет 10.10, «Главная и колокольчик»).
 *
 * Решили или запрос истёк — строка уходит, пустой блок не рисуется (раскладка
 * главной держится на этом: см. комментарий в pages/Dashboard.jsx). Модуль
 * Mikrotik выключен или аккаунт клиентский — запроса нет вовсе. Обновляется по
 * теме пульса `mikrotikChanges` (docs/live-updates.md), своих таймеров нет.
 *
 * Строка — три разных факта тремя строками: что просят (тема, не длиннее двух
 * строк), где и кто (мета), чем грозит (риск со значком). Одним предложением
 * через точку они сливались, а жирный риск рвался переносом посреди фразы.
 * Срок приглушён, пока далеко: оранжевым он спорил с риском, хотя «до завтра»
 * ничего не требует. Тон берёт только срок на исходе (`expiresSoon`).
 */
const AgentChanges = () => {
  const fromState = useCrumbFrom("Главная");
  const { isEndUser } = useContext(AuthedUserContext);
  const mikrotikOn = useInitialPrefsStore(
    (state) => !!state.modules?.mikrotik?.isActive,
  );
  const enabled = mikrotikOn && !isEndUser;
  const [items, setItems] = useState([]);

  const load = useCallback(async () => {
    try {
      setItems(await fetchAwaitingMe());
    } catch (error) {
      console.error("Не удалось загрузить запросы ИИ-агентов:", error);
      // Старые строки не оставляем: запрос могли решить в другом месте
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  useLiveTopic("mikrotikChanges", load, { enabled });

  if (!enabled || items.length === 0) return null;

  const timeZone = displayTimeZone();

  return (
    <section>
      <Eyebrow count={items.length}>
        Запросы ИИ-агентов ждут вашего решения
      </Eyebrow>
      <Panel>
        <div className="-mx-4 -my-4 md:-mx-5 md:-my-5">
          {items.map((change) => {
            const meta = [
              change.device?.company,
              change.requestedBy?.name
                ? `просит ${change.requestedBy.name}`
                : null,
              change.commands?.length
                ? commandsCount(change.commands.length)
                : null,
            ].filter(Boolean);
            const deadline = expiryLabel(change.expiresAt, { timeZone });
            return (
              <Link
                key={change._id}
                to={`/devices/mikrotik/changes/${change._id}`}
                state={fromState}
                className="grid grid-cols-1 gap-x-4 gap-y-0.5 border-b border-border-soft px-4 py-3 text-foreground no-underline transition-colors last:border-b-0 hover:bg-accent/60 hover:text-foreground md:grid-cols-[minmax(0,1fr)_auto] md:px-5"
              >
                <span
                  title={change.title}
                  className="line-clamp-3 min-w-0 text-sm font-medium text-pretty md:line-clamp-2"
                >
                  {change.title}
                </span>
                {/* телефон: срок строкой над темой, как номер у строки заявки */}
                {deadline &&
                  (expiresSoon(change.expiresAt) ? (
                    <DeviceStatusText
                      tone="warn"
                      className="tabular-nums max-md:order-first md:text-sm md:font-normal"
                    >
                      {deadline}
                    </DeviceStatusText>
                  ) : (
                    <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums max-md:order-first md:text-sm">
                      {deadline}
                    </span>
                  ))}
                {(change.device?.name || meta.length > 0) && (
                  <span className="min-w-0 text-sm text-muted-foreground md:col-start-1 md:truncate">
                    {change.device?.name && (
                      <span className="text-foreground">
                        {change.device.name}
                      </span>
                    )}
                    {change.device?.name && meta.length > 0 && " · "}
                    {meta.join(" · ")}
                  </span>
                )}
                {change.risk === "high" && (
                  <span className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-warning-text md:col-start-1">
                    <RiAlertLine aria-hidden className="flex-none" />
                    {RISK_HEADLINE}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </Panel>
    </section>
  );
};

export default AgentChanges;
