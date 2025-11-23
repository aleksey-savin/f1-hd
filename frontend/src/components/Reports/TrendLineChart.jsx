import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
);

import { useState, useRef } from "react";
import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Spinner from "../../animations/Spinner";

const TrendLineChart = ({ data, isLoading, metric = "totalWorks", title }) => {
  const [visibleCompanies, setVisibleCompanies] = useState(new Set());
  const [initialized, setInitialized] = useState(false);
  const chartRef = useRef();

  // Инициализация видимости всех компаний при первой загрузке
  if (!initialized && data && data.data && data.data.length > 0) {
    const allCompanies = new Set(
      data.data.map((company) => company.company._id),
    );
    setVisibleCompanies(allCompanies);
    setInitialized(true);
  }
  if (isLoading) {
    return (
      <Card>
        <Card.Body
          className="d-flex justify-content-center align-items-center"
          style={{ height: "500px" }}
        >
          <Spinner />
        </Card.Body>
      </Card>
    );
  }

  if (!data || !data.data || data.data.length === 0) {
    return (
      <Card>
        <Card.Body className="text-center" style={{ height: "500px" }}>
          <p className="text-muted">Нет данных для отображения</p>
        </Card.Body>
      </Card>
    );
  }

  // Извлекаем метки периодов из первой компании
  const labels = data.data[0]?.periods?.map((period) => period.label) || [];

  // Генерируем цвета для компаний
  const colors = [
    "rgba(54, 162, 235, 1)",
    "rgba(255, 99, 132, 1)",
    "rgba(255, 206, 86, 1)",
    "rgba(75, 192, 192, 1)",
    "rgba(153, 102, 255, 1)",
    "rgba(255, 159, 64, 1)",
    "rgba(199, 199, 199, 1)",
    "rgba(83, 102, 255, 1)",
  ];

  // Функция для извлечения значения метрики
  const getMetricValue = (period, metric) => {
    switch (metric) {
      case "totalWorks":
        return period.totalWorks;
      case "totalTickets":
        return period.totalTickets;
      case "totalTime":
        return period.totalTime / (1000 * 60 * 60); // конвертируем в часы (точное значение)
      case "onSiteCount":
        return period.onSite?.count || 0;
      case "remoteCount":
        return period.remote?.count || 0;
      case "onSiteTime":
        return (period.onSite?.time || 0) / (1000 * 60 * 60);
      case "remoteTime":
        return (period.remote?.time || 0) / (1000 * 60 * 60);
      case "routineTaskTime":
        return (period.routineTask?.time || 0) / (1000 * 60 * 60);
      default:
        return 0;
    }
  };

  // Функции управления видимостью компаний
  const toggleAllCompanies = () => {
    if (visibleCompanies.size === 0) {
      // Показать все компании
      const allCompanies = new Set(
        data.data.map((company) => company.company._id),
      );
      setVisibleCompanies(allCompanies);
    } else {
      // Скрыть все компании
      setVisibleCompanies(new Set());
    }
  };

  const uncheckAllCompanies = () => {
    setVisibleCompanies(new Set());
  };

  const toggleCompany = (companyId) => {
    const newVisible = new Set(visibleCompanies);
    if (newVisible.has(companyId)) {
      newVisible.delete(companyId);
    } else {
      newVisible.add(companyId);
    }
    setVisibleCompanies(newVisible);
  };

  // Формируем datasets для каждой компании
  const datasets = data.data.map((company, index) => {
    const isVisible = visibleCompanies.has(company.company._id);
    return {
      label: company.company.alias,
      data: company.periods.map((period) => getMetricValue(period, metric)),
      borderColor: colors[index % colors.length],
      backgroundColor: colors[index % colors.length].replace("1)", "0.1)"),
      borderWidth: 2,
      fill: false,
      tension: 0.1,
      pointBackgroundColor: colors[index % colors.length],
      pointBorderColor: colors[index % colors.length],
      pointHoverBackgroundColor: colors[index % colors.length],
      pointHoverBorderColor: colors[index % colors.length],
      pointRadius: 4,
      pointHoverRadius: 6,
      hidden: !isVisible, // Скрываем линию, если компания не выбрана
    };
  });

  const chartData = {
    labels: labels,
    datasets: datasets,
  };

  // Определяем единицы измерения для оси Y
  const getYAxisLabel = (metric) => {
    switch (metric) {
      case "totalTime":
      case "onSiteTime":
      case "remoteTime":
      case "routineTaskTime":
        return "Часы";
      case "totalWorks":
      case "onSiteCount":
      case "remoteCount":
        return "Количество работ";
      case "totalTickets":
        return "Количество заявок";
      default:
        return "Значение";
    }
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false, // Отключаем стандартную легенду
      },
      title: {
        display: true,
        text: title || "Анализ трендов",
        font: {
          size: 16,
          weight: "bold",
        },
      },
      tooltip: {
        enabled: false,
      },
    },
    interaction: {
      mode: "nearest",
      axis: "x",
      intersect: false,
    },
    scales: {
      x: {
        display: true,
        title: {
          display: true,
          text: "Период",
        },
        grid: {
          display: true,
          color: "rgba(0,0,0,0.1)",
        },
      },
      y: {
        display: true,
        title: {
          display: true,
          text: getYAxisLabel(metric),
        },
        beginAtZero: true,
        grid: {
          display: true,
          color: "rgba(0,0,0,0.1)",
        },
        ticks: {
          callback: function (value) {
            if (metric.includes("Time")) {
              const hours = Math.floor(value);
              const minutes = Math.round((value - hours) * 60);
              return minutes > 0 ? `${hours}ч ${minutes}м` : `${hours}ч`;
            }
            return Math.round(value * 100) / 100;
          },
        },
      },
    },
  };

  return (
    <Card className="mb-4">
      <Card.Header>
        <Row className="align-items-center">
          <Col>
            <h5 className="mb-0">{title || "Анализ трендов"}</h5>
          </Col>
          <Col xs="auto">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={toggleAllCompanies}
              className="me-2"
            >
              {visibleCompanies.size === 0 ? "Показать все" : "Скрыть все"}
            </Button>
            <Button
              variant="outline-danger"
              size="sm"
              onClick={uncheckAllCompanies}
            >
              Снять все
            </Button>
          </Col>
        </Row>
      </Card.Header>
      <Card.Body>
        {/* Кастомная легенда */}
        <div className="mb-3">
          <Row>
            {data.data.map((company, index) => {
              const isVisible = visibleCompanies.has(company.company._id);
              const color = colors[index % colors.length];

              return (
                <Col xs="auto" key={company.company._id} className="mb-2">
                  <Form.Check
                    type="checkbox"
                    id={`company-${company.company._id}`}
                    checked={isVisible}
                    onChange={() => toggleCompany(company.company._id)}
                    label={
                      <span className="d-flex align-items-center">
                        <span
                          className="me-2"
                          style={{
                            display: "inline-block",
                            width: "16px",
                            height: "3px",
                            backgroundColor: color,
                            borderRadius: "2px",
                          }}
                        ></span>
                        <strong
                          style={{ color: isVisible ? "inherit" : "#6c757d" }}
                        >
                          {company.company.alias}
                        </strong>
                      </span>
                    }
                    style={{
                      opacity: isVisible ? 1 : 0.6,
                    }}
                  />
                </Col>
              );
            })}
          </Row>
        </div>

        <div style={{ height: "500px" }}>
          <Line ref={chartRef} data={chartData} options={options} />
        </div>
      </Card.Body>
    </Card>
  );
};

export default TrendLineChart;
