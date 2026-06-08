import { Link } from "react-router";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Dropdown from "react-bootstrap/Dropdown";

import { RiShoppingCartLine, RiToolsLine } from "react-icons/ri";

import ItemCard from "../../UI/ItemCard";
import useOffcanvasStore from "../../store/offcanvas";

const STATUS_LABELS = {
  readyForDeployment: "Готово к выдаче",
  deployed: "Выдано",
  inRepair: "В ремонте",
  decommissioned: "Выведено из эксплуатации",
  inReserve: "В резерве",
  disposed: "Утилизировано",
};

function ClientDeviceItem({ item }) {
  const offcanvas = useOffcanvasStore();

  const model = item.deviceModelId;
  const vendorName = model?.vendorId?.name;
  const typeName = model?.deviceTypeId?.name;

  const Title = () => (
    <>
      {[typeName, vendorName, model?.name].filter(Boolean).join(" ") ||
        "Устройство"}
    </>
  );

  const badges = [
    {
      title: STATUS_LABELS[item.status] || item.status || "—",
      isActive: true,
      bg: "primary",
    },
  ];

  const extraActions = (
    <>
      <Dropdown.Item
        as={Link}
        to={`purchase/${item._id}`}
        onClick={offcanvas.setShow}
      >
        <RiShoppingCartLine /> Покупка
      </Dropdown.Item>
      <Dropdown.Item
        as={Link}
        to={`tech/${item._id}`}
        onClick={offcanvas.setShow}
      >
        <RiToolsLine /> Тех. информация
      </Dropdown.Item>
      <Dropdown.Divider />
    </>
  );

  return (
    <ItemCard
      item={item}
      title={<Title />}
      badges={badges}
      itemTitle="clientDevice"
      extraActions={extraActions}
    >
      <Row>
        <Col xs="auto">
          <Row className="py-2">
            <Col>{item.companyId?.alias || "Компания не указана"}</Col>
          </Row>
          <Row className="py-2">
            <Col>
              {item.userId
                ? `${item.userId.firstName} ${item.userId.lastName}`
                : item.locationId?.name || "Не назначено"}
            </Col>
          </Row>
          {item.supplierId?.name && (
            <Row className="py-2">
              <Col className="text-muted small">
                Поставщик: {item.supplierId.name}
              </Col>
            </Row>
          )}
        </Col>
      </Row>
    </ItemCard>
  );
}

export default ClientDeviceItem;
