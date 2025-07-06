import { BrowserView, MobileView } from "react-device-detect";
import { Link } from "react-router";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Dropdown from "react-bootstrap/Dropdown";
import DropdownButton from "react-bootstrap/DropdownButton";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Button from "react-bootstrap/Button";

import { AiOutlinePlusCircle } from "react-icons/ai";
import { SlActionRedo } from "react-icons/sl";

import ScheduleWorkDashboard from "../Work/AddScheduledDashboard";

const Actions = ({ globalActions, personalActions, tickets, responsibles }) => {
  return (
    (globalActions || personalActions) && (
      <>
        <BrowserView>
          <Row className="mb-3 pb-3 border-bottom">
            <h1 className="display-5">
              <SlActionRedo /> Действия
            </h1>
            {/*<Col sm="auto">
              <ScheduleWorkDashboard
                tickets={tickets}
                responsibles={responsibles}
              />
            </Col> */}

            <Col sm="auto">
              <Button
                as={Link}
                to={`/tickets/add`}
                size="lg"
                className="w-100 my-3"
              >
                <AiOutlinePlusCircle size="1.3em" /> Заявка
              </Button>
            </Col>
            <Col sm="auto">
              <Button
                as={Link}
                to={`/users/add`}
                size="lg"
                className="w-100 my-3"
              >
                <AiOutlinePlusCircle size="1.3em" /> Пользователь
              </Button>
            </Col>
            <Col sm="auto">
              <Button
                as={Link}
                to={`/routine-tasks/add`}
                size="lg"
                className="w-100 my-3"
              >
                <AiOutlinePlusCircle size="1.3em" /> Регламентное задание
              </Button>
            </Col>
          </Row>
        </BrowserView>
        <MobileView>
          <Row className="mb-3 pb-3 border-bottom">
            <h1 className="display-5">
              <SlActionRedo /> Действия
            </h1>
            <DropdownButton
              as={ButtonGroup}
              title={
                <strong>
                  <AiOutlinePlusCircle size="1.3em" /> Добавить
                </strong>
              }
              className="w-100 pb-0 mb-2"
              drop="down-centered"
              size="lg"
            >
              <h5>
                <ScheduleWorkDashboard
                  buttonType="dropdown"
                  tickets={tickets}
                  responsibles={responsibles}
                />
                <Dropdown.Item
                  as={Link}
                  to={`/tickets/add`}
                  size="lg"
                  className="w-100 my-3"
                >
                  Заявка
                </Dropdown.Item>

                <Dropdown.Item
                  as={Link}
                  to={`/users/add`}
                  size="lg"
                  className="w-100 my-3"
                >
                  Пользователь
                </Dropdown.Item>
                <Dropdown.Item
                  as={Link}
                  to={`/routine-tasks/add`}
                  size="lg"
                  className="w-100 mt-3"
                >
                  Регламентное задание
                </Dropdown.Item>
              </h5>
            </DropdownButton>
          </Row>
        </MobileView>
      </>
    )
  );
};

export default Actions;
