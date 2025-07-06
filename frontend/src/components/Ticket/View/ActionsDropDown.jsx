import { useContext } from "react";

import Col from "react-bootstrap/Col";
import Dropdown from "react-bootstrap/Dropdown";
import DropdownButton from "react-bootstrap/DropdownButton";
import ButtonGroup from "react-bootstrap/ButtonGroup";

import { RiEdit2Line } from "react-icons/ri";

import RequestHelp from "../Actions/RequestHelp";
import UpdateDeadline from "../Actions/UpdateDeadline";
import RejectTicket from "../Actions/Reject";
import UpdateTicketChecklist from "../Checklist/Update";
import DeleteItem from "../../DeleteItem";

import { AuthedUserContext } from "../../../store/authed-user-context";
import useOffcanvasStore from "../../../store/offcanvas";
import { Link } from "react-router";

const ActionDropdown = ({ ticket, isOverdue, setIsOverdue, responsibles }) => {
  const { isEndUser, permissions, _id: userId } = useContext(AuthedUserContext);

  const { canEditTickets, canDeleteTickets, canPerformTickets } = permissions;

  const offcanvas = useOffcanvasStore();

  const items = [
    {
      component: (
        <RequestHelp
          key="request-help"
          ticket={ticket}
          responsibles={responsibles}
        />
      ),
      isActive:
        !ticket.isClosed &&
        canPerformTickets &&
        ticket.responsibles.map((user) => user._id.toString()).includes(userId),
    },
    {
      component: (
        <UpdateDeadline
          key="update-deadline"
          ticket={ticket}
          isOverdue={isOverdue}
          setIsOverdue={setIsOverdue}
        />
      ),
      isActive:
        canPerformTickets &&
        ticket.responsibles
          .map((user) => user._id.toString())
          .includes(userId) &&
        ticket.state !== "Выполнена" &&
        ticket.state !== "Закрыта",
    },
    {
      component: (
        <RejectTicket type="dropdown" key="reject-ticket" ticket={ticket} />
      ),
      isActive:
        canPerformTickets &&
        ticket.responsibles
          .map((user) => user._id.toString())
          .includes(userId) &&
        ticket.state !== "Закрыта",
    },
    {
      component: (
        <UpdateTicketChecklist key="update-checklist" ticket={ticket} />
      ),
      isActive:
        canPerformTickets &&
        !ticket.isClosed &&
        !isEndUser &&
        ticket.responsibles.map((user) => user._id.toString()).includes(userId),
    },
    {
      component: <Dropdown.Divider key="divider" />,
      isActive:
        (canEditTickets || canDeleteTickets) &&
        ticket.responsibles.map((user) => user._id.toString()).includes(userId),
    },
    {
      component: (
        <Dropdown.Item
          as={Link}
          to="update"
          key="update"
          onClick={offcanvas.setShow}
        >
          <RiEdit2Line /> Изменить
        </Dropdown.Item>
      ),
      isActive: canEditTickets,
    },
    {
      component: <Dropdown.Divider key="divider-2" />,
      isActive: !ticket.isClosed,
      isDivider: true,
    },
    {
      component: <DeleteItem key="delete-ticket" item={ticket} />,
      isActive: canDeleteTickets,
    },
  ];

  return (
    <>
      {!isEndUser &&
        items.filter((item) => item.isActive && !item.isDivider).length > 0 && (
          <Col sm="auto">
            <DropdownButton
              as={ButtonGroup}
              title={<strong>Дополнительно</strong>}
              className="w-100 pb-0 mb-2"
              align="end"
              size="lg"
            >
              <h5>
                {items
                  .filter((item) => item.isActive)
                  .map((item) => item.component)}
              </h5>
            </DropdownButton>
          </Col>
        )}
    </>
  );
};

export default ActionDropdown;
