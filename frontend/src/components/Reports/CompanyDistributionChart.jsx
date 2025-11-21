import { Bar } from "react-chartjs-2";
import Card from "react-bootstrap/Card";
import Spinner from "../../animations/Spinner";

const CompanyDistributionChart = ({ data, isLoading }) => {
  if (!data || !data.companies) return null;

  const companies = data.companies;

  // Сортируем компании по общему времени для лучшей читаемости
  const sortedByTime = [...companies].sort((a, b) => b.totalTime - a.totalTime);

  const companiesTimeData = {
    labels: sortedByTime.map((c) => c.company.alias),
    datasets: [
      {
        label: "Общее время (часы)",
        data: sortedByTime.map((c) => c.totalTime / (1000 * 60 * 60)),
        backgroundColor: sortedByTime.map(
          (_, index) => `hsl(${(index * 137.5) % 360}, 65%, 55%)`,
        ),
        borderColor: sortedByTime.map(
          (_, index) => `hsl(${(index * 137.5) % 360}, 65%, 45%)`,
        ),
        borderWidth: 1,
      },
    ],
  };

  const companiesTimeOptions = {
    responsive: true,
    indexAxis: "y",
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: "Распределение времени по компаниям",
      },
      tooltip: {
        callbacks: {
          label: function (context) {
            const value = context.parsed.x;
            const hours = Math.floor(value);
            const minutes = Math.round((value - hours) * 60);
            return (
              "Время: " +
              hours.toString().padStart(2, "0") +
              ":" +
              minutes.toString().padStart(2, "0")
            );
          },
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        title: {
          display: true,
          text: "Часы",
        },
      },
      y: {
        title: {
          display: true,
          text: "Компании",
        },
        ticks: {
          maxRotation: 0,
          minRotation: 0,
        },
      },
    },
    elements: {
      bar: {
        borderWidth: 1,
        borderRadius: 4,
        barThickness: "flex",
        maxBarThickness: 40,
      },
    },
    categoryPercentage: 0.9,
    barPercentage: 0.8,
  };

  return (
    <Card>
      <Card.Header>
        <h6>Общее время по компаниям</h6>
      </Card.Header>
      <Card.Body>
        {isLoading ? (
          <div className="text-center p-4">
            <Spinner />
            <p className="mt-2 text-muted">Загрузка графика...</p>
          </div>
        ) : (
          <Bar data={companiesTimeData} options={companiesTimeOptions} />
        )}
      </Card.Body>
    </Card>
  );
};

export default CompanyDistributionChart;
