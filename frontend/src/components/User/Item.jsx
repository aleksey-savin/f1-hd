import ItemCard from "../../UI/ItemCard";
import ToggleActive from "./ToggleActive";

import { formatDate } from "../../util/format-date";
import { getWorkStatusMeta } from "../../util/work-statuses";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Badge from "react-bootstrap/Badge";

import {
  RiBuilding2Line,
  RiMailLine,
  RiPhoneLine,
  RiTimeLine,
} from "react-icons/ri";

// Строка «иконка + значение» (центрирование и размер — в .user-item-field)
const Field = ({ icon, children }) => (
  <div className="user-item-field">
    {icon}
    <span>{children}</span>
  </div>
);

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
    isEndUser,
    isActive,
    lastActivity,
    workStatus,
    hideWorkStatus,
  } = item;

  // Статус присутствия показываем только сотрудникам — у клиентов, сервисных
  // аккаунтов, телефонии и скрытых из статусов (сторонних) его нет
  const showWorkStatus =
    !isEndUser &&
    !isServiceAccount &&
    !isCloudTelephony &&
    !hideWorkStatus &&
    isActive;
  const workStatusMeta = getWorkStatusMeta(workStatus?.code);

  const avatarSrc = profileImagePath
    ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${profileImagePath}`
    : "/profilepic-placeholder.jpg";

  // Аватар рисуем фоном на <span>, в обход глобального
  // img{ width:auto!important; height:auto!important } — иначе круг «плывёт».
  // Кольцо-статус повторяет приём со страницы пользователя: бирюза = активен.
  const Title = () => (
    <span className="d-inline-flex align-items-center gap-3">
      <span
        className={`user-mini-avatar ${isActive ? "" : "user-mini-avatar--off"}`}
        style={{ backgroundImage: `url(${avatarSrc})` }}
        role="img"
        aria-label={`${lastName} ${firstName}`}
      />
      <span>{`${lastName} ${firstName}`}</span>
    </span>
  );

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
      {/* Тело раскладываем по ширине карточки: организация / контакты /
          активность. На десктопе — три колонки, на мобильном складываются. */}
      <Row className="mt-1 g-2 gx-4">
        <Col xs={12} md={4} className="d-flex flex-column gap-1">
          {company.alias && (
            <div>
              <Badge
                bg="secondary"
                className="fw-normal d-inline-flex align-items-center gap-1"
              >
                <RiBuilding2Line /> {company.alias}
              </Badge>
            </div>
          )}
          <span className="text-body-secondary">
            {position || "Должность не указана"}
          </span>
        </Col>

        <Col xs={12} md={4} className="d-flex flex-column gap-1">
          <Field icon={<RiMailLine />}>
            {email ? (
              <a href={`mailto:${email}`}>{email}</a>
            ) : (
              <span className="text-body-secondary">Почта не указана</span>
            )}
          </Field>
          <Field icon={<RiPhoneLine />}>
            {phone ? (
              <a href={`tel:${phone}`}>{phone}</a>
            ) : (
              <span className="text-body-secondary">Телефон не указан</span>
            )}
          </Field>
        </Col>

        <Col xs={12} md={4} className="d-flex flex-column gap-1">
          {showWorkStatus && (
            <Field icon={<span aria-hidden="true">{workStatusMeta.emoji}</span>}>
              <span style={{ color: workStatusMeta.color }}>
                {workStatusMeta.label}
                {workStatus?.note && (
                  <span className="text-body-secondary">
                    {" "}
                    ({workStatus.note})
                  </span>
                )}
              </span>
            </Field>
          )}
          <Field icon={<RiTimeLine />}>
            <span className="text-body-secondary">
              Активность:{" "}
              {lastActivity?.date ? formatDate(lastActivity.date) : "—"}
            </span>
          </Field>
        </Col>
      </Row>
    </ItemCard>
  );
}

export default UserItem;
