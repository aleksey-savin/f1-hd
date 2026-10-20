import { useCallback, useContext, useEffect, useState } from "react";
import { Link } from "react-router";

import { RiAlertLine } from "react-icons/ri";

import { useCrumbFrom } from "@/components/app/Crumbs";
import { DeviceStatusText } from "@/components/app/device-status";
import { Eyebrow, Panel } from "@/components/app/Panel";
import useLiveTopic from "@/hooks/use-live-topic";
import { fetchAwaitingMe as fetchInventoryAwaitingMe } from "@/store/inventory-changes";
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
import { opsCount } from "@/util/inventory-changes";

/**
 * «Запросы ИИ-агентов ждут вашего решения» — запросы на изменение Mikrotik и
 * предложения по учёту техники, где очередь сейчас за вошедшим (макеты 10.10 и
 * 20.10, «Главная и колокольчик»). Два списка сливаются и идут по дате
 * создания, новые сверху.
 *
 * Решили или запрос истёк — строка уходит, пустой блок не рисуется (раскладка
 * главной держится на этом: см. комментарий в pages/Dashboard.jsx). Модуль
 * выключен или аккаунт клиентский — источника нет вовсе. Источники грузятся
 * раздельно: сбой одного не роняет строки другого, а его собственные строки
 * обнуляются. Обновляется по темам пульса `mikrotikChanges` и
 * `inventoryChanges` (docs/live-updates.md), своих таймеров нет.
 *
 * Строка Mikrotik — три разных факта тремя строками: что просят (тема, не
 * длиннее двух строк), где и кто (мета), чем грозит (риск со значком). Одним
 * предложением через точку они сливались, а жирный риск рвался переносом
 * посреди фразы. Строка учёта техники — тема, срок и мета «Учёт техники. N
 * операций». Срок приглушён, пока далеко: оранжевым он спорил с риском, хотя
 * «до завтра» ничего не требует. Тон берёт только срок на исходе
 * (`expiresSoon`).
 */
const ROW_CLASS =
  "grid grid-cols-1 gap-x-4 gap-y-0.5 border-b border-border-soft px-4 py-3 text-foreground no-underline transition-colors last:border-b-0 hover:bg-accent/60 hover:text-foreground md:grid-cols-[minmax(0,1fr)_auto] md:px-5";

const AgentChanges = () => {
  const fromState = useCrumbFrom("Главная");
  const { isEndUser } = useContext(AuthedUserContext);
  const mikrotikOn = useInitialPrefsStore(
    (state) => !!state.modules?.mikrotik?.isActive,
  );
  const inventoryOn = useInitialPrefsStore(
    (state) => !!state.modules?.inventory?.isActive,
  );
  const enabled = mikrotikOn && !isEndUser;
  const inventoryEnabled = inventoryOn && !isEndUser;
  const [mikrotikItems, setMikrotikItems] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);

  const load = useCallback(async () => {
    try {
      setMikrotikItems(await fetchAwaitingMe());
    } catch (error) {
      console.error("Не удалось загрузить запросы ИИ-агентов:", error);
      // Старые строки не оставляем: запрос могли решить в другом месте
      setMikrotikItems([]);
    }
  }, []);

  const loadInventory = useCallback(async () => {
    try {
      setInventoryItems(await fetchInventoryAwaitingMe());
    } catch (error) {
      console.error("Не удалось загрузить предложения по технике:", error);
      setInventoryItems([]);
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  useEffect(() => {
    if (inventoryEnabled) loadInventory();
  }, [inventoryEnabled, loadInventory]);

  useLiveTopic("mikrotikChanges", load, { enabled });
  useLiveTopic("inventoryChanges", loadInventory, {
    enabled: inventoryEnabled,
  });

  const items = [
    ...(enabled ? mikrotikItems.map((c) => ({ kind: "mikrotik", c })) : []),
    ...(inventoryEnabled
      ? inventoryItems.map((c) => ({ kind: "inventory", c }))
      : []),
  ].sort((a, b) => new Date(b.c.createdAt) - new Date(a.c.createdAt));

  if (items.length === 0) return null;

  const timeZone = displayTimeZone();

  return (
    <section>
      <Eyebrow count={items.length}>
        Запросы ИИ-агентов ждут вашего решения
      </Eyebrow>
      <Panel>
        <div className="-mx-4 -my-4 md:-mx-5 md:-my-5">
          {items.map(({ kind, c: change }) => {
            const deadline = expiryLabel(change.expiresAt, { timeZone });
            if (kind === "inventory") {
              const soon = expiresSoon(change.expiresAt);
              return (
                <Link
                  key={`inv-${change._id}`}
                  to={`/inventory/changes/${change._id}`}
                  state={fromState}
                  className={ROW_CLASS}
                >
                  <span
                    title={change.title}
                    className="line-clamp-3 min-w-0 text-sm font-medium text-pretty md:line-clamp-2"
                  >
                    {change.title}
                  </span>
                  {deadline &&
                    (soon ? (
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
                  <span className="min-w-0 text-sm text-muted-foreground md:col-start-1 md:truncate">
                    Учёт техники. {opsCount(change.operations?.length ?? 0)}
                  </span>
                </Link>
              );
            }
            const meta = [
              change.device?.company,
              change.requestedBy?.name
                ? `просит ${change.requestedBy.name}`
                : null,
              change.commands?.length
                ? commandsCount(change.commands.length)
                : null,
            ].filter(Boolean);
            return (
              <Link
                key={change._id}
                to={`/devices/mikrotik/changes/${change._id}`}
                state={fromState}
                className={ROW_CLASS}
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
