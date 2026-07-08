import { useMemo } from "react";
import { Bar } from "react-chartjs-2";

import Card from "react-bootstrap/Card";

import { RiBarChartLine } from "react-icons/ri";

import { chartColor, formatMinutes } from "./format";

const dayLabel = (isoDate, withMonth) => {
  const date = new Date(`${isoDate}T00:00:00`);
  return withMonth
    ? date.toLocaleDateString("ru-RU", { day: "numeric", month: "2-digit" })
    : String(date.getDate());
};

const tooltipTitle = (isoDate) =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });

const TimeByDayChart = ({ byDay }) => {
  const { data, options } = useMemo(() => {
    const workColor = chartColor("--pr-chart-work", "#3498db");
    const overtimeColor = chartColor("--pr-chart-ot", "#f39c12");
    const surface = chartColor("--bs-body-bg", "#ffffff");
    const gridColor = chartColor("--bs-border-color", "#dee2e6");
    const textColor = chartColor("--bs-secondary-color", "#6c757d");

    // Стек в пределах фактического времени дня: переработка сверх минут дня
    // (эффект округления вверх) не раздувает столбик, точные числа — в тултипе
    const spansMonths =
      byDay.length > 0 && byDay[0].date.slice(0, 7) !== byDay.at(-1).date.slice(0, 7);
    const overtimeShown = byDay.map((day) =>
      Math.min(day.overtimeMinutes, day.minutes),
    );

    return {
      data: {
        labels: byDay.map((day) => dayLabel(day.date, spansMonths)),
        datasets: [
          {
            label: "В графике",
            data: byDay.map(
              (day) => day.minutes - Math.min(day.overtimeMinutes, day.minutes),
            ),
            backgroundColor: workColor,
            borderColor: surface,
            borderWidth: 1,
            borderRadius: 3,
            stack: "day",
          },
          {
            label: "Переработка",
            data: overtimeShown,
            backgroundColor: overtimeColor,
            borderColor: surface,
            borderWidth: 1,
            borderRadius: 3,
            stack: "day",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: textColor, boxWidth: 12, boxHeight: 12 },
          },
          tooltip: {
            callbacks: {
              title: (items) => tooltipTitle(byDay[items[0].dataIndex].date),
              label: (item) => {
                const day = byDay[item.dataIndex];
                if (item.datasetIndex === 1) {
                  return `Переработка: ${formatMinutes(day.overtimeMinutes)}`;
                }
                return `Всего за день: ${formatMinutes(day.minutes)} · работ: ${day.worksCount}`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: {
              color: textColor,
              maxTicksLimit: 16,
              maxRotation: 0,
            },
          },
          y: {
            stacked: true,
            grid: { color: gridColor },
            border: { display: false },
            ticks: {
              color: textColor,
              callback: (value) =>
                value >= 60 ? `${Math.round(value / 60)} ч` : value,
            },
          },
        },
      },
    };
  }, [byDay]);

  return (
    <Card className="h-100">
      <Card.Header>
        <RiBarChartLine /> Время по дням
      </Card.Header>
      <Card.Body>
        <div style={{ height: "280px" }}>
          <Bar data={data} options={options} />
        </div>
      </Card.Body>
    </Card>
  );
};

export default TimeByDayChart;
