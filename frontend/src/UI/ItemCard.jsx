import { useState, useContext } from "react";
import { Link } from "react-router";

import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import Dropdown from "react-bootstrap/Dropdown";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Badge from "react-bootstrap/Badge";

import useOffcanvasStore from "../store/offcanvas";
import { HiOutlineMagnifyingGlass } from "react-icons/hi2";
import { RiEdit2Line } from "react-icons/ri";
import DeleteItem from "../components/DeleteItem";

import { AuthedUserContext } from "../store/authed-user-context";

const ItemCard = ({
  item,
  itemTitle,
  title = "",
  badges = [],
  isSelected,
  detailsButton,
  danger,
  customDeleteMessage,
  children,
  onClick,
}) => {
  const offcanvas = useOffcanvasStore();

  const { _id: userId, permissions } = useContext(AuthedUserContext);

  const actionsAreActive =
    itemTitle === "clientDevice"
      ? permissions.canManageClientDevices
      : itemTitle === "company"
        ? permissions.canManageCompanies
        : itemTitle === "routineTask"
          ? permissions.canManageRoutineTasks
          : itemTitle === "servicePlan"
            ? permissions.canManageServicePlans
            : itemTitle === "ticket"
              ? permissions.canEditTickets || permissions.canDeleteTickets
              : itemTitle === "ticketCategory"
                ? permissions.canManageTicketCategories
                : itemTitle === "user"
                  ? permissions.canManageUsers
                  : itemTitle === "ticketTemplate"
                    ? permissions.canManageTicketTemplates ||
                      item.createdBy.toString() === userId
                    : false;

  const [isNew, setIsNew] = useState(
    new Date() - new Date(item.createdAt) < 10000 ? true : false,
  );

  setTimeout(() => {
    setIsNew(false);
  }, 15000);

  return (
    <Card
      className={`mb-3 shadow-sm ${
        isNew
          ? "bg-success bg-opacity-10"
          : danger
            ? "bg-danger bg-opacity-10"
            : ""
      } ${isSelected ? "border-primary" : ""}`}
      onClick={onClick || (() => {})}
    >
      <Card.Body>
        <Row className="justify-content-between">
          <Col xs="auto">
            <h4>{title}</h4>
          </Col>
          <Col xs="auto">
            {badges
              .filter((badge) => badge.isActive)
              .map((badge) => (
                <Badge key={badge.title} bg={badge.bg} className="ms-1">
                  {badge.title}
                </Badge>
              ))}
          </Col>
        </Row>
        <Row>
          <Col>{children}</Col>
          <Col sm="auto" className="align-content-end">
            <Row className="justify-content-end mt-2">
              {detailsButton && (
                <Col xs="auto" className="pe-1">
                  <Button
                    as={Link}
                    to={`${itemTitle === "ticket" ? "/tickets/" + item.num : item._id}`}
                  >
                    <HiOutlineMagnifyingGlass />
                  </Button>
                </Col>
              )}
              {actionsAreActive && (
                <Col xs="auto" className="ps-1">
                  <Dropdown>
                    <Dropdown.Toggle>Действия</Dropdown.Toggle>
                    <Dropdown.Menu>
                      {(itemTitle !== "ticket" ||
                        permissions.canEditTickets) && (
                        <Dropdown.Item
                          as={Link}
                          to={`${itemTitle === "ticket" ? "/tickets/" + +item.num + "/update" : "update/" + item._id}`}
                          onClick={offcanvas.setShow}
                        >
                          <RiEdit2Line /> Изменить
                        </Dropdown.Item>
                      )}
                      {(itemTitle !== "ticket" ||
                        permissions.canDeleteTickets) && (
                        <DeleteItem
                          customDeleteMessage={customDeleteMessage}
                          item={item}
                        />
                      )}
                    </Dropdown.Menu>
                  </Dropdown>
                </Col>
              )}
            </Row>
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
};

export default ItemCard;
