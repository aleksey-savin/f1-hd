import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import ItemCard from "../../UI/ItemCard";
import WorkingStatusIndicator from "./WorkingStatusIndicator";

import { RiContractLine, RiMapPin2Line, RiTimeLine } from "react-icons/ri";

// Строка «иконка + значение» — общий стиль карточек списка (см. .user-item-field)
const Field = ({ icon, children }) => (
  <div className="user-item-field">
    {icon}
    <span>{children}</span>
  </div>
);

function CompanyItem({ item }) {
  const {
    alias,
    workSchedule,
    profileImagePath,
    address,
    linkToMap,
    servicePlans = [],
  } = item;

  const logoSrc = profileImagePath
    ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${profileImagePath}`
    : "/companypic-placeholder.png";

  // Логотип фоном на <span> — в обход глобального img{width/height:auto!important}.
  // Кольцо — декоративное (бирюза), как в карточке пользователя.
  const Title = () => (
    <span className="d-inline-flex align-items-center gap-3">
      <span
        className="user-mini-avatar"
        style={{ backgroundImage: `url(${logoSrc})` }}
        role="img"
        aria-label={alias}
      />
      <span className="d-inline-flex align-items-center gap-2">
        {alias}
        {servicePlans.length > 0 && (
          <RiContractLine
            className="text-primary"
            title="Есть подключённые услуги"
          />
        )}
      </span>
    </span>
  );

  const badges = [];

  return (
    <ItemCard
      item={item}
      itemTitle="company"
      title={<Title />}
      badges={badges}
      detailsButton
      customDeleteMessage="Вы уверены? Все пользователи компании также будут удалены. Это
    действие нельзя отменить."
    >
      <Row className="mt-1 g-2 gx-4">
        <Col xs={12} md={6} className="d-flex flex-column gap-1">
          <Field icon={<RiMapPin2Line />}>
            {address ? (
              <a href={linkToMap} target="_blank" rel="noreferrer">
                {address}
              </a>
            ) : (
              <span className="text-body-secondary">Адрес не указан</span>
            )}
          </Field>
        </Col>
        <Col xs={12} md={6} className="d-flex flex-column gap-1">
          <Field icon={<RiTimeLine />}>
            <WorkingStatusIndicator workSchedule={workSchedule} />
          </Field>
        </Col>
      </Row>
    </ItemCard>
  );
}

export default CompanyItem;
