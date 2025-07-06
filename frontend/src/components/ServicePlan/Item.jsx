import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import Badge from "react-bootstrap/Badge";

import ItemCard from "../../UI/ItemCard";

function ServicePlanItem({ item }) {
  const tariffingTypes = [
    { name: "Фиксированная оплата", value: "fixedPrice" },
    { name: "Почасовая оплата", value: "hourly" },
    { name: "Пакеты часов", value: "hourPackage" },
  ];

  const Title = () => {
    return <>{item.title}</>;
  };

  const badges = [];

  return (
    <ItemCard
      item={item}
      itemTitle="servicePlan"
      detailsButton
      title={<Title />}
      badges={badges}
    >
      <Row>
        <Col sm={9}>
          <Row className="py-2">
            <Col>
              {
                tariffingTypes.filter(
                  (tariff) => item.tariffing?.type === tariff.value,
                )[0]?.name
              }
            </Col>
          </Row>
          {item.companies.length > 0 && (
            <Row className="py-2">
              <Col>
                Компании:{" "}
                {item.companies.map((company) => (
                  <Badge
                    bg="secondary"
                    key={company._id.toString()}
                    className="mx-2"
                  >
                    {company.alias}
                  </Badge>
                ))}
              </Col>
            </Row>
          )}
        </Col>
      </Row>
    </ItemCard>
  );
}

export default ServicePlanItem;
