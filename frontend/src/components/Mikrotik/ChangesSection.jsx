import { useEffect, useState } from "react";
import { Link } from "react-router";

import { DeviceStatusText } from "@/components/app/device-status";
import { useCrumbFrom } from "@/components/app/Crumbs";
import { Eyebrow, Panel } from "@/components/app/Panel";
import Spinner from "@/components/app/Spinner";
import useLiveTopic from "@/hooks/use-live-topic";
import { fetchRecordChanges } from "@/store/mikrotik-changes";
import { displayTimeZone } from "@/util/format-date";
import {
  STATUS_TEXT_TONE,
  commandsCount,
  expiredAfter,
  listSummary,
  listWhen,
  statusTone,
} from "@/util/mikrotik-changes";

const OPEN = ["awaiting_requester", "awaiting_responsible"];

// Мета строки: «кто через какого агента, когда. N команд. Решает …». У
// сокращённого вида (нет прав на подробности) её нет: видны только заголовок
// и статус, как в макете.
const rowMeta = (change, timeZone) => {
  if (!change.commands) return null;
  const when = listWhen(change.createdAt, { timeZone });
  const who = change.requestedBy?.name;
  const via = change.requestedVia?.keyName;
  const head = [who, via && `через ${via}`].filter(Boolean).join(" ");
  const parts = [
    `${head ? `${head}, ` : ""}${when}`,
    commandsCount(change.commands.length),
  ];
  if (OPEN.includes(change.status)) {
    const current = change.steps?.find((step) => !step.decision);
    if (current?.user?.name) parts.push(`Решает ${current.user.name}`);
  }
  if (change.status === "expired") parts.push(expiredAfter(change));
  return { text: parts.join(". "), risky: change.risk === "high" };
};

// Раздел «Изменения» страницы записи: запросы ИИ-агентов по этому устройству,
// новые сверху; строка ведёт на страницу запроса. Список читается при показе и
// по пульсу темы `mikrotikChanges` — своего таймера нет.
const ChangesSection = ({ recordId, deviceName }) => {
  const [changes, setChanges] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // Первая загрузка не удалась: «запросов нет» утверждать нельзя
  const [failed, setFailed] = useState(false);
  // Крошка страницы запроса вернёт сюда
  const fromState = useCrumbFrom(deviceName);
  const timeZone = displayTimeZone();

  const load = async () => {
    try {
      setChanges(await fetchRecordChanges(recordId));
      setFailed(false);
    } catch (error) {
      // Тихое обновление не затирает уже показанный список
      console.warn("Mikrotik changes: list failed", error);
      setFailed(true);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    load();
  }, [recordId]);

  useLiveTopic("mikrotikChanges", load);

  return (
    <>
      <Eyebrow
        id="changes"
        action={
          changes.length > 0 ? (
            <span className="text-xs font-semibold tracking-wider text-faint uppercase">
              {listSummary(changes)}
            </span>
          ) : null
        }
      >
        Изменения
      </Eyebrow>
      <Panel>
        {!loaded ? (
          <Spinner className="min-h-0 py-6" size={28} />
        ) : failed && changes.length === 0 ? (
          <div className="text-sm text-destructive">
            Не удалось загрузить запросы на изменение.
          </div>
        ) : changes.length === 0 ? (
          <div className="text-sm text-faint">
            Запросов на изменение пока нет. Они появляются, когда ИИ-агент
            предлагает изменение конфигурации этого устройства.
          </div>
        ) : (
          <div>
            {changes.map((change) => {
              const meta = rowMeta(change, timeZone);
              return (
                <Link
                  key={change._id}
                  to={`/devices/mikrotik/changes/${change._id}`}
                  state={fromState}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3.5 gap-y-0.5 border-t border-border-soft py-2.5 text-inherit no-underline first:border-t-0 first:pt-0 last:pb-0 hover:text-inherit"
                >
                  <span className="min-w-0 text-base font-medium wrap-anywhere">
                    № {change.number}. {change.title}
                  </span>
                  <DeviceStatusText
                    tone={STATUS_TEXT_TONE[statusTone(change.status)]}
                  >
                    {change.statusLabel}
                  </DeviceStatusText>
                  {meta && (
                    <span className="col-span-full text-sm text-muted-foreground">
                      {meta.text}
                      {meta.risky && (
                        <>
                          {". "}
                          <b className="font-semibold text-warning-text">
                            Может оборвать связь с устройством
                          </b>
                        </>
                      )}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
};

export default ChangesSection;
