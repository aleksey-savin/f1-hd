import { ABSENCE_TYPES } from "@/util/absence-types";
import { ON_SHIFT_STATUS_CODES, WORK_STATUSES } from "@/util/work-statuses";

import { OFF_COLOR, PLANNED_COLOR } from "./calendar";

const Dot = ({ color, hollow }: { color: string; hollow?: boolean }) => (
  <span
    className={hollow ? "tw:block tw:size-2.5 tw:rounded-full tw:border tw:border-dashed" : "tw:block tw:size-2.5 tw:rounded-full"}
    style={hollow ? { borderColor: color } : { background: color }}
  />
);

const Item = ({ children }: { children: React.ReactNode }) => (
  <span className="tw:inline-flex tw:items-center tw:gap-2">{children}</span>
);

/**
 * Словарь точки. Цвета не выдуманы для календаря — это те же токены, которыми
 * светится бар присутствия, поэтому объяснять их дважды не приходится.
 */
const Legend = () => {
  // «На смене» — из каталога, а не списком кодов: новый статус не потеряется
  const live = WORK_STATUSES.filter((status) =>
    ON_SHIFT_STATUS_CODES.includes(status.code),
  );
  const vacation = ABSENCE_TYPES.find((type) => type.code === "vacation");

  return (
    <div className="tw:flex tw:flex-wrap tw:gap-x-5 tw:gap-y-2.5 tw:px-1 tw:pt-3.5 tw:text-xs tw:text-muted-foreground">
      <Item>
        <Dot color={PLANNED_COLOR} />
        по графику работает
      </Item>
      {live.map((status) => (
        <Item key={status.code}>
          <Dot color={status.color} />
          {status.label} <span className="tw:text-faint">(сегодня)</span>
        </Item>
      ))}
      {ABSENCE_TYPES.filter((type) => type.reducesNorm)
        .slice(0, 3)
        .map((type) => (
          <Item key={type.code}>
            <Dot color={type.color} />
            {type.label.toLowerCase()}
          </Item>
        ))}
      <Item>
        <Dot color={OFF_COLOR} />
        не на работе
      </Item>
      {vacation && (
        <Item>
          <Dot color={vacation.color} hollow />
          запрос на согласовании
        </Item>
      )}
    </div>
  );
};

export default Legend;
