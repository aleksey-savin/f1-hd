import { useState } from "react";
import {
  addMonths,
  endOfMonth,
  endOfQuarter,
  format,
  parseISO,
  startOfMonth,
  startOfQuarter,
  subDays,
  subMonths,
} from "date-fns";

import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";

import { FaAngleLeft, FaAngleRight } from "react-icons/fa";

import DateRangePicker from "../../../UI/DateRangePicker/DateRangePicker";

const toParam = (date) => format(date, "yyyy-MM-dd");

const PRESETS = [
  {
    key: "currentMonth",
    label: "Текущий месяц",
    range: () => [startOfMonth(new Date()), endOfMonth(new Date())],
  },
  {
    key: "prevMonth",
    label: "Прошлый месяц",
    range: () => {
      const prev = subMonths(new Date(), 1);
      return [startOfMonth(prev), endOfMonth(prev)];
    },
  },
  {
    key: "quarter",
    label: "Квартал",
    range: () => [startOfQuarter(new Date()), endOfQuarter(new Date())],
  },
  {
    key: "last30",
    label: "30 дней",
    range: () => [subDays(new Date(), 29), new Date()],
  },
];

// Период всегда в поисковых параметрах URL: отчёт можно шарить ссылкой
const PeriodToolbar = ({ from, to, onChange, disabled }) => {
  const [pendingRange, setPendingRange] = useState([null, null]);

  const applyRange = ([start, end]) => onChange(toParam(start), toParam(end));

  const activePresetKey = PRESETS.find((preset) => {
    const [start, end] = preset.range();
    return toParam(start) === from && toParam(end) === to;
  })?.key;

  // Стрелки листают календарные месяцы относительно начала периода
  const shiftMonth = (direction) => {
    const base = addMonths(from ? parseISO(from) : new Date(), direction);
    applyRange([startOfMonth(base), endOfMonth(base)]);
  };

  const rangePickerChangeHandler = (range) => {
    setPendingRange(range);
    const [start, end] = range;
    if (start && end) {
      applyRange([start, end]);
      setPendingRange([null, null]);
    }
  };

  return (
    <div className="d-flex flex-wrap align-items-center gap-2">
      <ButtonGroup>
        <Button
          variant="outline-secondary"
          onClick={() => shiftMonth(-1)}
          disabled={disabled}
          aria-label="Предыдущий месяц"
        >
          <FaAngleLeft />
        </Button>
        <Button
          variant="outline-secondary"
          onClick={() => shiftMonth(1)}
          disabled={disabled}
          aria-label="Следующий месяц"
        >
          <FaAngleRight />
        </Button>
      </ButtonGroup>
      <ButtonGroup className="flex-wrap">
        {PRESETS.map((preset) => (
          <Button
            key={preset.key}
            variant={
              activePresetKey === preset.key ? "primary" : "outline-primary"
            }
            onClick={() => applyRange(preset.range())}
            disabled={disabled}
          >
            {preset.label}
          </Button>
        ))}
      </ButtonGroup>
      <DateRangePicker
        className="mb-0"
        startDate={pendingRange[0]}
        endDate={pendingRange[1]}
        onChange={rangePickerChangeHandler}
        disabled={disabled}
      />
    </div>
  );
};

export default PeriodToolbar;
