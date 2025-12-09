import { Pie } from "react-chartjs-2";
import Card from "react-bootstrap/Card";
import Spinner from "../../animations/Spinner";

const SubdivisionTimeChart = ({ data, isLoading }) => {
  if (!data || !data.companies || data.companies.length === 0) {
    return (
      <Card>
        <Card.Header>
          <h6>Время работ по подразделениям</h6>
        </Card.Header>
        <Card.Body className="text-center">
          <p className="text-muted">Нет данных для отображения</p>
        </Card.Body>
      </Card>
    );
  }

  // Собираем данные по подразделениям из всех компаний
  const subdivisionData = {};

  data.companies.forEach((company) => {
    if (company.subdivisions && company.subdivisions.length > 0) {
      company.subdivisions.forEach((subdivision) => {
        if (!subdivisionData[subdivision._id]) {
          subdivisionData[subdivision._id] = {
            name: subdivision.name,
            totalTime: 0,
            onSiteTime: 0,
            remoteTime: 0,
            routineTaskTime: 0,
          };
        }
        subdivisionData[subdivision._id].totalTime += subdivision.totalTime;
        subdivisionData[subdivision._id].onSiteTime += subdivision.onSiteTime;
        subdivisionData[subdivision._id].remoteTime += subdivision.remoteTime;
        subdivisionData[subdivision._id].routineTaskTime +=
          subdivision.routineTaskTime;
      });
    }
  });

  const subdivisions = Object.values(subdivisionData);

  if (subdivisions.length === 0) {
    return (
      <Card>
        <Card.Header>
          <h6>Время работ по подразделениям</h6>
        </Card.Header>
        <Card.Body className="text-center">
          <p className="text-muted">Нет данных по подразделениям</p>
        </Card.Body>
      </Card>
    );
  }

  const chartData = {
    labels: subdivisions.map((sub) => sub.name),
    datasets: [
      {
        label: "Время работ (часы)",
        data: subdivisions.map((sub) => sub.totalTime / (1000 * 60 * 60)),
        backgroundColor: subdivisions.map(
          (_, index) => `hsl(${(index * 137.5) % 360}, 70%, 60%)`,
        ),
        borderWidth: 0,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          generateLabels: function (chart) {
            const data = chart.data;
            if (data.labels.length && data.datasets.length) {
              const totalHours = data.datasets[0].data.reduce(
                (sum, value) => sum + value,
                0,
              );
              return data.labels.map((label, i) => {
                const value = data.datasets[0].data[i];
                const percentage =
                  totalHours > 0 ? Math.round((value / totalHours) * 100) : 0;
                const hours = Math.floor(value);
                const minutes = Math.round((value - hours) * 60);
                const timeStr =
                  hours.toString().padStart(2, "0") +
                  ":" +
                  minutes.toString().padStart(2, "0");

                return {
                  text: `${label}: ${timeStr} (${percentage}%)`,
                  fillStyle: data.datasets[0].backgroundColor[i],
                  strokeStyle: data.datasets[0].backgroundColor[i],
                  lineWidth: 0,
                  hidden: false,
                  index: i,
                };
              });
            }
            return [];
          },
          boxWidth: 12,
          padding: 8,
          usePointStyle: true,
          color: "#ffffff",
        },
      },
      title: {
        display: true,
        text: "Распределение времени работ по подразделениям",
      },
      tooltip: {
        callbacks: {
          label: function (context) {
            const value = context.parsed;
            const totalHours = context.chart.data.datasets[0].data.reduce(
              (sum, val) => sum + val,
              0,
            );
            const percentage =
              totalHours > 0 ? Math.round((value / totalHours) * 100) : 0;
            const hours = Math.floor(value);
            const minutes = Math.round((value - hours) * 60);
            const timeStr =
              hours.toString().padStart(2, "0") +
              ":" +
              minutes.toString().padStart(2, "0");
            return `${context.label}: ${timeStr} (${percentage}%)`;
          },
        },
      },
    },
  };

  return (
    <Card>
      <Card.Header>
        <h6>Время работ по подразделениям</h6>
      </Card.Header>
      <Card.Body>
        {isLoading ? (
          <div className="text-center p-4">
            <Spinner />
            <p className="mt-2 text-muted">Загрузка графика...</p>
          </div>
        ) : (
          <div
            style={{
              height: "400px",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <Pie data={chartData} options={chartOptions} />
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default SubdivisionTimeChart;
