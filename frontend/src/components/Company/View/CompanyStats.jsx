import Card from "react-bootstrap/Card";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Badge from "react-bootstrap/Badge";
import ProgressBar from "react-bootstrap/ProgressBar";

import {
  RiArrowUpLine,
  RiArrowDownLine,
  RiSubtractLine,
  RiFileList3Line,
  RiTimeLine,
  RiGroupLine,
  RiChat3Line,
} from "react-icons/ri";

import { msToHMS } from "../../../util/time-helpers";

// Округление среднего до 1 знака для подписи сравнения.
const round1 = (n) => Math.round(n * 10) / 10;

const renderChangeIcon = (direction) => {
  switch (direction) {
    case "up":
      return <RiArrowUpLine className="text-success me-1" />;
    case "down":
      return <RiArrowDownLine className="text-danger me-1" />;
    default:
      return <RiSubtractLine className="text-muted me-1" />;
  }
};

const changeBg = (direction) =>
  direction === "up" ? "success" : direction === "down" ? "danger" : "secondary";

// Блок «дельта к среднему за год»: стрелка + бейдж с % + пояснение базы.
// Цвет — по направлению (как на странице аналитики), плюс иконка и текст,
// чтобы смысл считывался не только цветом (доступность).
const ChangeIndicator = ({ direction, percentage, baselineLabel, days }) => (
  <>
    <div className="d-flex align-items-center mt-2">
      {renderChangeIcon(direction)}
      <Badge bg={changeBg(direction)}>
        {percentage === null
          ? "—"
          : `${percentage > 0 ? "+" : ""}${percentage}%`}
      </Badge>
    </div>
    <div className="text-body-secondary mt-1" style={{ fontSize: "0.78em" }}>
      ср. за 1–{days} прошлых мес.: {baselineLabel}
    </div>
  </>
);

const StatCard = ({ icon, title, children }) => (
  <Col xs={12} sm={6} xl={3}>
    <Card className="border-0 shadow-sm h-100">
      <Card.Body>
        <div className="cap-card-title mb-3">
          {icon}
          <span>{title}</span>
        </div>
        {children}
      </Card.Body>
    </Card>
  </Col>
);

const CompanyStats = ({ stats }) => {
  if (!stats) {
    return (
      <Row className="g-3 mb-4">
        <Col xs={12}>
          <Card className="border-0 shadow-sm">
            <Card.Body className="text-center text-body-secondary">
              Статистика временно недоступна
            </Card.Body>
          </Card>
        </Col>
      </Row>
    );
  }

  const { period, tickets, time, users, channels } = stats;
  const days = period.daysElapsed;

  const activePct = users.total ? (users.active / users.total) * 100 : 0;
  const deadPct = users.total ? (users.dead / users.total) * 100 : 0;

  return (
    <Row className="g-3 mb-4">
      {/* Заявки в этом месяце */}
      <StatCard icon={<RiFileList3Line />} title="Заявки в этом месяце">
        <div className="fs-2 fw-semibold lh-1">{tickets.current}</div>
        <ChangeIndicator
          direction={tickets.direction}
          percentage={tickets.percentage}
          baselineLabel={round1(tickets.baselineAvg)}
          days={days}
        />
      </StatCard>

      {/* Затраченное время в этом месяце */}
      <StatCard icon={<RiTimeLine />} title="Время в этом месяце">
        <div className="fs-2 fw-semibold lh-1">{msToHMS(time.current)}</div>
        <ChangeIndicator
          direction={time.direction}
          percentage={time.percentage}
          baselineLabel={msToHMS(time.baselineAvg)}
          days={days}
        />
        <div className="text-body-secondary mt-2" style={{ fontSize: "0.78em" }}>
          Выезды {msToHMS(time.onSite.current)} · Удалённо{" "}
          {msToHMS(time.remote.current)}
        </div>
      </StatCard>

      {/* Активные vs «мёртвые» пользователи */}
      <StatCard icon={<RiGroupLine />} title="Пользователи">
        {users.total === 0 ? (
          <div className="text-body-secondary">Нет пользователей</div>
        ) : (
          <>
            <div className="fs-2 fw-semibold lh-1">
              {users.active}
              <span className="fs-5 text-body-secondary"> / {users.total}</span>
            </div>
            <div className="text-body-secondary mb-2" style={{ fontSize: "0.78em" }}>
              активных за 90 дней
            </div>
            <ProgressBar className="mb-1" style={{ height: 8 }}>
              <ProgressBar variant="success" now={activePct} key={1} />
              <ProgressBar variant="secondary" now={deadPct} key={2} />
            </ProgressBar>
            <div className="d-flex justify-content-between small">
              <span className="text-success">Активные: {users.active}</span>
              <span className="text-body-secondary">
                Мёртвые: {users.dead}
              </span>
            </div>
          </>
        )}
      </StatCard>

      {/* Основной канал связи */}
      <StatCard icon={<RiChat3Line />} title="Основной канал">
        {!channels.primary || channels.total === 0 ? (
          <div className="text-body-secondary">Нет заявок за год</div>
        ) : (
          <>
            <div className="fs-4 fw-semibold lh-1">
              {channels.primary.source}
            </div>
            <div className="text-body-secondary mb-3" style={{ fontSize: "0.78em" }}>
              {channels.primary.percentage}% заявок ({channels.primary.count} из{" "}
              {channels.total})
            </div>
            {channels.breakdown.map((channel) => (
              <div key={channel.source} className="mb-2">
                <div className="d-flex justify-content-between small">
                  <span>{channel.source}</span>
                  <span className="text-body-secondary">
                    {channel.count} · {channel.percentage}%
                  </span>
                </div>
                <ProgressBar
                  now={channel.percentage}
                  variant="info"
                  style={{ height: 5 }}
                />
              </div>
            ))}
          </>
        )}
      </StatCard>
    </Row>
  );
};

export default CompanyStats;
