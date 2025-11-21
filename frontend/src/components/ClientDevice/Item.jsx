import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import ItemCard from "../../UI/ItemCard";

function ClientDeviceItem({ item }) {
  const Title = () => {
    return (
      <>{`${item.deviceType?.name || "Неизвестный тип"} ${item.vendor?.name || "Неизвестный производитель"} ${item.model}`}</>
    );
  };

  const badges = [{ title: item.status, isActive: true, bg: "primary" }];

  return (
    <ItemCard
      item={item}
      title={<Title />}
      badges={badges}
      itemTitle="clientDevice"
    >
      <Row>
        <Col xs="auto">
          <Row className="py-2">
            <Col>{item.company?.alias || "Компания не указана"}</Col>
          </Row>
          <Row className="py-2">
            <Col>
              {item.user
                ? `${item.user.firstName} ${item.user.lastName}`
                : "Пользователь не назначен"}
            </Col>
          </Row>
        </Col>
      </Row>
    </ItemCard>
  );
}

export default ClientDeviceItem;
