import { Bar } from "react-chartjs-2";
import Card from "react-bootstrap/Card";
import Spinner from "../../animations/Spinner";

const CompanyTimeChart = ({ data, isLoading }) => {
  if (!data || !data.companies) return null;

  const companies = data.companies;

  // Данные для гистограммы по времени работ
  const timeChartData = {
    labels: companies.map((c) => c.company.alias),
    datasets: [
      {
        label: "Выезды (часы)",
        data: companies.map((c) => c.onSite.time / (1000 * 60 * 60)),
        backgroundColor: "rgba(255, 193, 7, 0.6)",
        borderColor: "rgba(255, 193, 7, 1)",
        borderWidth: 1,
      },
      {
        label: "Удалённые (часы)",
        data: companies.map((c) => c.remote.time / (1000 * 60 * 60)),
        backgroundColor: "rgba(40, 167, 69, 0.6)",
        borderColor: "rgba(40, 167, 69, 1)",
        borderWidth: 1,
      },
      {
        label: "Регламентные (часы)",
        data: companies.map(
          (c) => (c.routineTask?.time || 0) / (1000 * 60 * 60),
        ),
        backgroundColor: "rgba(108, 117, 125, 0.6)",
        borderColor: "rgba(108, 117, 125, 1)",
        borderWidth: 1,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: "top",
      },
      title: {
        display: true,
        text: "Статистика работ по компаниям",
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
    },
  };

  return (
    <Card>
      <Card.Header>
        <h6>Время работ по типу и компаниям</h6>
      </Card.Header>
      <Card.Body>
        {isLoading ? (
          <div className="text-center p-4">
            <Spinner />
            <p className="mt-2 text-muted">Загрузка графика...</p>
          </div>
        ) : (
          <Bar data={timeChartData} options={chartOptions} />
        )}
      </Card.Body>
    </Card>
  );
};

export default CompanyTimeChart;
