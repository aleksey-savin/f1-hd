import { RiMoonLine, RiTimeLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

import useMinuteTick from "../../hooks/use-minute-tick";
import {
  describeClientTimezone,
  tzOffsetMinutes,
} from "../../util/timezone-display";

// Который час у клиента: «Москва · 03:14 · −7 ч». tw-двойник легаси-бэджа
// Company/ClientTimeBadge; расчёт общий — util/timezone-display.
//
// По умолчанию молчит при совпадении с нашим временем — сообщать не о чем.
// `always` для экранов настройки (дерево подразделений, карточка компании):
// там пояс надо видеть и когда он совпадает, иначе не проверить, что задал.
// Ночь у клиента подсвечена: это единственное состояние, где нужен сигнал.
const ClientTime = ({ clientTimezone, always = false, now, className }) => {
  // Расхождение проверяем до тика: в дереве подразделений строка молчит у
  // большинства узлов, и заводить им таймер незачем
  const offset = clientTimezone?.timezone
    ? tzOffsetMinutes(clientTimezone.timezone)
    : null;
  const visible = offset !== null && (always || offset !== 0);

  const tick = useMinuteTick(visible && !now);

  if (!visible) return null;

  const info = describeClientTimezone(clientTimezone, now || tick);

  return (
    <span
      title={info.title}
      className={cn(
        "inline-flex items-center gap-1 text-sm whitespace-nowrap tabular-nums",
        info.isNight ? "text-warning" : "text-muted-foreground",
        className,
      )}
    >
      {info.isNight ? (
        <RiMoonLine aria-hidden className="flex-none" />
      ) : (
        <RiTimeLine aria-hidden className="flex-none" />
      )}
      <span>
        {info.city} · {info.localTime}
        {info.differs && ` · ${info.offsetLabel}`}
      </span>
    </span>
  );
};

export default ClientTime;
