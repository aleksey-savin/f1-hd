import { useCallback, useContext, useEffect, useState } from "react";
import { Link } from "react-router";

import { useCrumbFrom } from "@/components/app/Crumbs";
import { DeviceStatusText } from "@/components/app/device-status";
import { Eyebrow, Panel } from "@/components/app/Panel";
import useLiveTopic from "@/hooks/use-live-topic";
import { fetchAwaitingMe } from "@/store/mikrotik-changes";
import useInitialPrefsStore from "@/store/prefs";
import { AuthedUserContext } from "@/store/authed-user-context";
import {
  STATUS_TEXT_TONE,
  commandsCount,
  expiryLabel,
  statusTone,
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
              [change.device?.name, change.device?.company]
                .filter(Boolean)
                .join(", "),
              change.requestedBy?.name
                ? `Просит ${change.requestedBy.name}`
                : null,
              change.commands?.length
                ? commandsCount(change.commands.length)
                : null,
            ]
              .filter(Boolean)
              .join(". ");
            return (
              <Link
                key={change._id}
                to={`/devices/mikrotik/changes/${change._id}`}
                state={fromState}
                className="flex items-start gap-3 border-b border-border-soft px-4 py-2.5 text-foreground no-underline transition-colors last:border-b-0 hover:bg-accent/60 hover:text-foreground md:px-5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {change.title}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {meta}
                    {change.risk === "high" && (
                      <>
                        {meta ? ". " : ""}
                        <span className="font-semibold text-warning-text">
                          Может оборвать связь с устройством
                        </span>
                      </>
                    )}
                  </span>
                </span>
                <DeviceStatusText
                  tone={STATUS_TEXT_TONE[statusTone(change.status)]}
                  className="mt-0.5 text-sm font-normal tabular-nums"
                >
                  {expiryLabel(change.expiresAt, { timeZone })}
                </DeviceStatusText>
              </Link>
            );
          })}
        </div>
      </Panel>
    </section>
  );
};

export default AgentChanges;
