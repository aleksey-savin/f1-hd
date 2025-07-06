import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Image from "react-bootstrap/Image";

import ItemCard from "../../UI/ItemCard";

import { RiContractLine } from "react-icons/ri";
import WorkingStatusIndicator from "./WorkingStatusIndicator";

function CompanyItem({ item }) {
  const { alias, workSchedule, profileImagePath } = item;

  const Title = () => {
    return (
      <>
        <Image
          src={
            profileImagePath
              ? `${import.meta.env.VITE_ADDRESS}/uploads/${profileImagePath}`
              : "/companypic-placeholder.png"
          }
          style={{ maxHeight: "50px" }}
          className="me-3"
          roundedCircle
        />
        {alias} {item.servicePlans.length > 0 && <RiContractLine />}
      </>
    );
  };
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
      <Row>
        <Col>
          <div className="py-1">
            <a href={item.linkToMap} target="_blank" rel="noreferrer">
              {item.address}
            </a>
          </div>
          <div className={`py-1 `}>
            <WorkingStatusIndicator workSchedule={workSchedule} />
          </div>
        </Col>
      </Row>
    </ItemCard>
  );
}

export default CompanyItem;
