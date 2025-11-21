import ItemCard from "../../UI/ItemCard";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

const DeviceTypeItem = ({ item }) => {
  const { name, description, isActive } = item;

  const Title = () => {
    return <>{name}</>;
  };

  const badges = [
    { title: "активен", isActive: isActive, bg: "success" },
    { title: "отключен", isActive: !isActive, bg: "danger" },
  ];

  return (
    <ItemCard
      item={item}
      itemTitle="deviceType"
      badges={badges}
      title={<Title />}
    >
      <Row>
        <Col>
          <div className="py-1">
            {description ? (
              <em>{description}</em>
            ) : (
              <span className="text-secondary">Описание не указано</span>
            )}
          </div>
        </Col>
      </Row>
    </ItemCard>
  );
};

export default DeviceTypeItem;
