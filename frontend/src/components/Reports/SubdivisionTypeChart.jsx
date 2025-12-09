import { Pie } from "react-chartjs-2";
import Card from "react-bootstrap/Card";
import Spinner from "../../animations/Spinner";

const SubdivisionTypeChart = ({ data, isLoading }) => {
  if (!data || !data.companies || data.companies.length === 0) {
    return null; // Не показываем компонент если нет данных
  }

  // Собираем данные по типам работ из всех подразделений
  const workTypeData = {
    onSiteTime: 0,
    remoteTime: 0,
    routineTaskTime: 0,
  };

  let hasSubdivisions = false;

  data.companies.forEach((company) => {
    if (company.subdivisions && company.subdivisions.length > 0) {
      hasSubdivisions = true;
      company.subdivisions.forEach((subdivision) => {
        workTypeData.onSiteTime += subdivision.onSiteTime || 0;
        workTypeData.remoteTime += subdivision.remoteTime || 0;
        workTypeData.routineTaskTime += subdivision.routineTaskTime || 0;
      });
    }
  });

  // Если нет подразделений, используем данные компании
  if (!hasSubdivisions) {
    data.companies.forEach((company) => {
      workTypeData.onSiteTime += company.onSite?.time || 0;
      workTypeData.remoteTime += company.remote?.time || 0;
      workTypeData.routineTaskTime += company.routineTask?.time || 0;
    });
  }

  const totalTime =
    workTypeData.onSiteTime +
    workTypeData.remoteTime +
    workTypeData.routineTaskTime;

  // Если нет времени работ, не показываем график
  if (totalTime === 0) {
    return null;
  }

  const chartData = {
    labels: ["Выезды", "Удалённые", "Регламентные"],
    datasets: [
      {
        label: "Время работ (часы)",
        data: [
          workTypeData.onSiteTime / (1000 * 60 * 60),
          workTypeData.remoteTime / (1000 * 60 * 60),
          workTypeData.routineTaskTime / (1000 * 60 * 60),
        ],
        backgroundColor: [
          "rgba(255, 193, 7, 0.8)", // Желтый для выездов
          "rgba(40, 167, 69, 0.8)", // Зеленый для удаленных
          "rgba(108, 117, 125, 0.8)", // Серый для регламентных
        ],
        borderColor: [
          "rgba(255, 193, 7, 1)",
          "rgba(40, 167, 69, 1)",
          "rgba(108, 117, 125, 1)",
        ],
        borderWidth: 2,
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
                  strokeStyle: data.datasets[0].borderColor[i],
                  lineWidth: 2,
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
        text: hasSubdivisions
          ? "Время работ по типу и подразделениям"
          : "Время работ по типу",
        color: "#ffffff",
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
        <h6>
          {hasSubdivisions
            ? "Время работ по типу и подразделениям"
            : "Время работ по типу"}
        </h6>
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
              alignItems: "center",
            }}
          >
            <Pie data={chartData} options={chartOptions} />
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default SubdivisionTypeChart;
