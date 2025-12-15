import ItemCard from "../../UI/ItemCard";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Badge from "react-bootstrap/Badge";

const TicketTemplateItem = ({ item }) => {
  const { title, sharedCompanies, sharedUsers } = item;

  const Title = () => {
    return <>{title}</>;
  };

  const badges = [
    {
      title: "Общий",
      isActive: sharedCompanies.length > 0 || sharedUsers.length > 0,
      bg: "success",
    },
  ];

  return (
    <ItemCard
      item={item}
      itemTitle="ticketTemplate"
      badges={badges}
      title={<Title />}
    >
      <Row>
        <Col xs="auto">
          <Row className="py-1">
            <Col>
              Создан:
              <Badge className="bg-secondary m-1">
                {item.createdBy?.lastName &&
                item.createdBy?.firstName &&
                item.createdBy.lastName.trim() &&
                item.createdBy.firstName.trim()
                  ? `${item.createdBy.lastName} ${item.createdBy.firstName}`
                  : "Неизвестно"}
              </Badge>
            </Col>
          </Row>
          {sharedCompanies?.length > 0 && (
            <Row className="py-1">
              <Col>
                Могут использовать компании:
                {sharedCompanies.map((company) => (
                  <Badge
                    key={company._id}
                    className="bg-secondary m-1"
                  >{`${company.alias}`}</Badge>
                ))}
              </Col>
            </Row>
          )}
          {sharedUsers?.length > 0 && (
            <Row className="py-1">
              <Col>
                Могут использовать пользователи:
                {sharedUsers.map((user) => (
                  <Badge key={user._id} className="bg-secondary m-1">
                    {user.lastName &&
                    user.firstName &&
                    user.lastName.trim() &&
                    user.firstName.trim()
                      ? `${user.lastName} ${user.firstName}`
                      : "Неизвестно"}
                  </Badge>
                ))}
              </Col>
            </Row>
          )}
        </Col>
      </Row>
    </ItemCard>
  );
};

export default TicketTemplateItem;
