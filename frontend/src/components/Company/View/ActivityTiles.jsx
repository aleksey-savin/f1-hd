import { useRef, useState } from "react";
import { RiArrowLeftSLine, RiArrowRightSLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/app/Panel";
import StatTile, { StatTileDelta } from "@/components/app/StatTile";

import { getLocalStorageData } from "../../../util/auth";
import { msToHMS } from "../../../util/time-helpers";

// «Активность» — статборд-плитки (app/StatTile) вместо легаси-карточек
// статистики. Первые две (заявки и время работ) листаются по месяцам пейджером
// в заголовке секции: прошлые месяцы догружаются с ?month=YYYY-MM и кэшируются
// на время жизни карточки. Пользователи (за 90 дней) и канал (за год) от месяца
// не зависят. Нет данных (сбой первичного запроса) — секции нет, пункта в
// рейле тоже.
const API = import.meta.env.VITE_API_ADDRESS;

// Подпись пейджера — именительный падеж («июль 2026»)
const MONTHS_RU = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

const keyOf = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const shiftKey = (key, delta) => {
  const [year, month] = key.split("-").map(Number);
  return keyOf(new Date(year, month - 1 + delta, 1));
};

const labelOf = (key) => {
  const [year, month] = key.split("-").map(Number);
  return `${MONTHS_RU[month - 1]} ${year}`;
};

const round1 = (n) => Math.round(n * 10) / 10;

const ActivityTiles = ({ company, stats, id }) => {
  const currentKey = keyOf(new Date());
  const [monthKey, setMonthKey] = useState(currentKey);
  const [busy, setBusy] = useState(false);
  // Кэш загруженных месяцев + защита от гонок (быстрое листание) + последний
  // успешно показанный месяц для отката при сбое сети
  const cacheRef = useRef(new Map());
  const seqRef = useRef(0);
  const lastGoodRef = useRef(currentKey);

  if (!stats) return null;

  const currentSlice = { tickets: stats.tickets, time: stats.time };
  const shown =
    monthKey === currentKey
      ? currentSlice
      : cacheRef.current.get(monthKey) ||
        cacheRef.current.get(lastGoodRef.current) ||
        currentSlice;

  // Листать назад дальше месяца создания компании нет смысла
  const minKey = company?.createdAt
    ? keyOf(new Date(company.createdAt))
    : null;
  const prevKey = shiftKey(monthKey, -1);
  const canBack = !minKey || prevKey >= minKey;
  const canForward = monthKey < currentKey;

  const switchMonth = (key) => {
    setMonthKey(key);
    if (key === currentKey || cacheRef.current.has(key)) {
      lastGoodRef.current = key;
      return;
    }
    const seq = ++seqRef.current;
    setBusy(true);
    const { token } = getLocalStorageData();
    fetch(`${API}/api/companies/${company._id}/stats?month=${key}`, {
      headers: { Authorization: "Bearer " + token },
    })
      .then((response) => {
        if (!response.ok) throw new Error(`stats ${response.status}`);
        return response.json();
      })
      .then((data) => {
        cacheRef.current.set(key, { tickets: data.tickets, time: data.time });
        if (seqRef.current !== seq) return;
        lastGoodRef.current = key;
        // ре-рендер от setBusy прочитает свежий кэш по monthKey
        setBusy(false);
      })
      .catch((error) => {
        // Сеть моргнула — тихо остаёмся на последнем загруженном месяце
        console.warn("Статистика месяца не загрузилась:", error);
        if (seqRef.current !== seq) return;
        setBusy(false);
        setMonthKey(lastGoodRef.current);
      });
  };

  const { users, channels } = stats;
  const activePct = users.total ? (users.active / users.total) * 100 : 0;

  return (
    <>
      <Eyebrow
        id={id}
        action={
          <span className="tw:flex tw:items-center tw:gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Предыдущий месяц"
              title="Предыдущий месяц"
              disabled={!canBack}
              onClick={() => switchMonth(prevKey)}
              className="tw:text-muted-foreground"
            >
              <RiArrowLeftSLine />
            </Button>
            <span className="tw:min-w-28 tw:text-center tw:text-sm tw:font-medium tw:text-muted-foreground tw:tabular-nums">
              {labelOf(monthKey)}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Следующий месяц"
              title="Следующий месяц"
              disabled={!canForward}
              onClick={() => switchMonth(shiftKey(monthKey, 1))}
              className="tw:text-muted-foreground"
            >
              <RiArrowRightSLine />
            </Button>
          </span>
        }
      >
        Активность
      </Eyebrow>
      <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:xl:grid-cols-4 tw:xl:gap-4">
        <StatTile
          label="Заявки"
          busy={busy}
          value={shown.tickets.current}
          delta={
            <StatTileDelta
              direction={shown.tickets.direction}
              percentage={shown.tickets.percentage}
              hint={`к среднему ${round1(shown.tickets.baselineAvg)}/мес`}
            />
          }
        />

        <StatTile
          label="Время работ"
          busy={busy}
          value={msToHMS(shown.time.current)}
          delta={
            <StatTileDelta
              direction={shown.time.direction}
              percentage={shown.time.percentage}
              hint={`к среднему ${msToHMS(shown.time.baselineAvg)}/мес`}
            />
          }
          footer={
            <>
              Выезды {msToHMS(shown.time.onSite.current)} · Удалённо{" "}
              {msToHMS(shown.time.remote.current)}
            </>
          }
        />

        <StatTile
          label="Активные пользователи"
          value={
            users.total === 0 ? undefined : (
              <>
                {users.active}{" "}
                <span className="tw:text-base tw:font-semibold tw:text-muted-foreground">
                  / {users.total}
                </span>
              </>
            )
          }
          footer={users.total === 0 ? undefined : "за последние 90 дней"}
        >
          {users.total === 0 ? (
            <div className="tw:mt-2 tw:text-sm tw:text-muted-foreground">
              Нет пользователей
            </div>
          ) : (
            <div
              role="img"
              aria-label={`Активны ${users.active} из ${users.total}`}
              className="tw:mt-2.5 tw:h-1.5 tw:overflow-hidden tw:rounded-full tw:bg-border-soft"
            >
              <div
                className="tw:h-full tw:rounded-full"
                style={{
                  width: `${activePct}%`,
                  background: "var(--ws-st-office)",
                }}
              />
            </div>
          )}
        </StatTile>

        <StatTile label="Основной канал">
          {!channels.primary || channels.total === 0 ? (
            <div className="tw:mt-2 tw:text-sm tw:text-muted-foreground">
              Нет заявок за последний год
            </div>
          ) : (
            <>
              <div className="tw:mt-2 tw:text-2xl tw:leading-tight tw:font-bold tw:tracking-tight">
                {channels.primary.source}
              </div>
              <div className="tw:mt-1.5 tw:text-sm tw:text-faint tw:tabular-nums">
                <b className="tw:font-semibold tw:text-foreground">
                  {channels.primary.percentage}%
                </b>{" "}
                обращений за год
              </div>
              {channels.breakdown.length > 1 && (
                <div className="tw:mt-1.5 tw:text-xs tw:text-faint tw:tabular-nums">
                  {channels.breakdown
                    .filter(
                      (channel) => channel.source !== channels.primary.source,
                    )
                    .slice(0, 3)
                    .map((channel) => `${channel.source} ${channel.percentage}%`)
                    .join(" · ")}
                </div>
              )}
            </>
          )}
        </StatTile>
      </div>
    </>
  );
};

export default ActivityTiles;
