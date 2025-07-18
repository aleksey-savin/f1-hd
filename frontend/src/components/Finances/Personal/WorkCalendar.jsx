import { useState } from "react";
import { Card, Badge, Tooltip, OverlayTrigger } from "react-bootstrap";
import { formatShortDate } from "../../../util/format-date";
import { formatPrice } from "../../../util/format-string";
import { msToHMS } from "../../../util/time-helpers";
import { calculateWorkTime, calculateCost } from "../../../util/finances";

const WorkCalendar = ({ works = [], selectedMonth = new Date() }) => {
  const [_selectedDate, setSelectedDate] = useState(null);

  // Get the first day of the month and last day
  const firstDay = new Date(
    selectedMonth.getFullYear(),
    selectedMonth.getMonth(),
    1,
  );
  const lastDay = new Date(
    selectedMonth.getFullYear(),
    selectedMonth.getMonth() + 1,
    0,
  );

  // Get the first day of the week for the calendar grid
  const firstCalendarDay = new Date(firstDay);
  firstCalendarDay.setDate(
    firstCalendarDay.getDate() - firstCalendarDay.getDay(),
  );

  // Get the last day of the week for the calendar grid
  const lastCalendarDay = new Date(lastDay);
  lastCalendarDay.setDate(
    lastCalendarDay.getDate() + (6 - lastCalendarDay.getDay()),
  );

  // Group works by date
  const worksByDate = works.reduce((acc, work) => {
    const workDate = work.startedAt || work.createdAt;
    if (workDate) {
      const dateKey = new Date(workDate).toDateString();
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(work);
    }
    return acc;
  }, {});

  // Calculate statistics for each date
  const getDateStats = (date) => {
    const dateKey = date.toDateString();
    const dayWorks = worksByDate[dateKey] || [];

    let totalTime = 0;
    let totalEarnings = 0;
    let overtimeCount = 0;

    dayWorks.forEach((work) => {
      if (work.startedAt && work.finishedAt) {
        const workTime = calculateWorkTime(work.startedAt, work.finishedAt);
        totalTime += workTime;
        totalEarnings += calculateCost(workTime / (1000 * 60), 1000, 20);

        if (work.overtime && work.overtime.minutes > 0) {
          overtimeCount++;
        }
      }
    });

    return {
      worksCount: dayWorks.length,
      totalTime,
      totalEarnings,
      overtimeCount,
      works: dayWorks,
    };
  };

  // Generate calendar days
  const generateCalendarDays = () => {
    const days = [];
    const current = new Date(firstCalendarDay);

    while (current <= lastCalendarDay) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return days;
  };

  const calendarDays = generateCalendarDays();
  const weekDays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

  const getIntensityColor = (worksCount) => {
    if (worksCount === 0) return "#f8f9fa";
    if (worksCount === 1) return "#d4edda";
    if (worksCount === 2) return "#c3e6cb";
    if (worksCount >= 3) return "#a3d977";
    return "#28a745";
  };

  const getDayClass = (date, stats) => {
    const isCurrentMonth = date.getMonth() === selectedMonth.getMonth();
    const isToday = date.toDateString() === new Date().toDateString();
    const hasWorks = stats.worksCount > 0;

    let className = "calendar-day p-2 border text-center position-relative";

    if (!isCurrentMonth) {
      className += " text-muted bg-light";
    } else if (isToday) {
      className += " border-primary border-2";
    }

    if (hasWorks) {
      className += " cursor-pointer";
    }

    return className;
  };

  const renderTooltip = (date, stats) => (
    <Tooltip>
      <div>
        <strong>{formatShortDate(date)}</strong>
        {stats.worksCount > 0 ? (
          <>
            <br />
            Работ: {stats.worksCount}
            <br />
            Время: {msToHMS(stats.totalTime)}
            <br />
            Заработано: {formatPrice(stats.totalEarnings)}
            {stats.overtimeCount > 0 && (
              <>
                <br />
                Переработки: {stats.overtimeCount}
              </>
            )}
          </>
        ) : (
          <>
            <br />
            Нет работ
          </>
        )}
      </div>
    </Tooltip>
  );

  return (
    <Card>
      <Card.Header>
        <h6 className="mb-0">Календарь работ</h6>
        <small className="text-muted">
          {selectedMonth.toLocaleDateString("ru-RU", {
            month: "long",
            year: "numeric",
          })}
        </small>
      </Card.Header>
      <Card.Body className="p-0">
        <div className="calendar-container">
          {/* Week days header */}
          <div className="d-flex border-bottom">
            {weekDays.map((day) => (
              <div
                key={day}
                className="flex-fill text-center p-2 fw-bold text-muted"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="calendar-grid">
            {Array.from(
              { length: Math.ceil(calendarDays.length / 7) },
              (_, weekIndex) => (
                <div key={weekIndex} className="d-flex">
                  {calendarDays
                    .slice(weekIndex * 7, (weekIndex + 1) * 7)
                    .map((date, dayIndex) => {
                      const stats = getDateStats(date);
                      return (
                        <OverlayTrigger
                          key={dayIndex}
                          placement="top"
                          overlay={renderTooltip(date, stats)}
                        >
                          <div
                            className={getDayClass(date, stats)}
                            style={{
                              backgroundColor: getIntensityColor(
                                stats.worksCount,
                              ),
                              minHeight: "80px",
                              cursor:
                                stats.worksCount > 0 ? "pointer" : "default",
                              flex: "1 1 14.28%",
                            }}
                            onClick={() =>
                              stats.worksCount > 0 && setSelectedDate(date)
                            }
                          >
                            <div className="fw-bold">{date.getDate()}</div>
                            {stats.worksCount > 0 && (
                              <div className="mt-1">
                                <Badge bg="primary" className="small">
                                  {stats.worksCount}
                                </Badge>
                                {stats.overtimeCount > 0 && (
                                  <Badge bg="warning" className="small ms-1">
                                    ⚡
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        </OverlayTrigger>
                      );
                    })}
                </div>
              ),
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="p-3 border-top bg-light">
          <small className="text-muted">
            <strong>Легенда:</strong> Цвет указывает на количество работ в день
            <span className="ms-3">
              <span
                className="d-inline-block me-1"
                style={{
                  width: "12px",
                  height: "12px",
                  backgroundColor: "#f8f9fa",
                  border: "1px solid #dee2e6",
                }}
              ></span>
              Нет работ
            </span>
            <span className="ms-2">
              <span
                className="d-inline-block me-1"
                style={{
                  width: "12px",
                  height: "12px",
                  backgroundColor: "#d4edda",
                }}
              ></span>
              1 работа
            </span>
            <span className="ms-2">
              <span
                className="d-inline-block me-1"
                style={{
                  width: "12px",
                  height: "12px",
                  backgroundColor: "#c3e6cb",
                }}
              ></span>
              2 работы
            </span>
            <span className="ms-2">
              <span
                className="d-inline-block me-1"
                style={{
                  width: "12px",
                  height: "12px",
                  backgroundColor: "#a3d977",
                }}
              ></span>
              3+ работы
            </span>
            <span className="ms-3">
              <Badge bg="warning" className="small">
                ⚡
              </Badge>
              Есть переработки
            </span>
          </small>
        </div>
      </Card.Body>

      <style jsx>{`
        .calendar-day:hover {
          background-color: rgba(0, 123, 255, 0.1) !important;
        }

        .cursor-pointer {
          cursor: pointer;
        }

        .calendar-container {
          font-size: 0.9rem;
        }
      `}</style>
    </Card>
  );
};

export default WorkCalendar;
