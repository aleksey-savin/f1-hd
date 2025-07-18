import { Card, Row, Col, ProgressBar } from "react-bootstrap";
import { RiTimeLine, RiMoneyDollarCircleLine, RiFileList3Line, RiAlarmWarningLine } from "react-icons/ri";
import { formatPrice } from "../../../util/format-string";
import { formatOvertimeMinutes } from "../../../util/finances";

const WorkStatistics = ({ data }) => {
  if (!data) {
    return null;
  }

  const {
    completedWorks = [],
    totalOvertime = 0,
    totalOvertimeWorks = 0,
    totalEarnings = 0,
    formattedTotalOvertime = "0 мин",
  } = data;

  // Calculate additional statistics
  const totalWorks = completedWorks.length;
  const overtimePercentage = totalWorks > 0 ? (totalOvertimeWorks / totalWorks) * 100 : 0;
  const averageEarningsPerWork = totalWorks > 0 ? totalEarnings / totalWorks : 0;

  // Calculate work distribution by status
  const statusDistribution = completedWorks.reduce((acc, work) => {
    const status = work.status || 'pending';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  // Calculate work distribution by company
  const companyDistribution = completedWorks.reduce((acc, work) => {
    const company = work.company?.name || 'Неизвестно';
    acc[company] = (acc[company] || 0) + 1;
    return acc;
  }, {});

  const topCompanies = Object.entries(companyDistribution)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 3);

  const StatCard = ({ icon: Icon, title, value, subtitle, color = "primary", progress }) => (
    <Card className="h-100">
      <Card.Body className="text-center">
        <Icon size={40} className={`text-${color} mb-3`} />
        <h3 className={`text-${color} mb-1`}>{value}</h3>
        <h6 className="text-muted mb-0">{title}</h6>
        {subtitle && <small className="text-muted">{subtitle}</small>}
        {progress !== undefined && (
          <ProgressBar
            variant={color}
            now={progress}
            className="mt-2"
            style={{ height: '4px' }}
          />
        )}
      </Card.Body>
    </Card>
  );

  return (
    <div className="mb-4">
      <h5 className="mb-3">Статистика работ</h5>

      {/* Main Statistics */}
      <Row className="mb-4">
        <Col md={3}>
          <StatCard
            icon={RiFileList3Line}
            title="Всего работ"
            value={totalWorks}
            color="primary"
          />
        </Col>
        <Col md={3}>
          <StatCard
            icon={RiAlarmWarningLine}
            title="Переработки"
            value={totalOvertimeWorks}
            subtitle={formattedTotalOvertime}
            color="warning"
            progress={overtimePercentage}
          />
        </Col>
        <Col md={3}>
          <StatCard
            icon={RiMoneyDollarCircleLine}
            title="Заработано"
            value={formatPrice(totalEarnings)}
            subtitle={`В среднем: ${formatPrice(averageEarningsPerWork)}`}
            color="success"
          />
        </Col>
        <Col md={3}>
          <StatCard
            icon={RiTimeLine}
            title="Среднее время"
            value={totalWorks > 0 ? formatOvertimeMinutes(totalOvertime / totalOvertimeWorks || 0) : "0 мин"}
            subtitle="переработки за работу"
            color="info"
          />
        </Col>
      </Row>

      {/* Detailed Statistics */}
      <Row>
        {/* Status Distribution */}
        <Col md={6}>
          <Card>
            <Card.Header>
              <h6 className="mb-0">Распределение по статусам</h6>
            </Card.Header>
            <Card.Body>
              {Object.keys(statusDistribution).length > 0 ? (
                Object.entries(statusDistribution).map(([status, count]) => {
                  const percentage = (count / totalWorks) * 100;
                  const statusNames = {
                    approved: 'Утверждён',
                    awaitingPayment: 'Ожидает оплаты',
                    pending: 'В ожидании',
                    preview: 'Превью',
                    rejected: 'Отклонён'
                  };
                  const statusColors = {
                    approved: 'success',
                    awaitingPayment: 'warning',
                    pending: 'secondary',
                    preview: 'info',
                    rejected: 'danger'
                  };

                  return (
                    <div key={status} className="mb-2">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <span>{statusNames[status] || status}</span>
                        <span className="text-muted">{count} ({percentage.toFixed(1)}%)</span>
                      </div>
                      <ProgressBar
                        variant={statusColors[status] || 'secondary'}
                        now={percentage}
                        style={{ height: '6px' }}
                      />
                    </div>
                  );
                })
              ) : (
                <p className="text-muted text-center mb-0">Нет данных</p>
              )}
            </Card.Body>
          </Card>
        </Col>

        {/* Top Companies */}
        <Col md={6}>
          <Card>
            <Card.Header>
              <h6 className="mb-0">Топ компании</h6>
            </Card.Header>
            <Card.Body>
              {topCompanies.length > 0 ? (
                topCompanies.map(([company, count], index) => {
                  const percentage = (count / totalWorks) * 100;
                  const colors = ['primary', 'secondary', 'info'];

                  return (
                    <div key={company} className="mb-2">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <span className="text-truncate" style={{ maxWidth: '200px' }}>
                          #{index + 1} {company}
                        </span>
                        <span className="text-muted">{count} ({percentage.toFixed(1)}%)</span>
                      </div>
                      <ProgressBar
                        variant={colors[index]}
                        now={percentage}
                        style={{ height: '6px' }}
                      />
                    </div>
                  );
                })
              ) : (
                <p className="text-muted text-center mb-0">Нет данных</p>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default WorkStatistics;
