import ItemCard from "../../UI/ItemCard";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Badge from "react-bootstrap/Badge";
import Image from "react-bootstrap/Image";

function UserItem({ item }) {
  const {
    firstName,
    lastName,
    profileImagePath,
    company = {},
    position,
    email,
    phone,
    isServiceAccount,
    isAdmin,
    isCloudTelephony,
  } = item;

  const Title = () => {
    return (
      <>
        <Image
          src={
            profileImagePath
              ? `${import.meta.env.VITE_ADDRESS}/uploads/${profileImagePath}`
              : "/profilepic-placeholder.jpg"
          }
          style={{ maxHeight: "50px" }}
          className="me-3"
          roundedCircle
        />
        {`${lastName} ${firstName}`}
      </>
    );
  };

  const badges = [
    { title: "сервисный аккаунт", isActive: isServiceAccount, bg: "secondary" },
    { title: "администратор", isActive: isAdmin, bg: "success" },
    { title: "телефония", isActive: isCloudTelephony, bg: "secondary" },
  ];

  return (
    <ItemCard
      detailsButton
      item={item}
      itemTitle="user"
      title={<Title />}
      badges={badges}
    >
      <Row>
        <Col>
          <Badge className="bg-secondary my-1">{company.alias}</Badge>
          <div className="py-1">
            {position ? (
              position
            ) : (
              <span className="text-secondary">Должность не указана</span>
            )}
          </div>
          <div className="py-1">
            <a href={`mailto:${email}`}>{email || ""}</a>
          </div>
          <div className="py-1">
            {phone ? (
              <a href={`tel:${phone}`}>{phone}</a>
            ) : (
              <span className="text-secondary">Телефон не указан</span>
            )}
          </div>
        </Col>
      </Row>
    </ItemCard>
  );
}

export default UserItem;
