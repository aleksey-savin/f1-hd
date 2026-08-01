import { ABSENCE_TYPES } from "@/util/absence-types";
import { ON_SHIFT_STATUS_CODES, WORK_STATUSES } from "@/util/work-statuses";

import { OFF_COLOR, PLANNED_COLOR } from "./calendar";

const Dot = ({ color, hollow }: { color: string; hollow?: boolean }) => (
  <span
    className={
      hollow
        ? "block size-2.5 rounded-full border border-dashed"
        : "block size-2.5 rounded-full"
    }
    style={hollow ? { borderColor: color } : { background: color }}
  />
);

const Item = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-2">{children}</span>
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
    <div className="flex flex-wrap gap-x-5 gap-y-2.5 px-1 pt-3.5 text-xs text-muted-foreground">
      <Item>
        <Dot color={PLANNED_COLOR} />
        по графику работает
      </Item>
      {live.map((status) => (
        <Item key={status.code}>
          <Dot color={status.color} />
          {status.label} <span className="text-faint">(сегодня)</span>
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
