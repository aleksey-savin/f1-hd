import { useState } from "react";

import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";

import { FaAngleLeft, FaAngleRight } from "react-icons/fa";
import { RiCalendar2Line } from "react-icons/ri";

import { formatMinutes } from "./format";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const toKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

// Интенсивность — ступени фактического времени за день
const intensityClass = (minutes) => {
  if (!minutes) return "wcal-int-0";
  if (minutes < 120) return "wcal-int-1";
  if (minutes < 240) return "wcal-int-2";
  if (minutes < 360) return "wcal-int-3";
  return "wcal-int-4";
};

const monthKey = (date) => `${date.getFullYear()}-${date.getMonth()}`;

// Календарь занятости: данные приходят готовыми с сервера (byDay),
// график из настроек нужен только для подсветки нерабочих дней
const WorkCalendar = ({ byDay, schedule, from, to }) => {
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);

  const [cursor, setCursor] = useState(
    new Date(fromDate.getFullYear(), fromDate.getMonth(), 1),
  );

  const byDate = new Map(byDay.map((day) => [day.date, day]));

  const canGoPrev = monthKey(cursor) !== monthKey(fromDate);
  const canGoNext = monthKey(cursor) !== monthKey(toDate);
  const shiftMonth = (direction) =>
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1));

  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const daysInMonth = new Date(
    cursor.getFullYear(),
    cursor.getMonth() + 1,
    0,
  ).getDate();
  const leadingBlanks = (firstDay.getDay() + 6) % 7; // недели с понедельника

  const cells = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, index) =>
        new Date(cursor.getFullYear(), cursor.getMonth(), index + 1),
    ),
  ];

  const todayKey = toKey(new Date());

  const renderDay = (date) => {
    const key = toKey(date);
    const entry = byDate.get(key);
    const isOffDay = !schedule?.[DAY_NAMES[date.getDay()]]?.isWorking;
    const inPeriod = byDate.has(key);

    const classes = [
      "wcal-day",
      intensityClass(entry?.minutes),
      isOffDay ? "wcal-day--off" : "",
      !inPeriod ? "wcal-day--outside" : "",
      key === todayKey ? "wcal-day--today" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const tooltip = (
      <Tooltip>
        <strong>
          {date.toLocaleDateString("ru-RU", {
            weekday: "short",
            day: "numeric",
            month: "long",
          })}
        </strong>
        {entry && entry.worksCount > 0 ? (
          <>
            <br />
            Работ: {entry.worksCount}
            <br />
            Время: {formatMinutes(entry.minutes)}
            {entry.overtimeMinutes > 0 && (
              <>
                <br />
                Переработка: {formatMinutes(entry.overtimeMinutes)}
              </>
            )}
            {entry.onSiteCount > 0 && (
              <>
                <br />
                Выезды: {entry.onSiteCount}
              </>
            )}
          </>
        ) : (
          <>
            <br />
            {inPeriod ? "Нет работ" : "Вне выбранного периода"}
          </>
        )}
      </Tooltip>
    );

    return (
      <OverlayTrigger key={key} placement="top" overlay={tooltip}>
        <div className={classes}>
          <span className="wcal-day__num">{date.getDate()}</span>
          {entry?.overtimeMinutes > 0 && <span className="wcal-day__ot" />}
        </div>
      </OverlayTrigger>
    );
  };

  return (
    <Card className="h-100">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span>
          <RiCalendar2Line /> Календарь занятости
        </span>
        <div className="d-flex align-items-center gap-2">
          <span className="text-body-secondary small">
            {cursor.toLocaleDateString("ru-RU", {
              month: "long",
              year: "numeric",
            })}
          </span>
          <Button
            size="sm"
            variant="outline-secondary"
            disabled={!canGoPrev}
            onClick={() => shiftMonth(-1)}
            aria-label="Предыдущий месяц"
          >
            <FaAngleLeft />
          </Button>
          <Button
            size="sm"
            variant="outline-secondary"
            disabled={!canGoNext}
            onClick={() => shiftMonth(1)}
            aria-label="Следующий месяц"
          >
            <FaAngleRight />
          </Button>
        </div>
      </Card.Header>
      <Card.Body>
        <div className="wcal-grid wcal-grid--head">
          {WEEKDAYS.map((day) => (
            <div key={day} className="wcal-weekday">
              {day}
            </div>
          ))}
        </div>
        <div className="wcal-grid">
          {cells.map((date, index) =>
            date ? (
              renderDay(date)
            ) : (
              <div key={`blank-${index}`} className="wcal-day wcal-day--blank" />
            ),
          )}
        </div>
      </Card.Body>
      <Card.Footer className="small text-body-secondary d-flex align-items-center gap-3 flex-wrap">
        <span className="d-inline-flex align-items-center gap-1">
          меньше
          {[0, 1, 2, 3, 4].map((step) => (
            <span key={step} className={`wcal-legend wcal-int-${step}`} />
          ))}
          больше
        </span>
        <span>
          <span className="wcal-legend wcal-legend--ot" /> есть переработка
        </span>
        <span>
          <Badge bg="light" text="dark" className="border fw-normal">
            бледная дата
          </Badge>{" "}
          — нерабочий день графика
        </span>
      </Card.Footer>
    </Card>
  );
};

export default WorkCalendar;
