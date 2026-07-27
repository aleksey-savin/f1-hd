import Badge from "react-bootstrap/Badge";
import { RiMoonLine, RiTimeLine } from "react-icons/ri";

import useMinuteTick from "../../hooks/use-minute-tick";
import {
  describeClientTimezone,
  tzOffsetMinutes,
} from "../../util/timezone-display";

// «🌙 Москва · 03:14 · −7 ч» рядом с компанией заявки. Легаси-представление
// (bootstrap) для немигрированных экранов — карточка и список заявок;
// tw-двойник — components/app/ClientTime.
//
// Молчит, когда время у клиента совпадает с нашим: бэдж на каждой заявке
// перестал бы что-либо значить.
//
// `now` — общий тик для списков (иначе на каждую строку заведётся свой таймер).
const ClientTimeBadge = ({ clientTimezone, now, className = "" }) => {
  // Расхождение проверяем до тика: в списке заявок бэдж молчит у большинства
  // строк, и заводить им таймер незачем
  const offset = clientTimezone?.timezone
    ? tzOffsetMinutes(clientTimezone.timezone)
    : null;
  const differs = offset !== null && offset !== 0;

  const tick = useMinuteTick(differs && !now);

  if (!differs) return null;

  const info = describeClientTimezone(clientTimezone, now || tick);

  return (
    <Badge
      // На жёлтом фоне текст обязан быть тёмным: bootstrap по умолчанию рисует
      // белый, и подпись становится нечитаемой
      bg={info.isNight ? "warning" : "secondary"}
      text={info.isNight ? "dark" : undefined}
      className={`d-inline-flex align-items-center gap-1 fw-normal ${className}`.trim()}
      title={info.title}
    >
      {info.isNight ? <RiMoonLine /> : <RiTimeLine />}
      <span>
        {info.city} · {info.localTime} · {info.offsetLabel}
      </span>
    </Badge>
  );
};

export default ClientTimeBadge;
