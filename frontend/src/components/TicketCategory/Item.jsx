import ItemCard from "../../UI/ItemCard";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Badge from "react-bootstrap/Badge";

import { AuthedUserContext } from "../../store/authed-user-context";
import { useContext } from "react";

const TicketCategoryItem = ({ item }) => {
  const { title, isActive, alwaysWithinPlan, users, servicePlans } = item;

  const { permissions } = useContext(AuthedUserContext);

  const Title = () => {
    return <>{title}</>;
  };

  const badges = [
    { title: "активна", isActive: isActive, bg: "success" },
    { title: "отключена", isActive: !isActive, bg: "danger" },
    {
      title: "всегда в рамках тарифа",
      isActive: alwaysWithinPlan,
      bg: "secondary",
    },
  ];

  return (
    <ItemCard
      item={item}
      itemTitle="ticketCategory"
      badges={badges}
      title={<Title />}
    >
      <Row>
        <Col sm="auto">
          <Row className="pb-1">
            <Col>
              <em>{item.description}</em>
            </Col>
          </Row>
          {users.length > 0 && (
            <Row>
              <Col>
                Пользователи:
                {users.map((user) => (
                  <Badge
                    key={user._id}
                    className="bg-secondary m-1"
                  >{`${user.lastName} ${user.firstName}`}</Badge>
                ))}
              </Col>
            </Row>
          )}
          {users.length === 0 && (
            <Row className="pb-1">
              <Col>
                Пользователи:{" "}
                <span className="text-secondary">
                  не привязана ни к одному пользователю
                </span>
              </Col>
            </Row>
          )}
          {permissions.canUseFinancesModule && servicePlans.length > 0 && (
            <Row className="py-1">
              <Col>
                Услуги:
                {servicePlans.map((plan) => (
                  <Badge
                    key={plan._id}
                    className="bg-secondary m-1"
                  >{`${plan.title}`}</Badge>
                ))}
              </Col>
            </Row>
          )}
          {permissions.canUseFinancesModule && servicePlans.length === 0 && (
            <Row className="mb-3">
              <Col>
                Услуги:{" "}
                <span className="text-secondary">
                  не привязана ни к одной услуге
                </span>
              </Col>
            </Row>
          )}
        </Col>
      </Row>
    </ItemCard>
  );
};

export default TicketCategoryItem;
