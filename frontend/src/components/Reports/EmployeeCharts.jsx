import { Bar, Doughnut } from "react-chartjs-2";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";
import Spinner from "../../animations/Spinner";

const EmployeeCharts = ({ data, isLoading }) => {
  if (!data || !data.companies) return null;

  const companies = data.companies;

  // Данные для графика по сотрудникам
  const allExecutors = companies.reduce((acc, company) => {
    company.executors.forEach((executor) => {
      const existing = acc.find((e) => e.name === executor.name);
      if (existing) {
        existing.totalWorks += executor.totalWorks;
        existing.totalTime += executor.totalTime;
        existing.onSiteWorks += executor.onSiteWorks;
        existing.remoteWorks += executor.remoteWorks;
        existing.onSiteTime += executor.onSiteTime;
        existing.remoteTime += executor.remoteTime;
        existing.companies.push(company.company.alias);
      } else {
        acc.push({
          ...executor,
          companies: [company.company.alias],
        });
      }
    });
    return acc;
  }, []);

  // Сортируем сотрудников по общему времени работ
  const topExecutors = allExecutors
    .sort((a, b) => b.totalTime - a.totalTime)
    .slice(0, 15); // Берём топ 15 сотрудников

  const executorTimeData = {
    labels: topExecutors.map((e) => e.name),
    datasets: [
      {
        label: "Выезды (часы)",
        data: topExecutors.map((e) => e.onSiteTime / (1000 * 60 * 60)),
        backgroundColor: "rgba(255, 193, 7, 0.6)",
        borderColor: "rgba(255, 193, 7, 1)",
        borderWidth: 1,
      },
      {
        label: "Удалённые (часы)",
        data: topExecutors.map((e) => e.remoteTime / (1000 * 60 * 60)),
        backgroundColor: "rgba(40, 167, 69, 0.6)",
        borderColor: "rgba(40, 167, 69, 1)",
        borderWidth: 1,
      },
    ],
  };

  const executorWorksData = {
    labels: topExecutors.map((e) => e.name),
    datasets: [
      {
        label: "Общее время (часы)",
        data: topExecutors.map((e) => e.totalTime / (1000 * 60 * 60)),
        backgroundColor: topExecutors.map(
          (_, index) => `hsl(${(index * 137.5) % 360}, 70%, 60%)`,
        ),
      },
    ],
  };

  const executorOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: "top",
      },
      title: {
        display: true,
        text: "Топ 15 сотрудников по времени работ",
      },
      tooltip: {
        callbacks: {
          label: function (context) {
            const label = context.dataset.label || "";
            const value = context.parsed.y;
            const hours = Math.floor(value);
            const minutes = Math.round((value - hours) * 60);
            return (
              label +
              ": " +
              hours.toString().padStart(2, "0") +
              ":" +
              minutes.toString().padStart(2, "0")
            );
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
      x: {
        ticks: {
          maxRotation: 45,
          minRotation: 45,
        },
      },
    },
  };

  const executorWorksOptions = {
    responsive: true,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: "Топ 15 сотрудников по времени работ",
      },
      tooltip: {
        callbacks: {
          label: function (context) {
            const value = context.parsed;
            const hours = Math.floor(value);
            const minutes = Math.round((value - hours) * 60);
            return (
              hours.toString().padStart(2, "0") +
              ":" +
              minutes.toString().padStart(2, "0")
            );
          },
        },
      },
    },
  };

  return (
    <Row className="mb-4">
      <Col lg={8}>
        <Card>
          <Card.Header>
            <h6>Распределение удалённых работ и выездов</h6>
          </Card.Header>
          <Card.Body>
            {isLoading ? (
              <div className="text-center p-4">
                <Spinner />
                <p className="mt-2 text-muted">
                  Загрузка графика сотрудников...
                </p>
              </div>
            ) : (
              <Bar data={executorTimeData} options={executorOptions} />
            )}
          </Card.Body>
        </Card>
      </Col>
      <Col lg={4}>
        <Card>
          <Card.Header>
            <h6>Распределение сотрудников по времени работ</h6>
          </Card.Header>
          <Card.Body>
            {isLoading ? (
              <div className="text-center p-4">
                <Spinner />
                <p className="mt-2 text-muted">Загрузка графика...</p>
              </div>
            ) : (
              <Doughnut
                data={executorWorksData}
                options={executorWorksOptions}
              />
            )}
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
};

export default EmployeeCharts;
