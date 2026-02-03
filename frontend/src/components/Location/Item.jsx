import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import ItemCard from "../../UI/ItemCard";

function LocationItem({ item }) {
  const {
    name,
    type,
    fullPath,
    address,
    description,
    company,
    subdivision,
    isPublic,
  } = item;

  const getLocationTypeLabel = (type) => {
    const labels = {
      building: "Здание",
      floor: "Этаж",
      room: "Помещение",
      workplace: "Рабочее место",
      storage: "Склад",
    };
    return labels[type] || type;
  };

  const Title = () => {
    return (
      <>
        {name || "Без названия"}
        {fullPath && <small className="text-muted ms-2">{fullPath}</small>}
      </>
    );
  };

  const badges = [
    {
      title: getLocationTypeLabel(type),
      bg: "info",
      isActive: true,
    },
    {
      title: `${company?.alias || company?.fullTitle} ${subdivision?.name ? `| ${subdivision?.name}` : ""}`,
      bg: "secondary",
      isActive: true,
    },
    {
      title: "Общедоступное",
      bg: "success",
      isActive: isPublic,
    },
  ];

  return (
    <ItemCard
      item={item}
      itemTitle="location"
      title={<Title />}
      badges={badges}
      customDeleteMessage={`Вы уверены, что хотите удалить расположение "${name}"? Это действие нельзя отменить. Все связанные данные будут удалены.`}
    >
      <Row>
        <Col>
          {address && (
            <div className="py-1">
              <small className="text-muted">Адрес:</small>
              <br />
              <span>{address}</span>
            </div>
          )}

          {description && (
            <div className="py-1">
              <small className="text-muted">Описание:</small>
              <br />
              <span className="small">{description}</span>
            </div>
          )}
        </Col>
      </Row>
    </ItemCard>
  );
}

export default LocationItem;
