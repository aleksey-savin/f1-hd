import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Row from "react-bootstrap/Row";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";

import { computeDelta, formatMinutes } from "./format";

const DeltaChip = ({ current, previous, invert }) => {
  const { direction, percent } = computeDelta(current, previous);
  if (direction === "same" || percent === null) {
    return null;
  }
  // invert: для переработок рост не «успех», держим нейтральный тон
  const tone = invert
    ? "text-body-secondary"
    : direction === "up"
      ? "text-success"
      : "text-danger";
  return (
    <OverlayTrigger
      placement="top"
      overlay={<Tooltip>Относительно прошлого периода той же длины</Tooltip>}
    >
      <span className={`pr-kpi__delta ${tone}`}>
        {direction === "up" ? "▲" : "▼"} {Math.abs(percent)}%
      </span>
    </OverlayTrigger>
  );
};

const KpiCards = ({ totals, prevTotals, daysWithWork }) => {
  const cards = [
    {
      key: "time",
      label: "Отработано",
      value: formatMinutes(totals.totalMinutes),
      sub:
        totals.normMinutes > 0
          ? `норма ${formatMinutes(totals.normMinutes)} · ${totals.utilizationPercent}%`
          : null,
      current: totals.totalMinutes,
      previous: prevTotals?.totalMinutes,
    },
    {
      key: "overtime",
      label: "Переработки",
      value: formatMinutes(totals.overtime.roundedMinutes),
      valueClass: totals.overtime.roundedMinutes > 0 ? "pr-kpi__value--ot" : "",
      sub:
        totals.overtime.roundedMinutes > 0
          ? `будни ${formatMinutes(totals.overtime.weekdayMinutes)} · выходные ${formatMinutes(totals.overtime.weekendMinutes)}`
          : "за период не было",
      current: totals.overtime.roundedMinutes,
      previous: prevTotals?.overtime?.roundedMinutes,
      invert: true,
    },
    {
      key: "works",
      label: "Работы",
      value: totals.worksCount,
      sub: daysWithWork > 0 ? `дней с работами: ${daysWithWork}` : null,
      current: totals.worksCount,
      previous: prevTotals?.worksCount,
    },
    {
      key: "tickets",
      label: "Заявок закрыто",
      value: totals.ticketsFinished,
      sub: null,
      current: totals.ticketsFinished,
      previous: prevTotals?.ticketsFinished,
    },
    {
      key: "onsite",
      label: "Выезды",
      value: totals.onSite.count,
      sub:
        totals.onSite.count > 0
          ? formatMinutes(totals.onSite.minutes)
          : "только удалённо",
      current: totals.onSite.count,
      previous: prevTotals?.onSite?.count,
    },
  ];

  return (
    <Row className="g-3 mb-3">
      {cards.map((card) => (
        <Col key={card.key} xs={6} md={4} xl>
          <Card className="h-100 pr-kpi">
            <Card.Body>
              <div className="pr-kpi__label">{card.label}</div>
              <div className={`pr-kpi__value ${card.valueClass || ""}`}>
                {card.value}
              </div>
              <div className="pr-kpi__foot">
                <DeltaChip
                  current={card.current}
                  previous={card.previous}
                  invert={card.invert}
                />
                {card.sub && <span className="pr-kpi__sub">{card.sub}</span>}
              </div>
            </Card.Body>
          </Card>
        </Col>
      ))}
    </Row>
  );
};

export default KpiCards;
