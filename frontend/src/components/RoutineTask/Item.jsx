import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Badge from "react-bootstrap/Badge";

import ItemCard from "../../UI/ItemCard";

import { formatDate } from "../../util/format-date";
import { getNextCronDate } from "../../util/time-helpers";

function RoutineTaskItem({ item }) {
  const Title = () => {
    return <>{`${item.title}`}</>;
  };

  const badges = [
    { title: "активно", isActive: item.isActive, bg: "success" },
    { title: "отключено", isActive: !item.isActive, bg: "danger" },
  ];

  return (
    <ItemCard
      item={item}
      itemTitle="routineTask"
      badges={badges}
      title={<Title />}
    >
      <Row>
        <Col>
          <Badge className="my-1" bg="secondary">
            {item.company?.alias}
          </Badge>
          <div className="py-1">Категория: {item.category.title}</div>
          <div className="pt-1">Расписание cron: {item.cronSchedule}</div>
          {item.isActive && (
            <div className="pt-1 text-success">
              {`Следующая заявка ${formatDate(getNextCronDate(item.cronSchedule))}`}
            </div>
          )}
        </Col>
      </Row>
    </ItemCard>
  );
}

export default RoutineTaskItem;
