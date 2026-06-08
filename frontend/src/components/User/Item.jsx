import ItemCard from "../../UI/ItemCard";
import ToggleActive from "./ToggleActive";

import { formatDate } from "../../util/format-date";

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
    isActive,
    lastActivity,
  } = item;

  const Title = () => {
    return (
      <>
        <Image
          src={
            profileImagePath
              ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${profileImagePath}`
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
    { title: "отключен", isActive: !isActive, bg: "danger" },
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
      extraActions={<ToggleActive item={item} />}
    >
      <Row>
        <Col>
          <Badge className="bg-secondary my-1">{company.alias}</Badge>
          <div className="py-1">
            {position ? (
              position
            ) : (
              <span className="text-body-secondary">Должность не указана</span>
            )}
          </div>
          <div className="py-1">
            <a href={`mailto:${email}`}>{email || ""}</a>
          </div>
          <div className="py-1">
            {phone ? (
              <a href={`tel:${phone}`}>{phone}</a>
            ) : (
              <span className="text-body-secondary">Телефон не указан</span>
            )}
          </div>
          <div className="py-1">
            <span className="text-body-secondary">Последняя активность: </span>
            {lastActivity?.date ? formatDate(lastActivity.date) : "—"}
          </div>
        </Col>
      </Row>
    </ItemCard>
  );
}

export default UserItem;
