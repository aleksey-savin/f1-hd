import { Link, useNavigate, Outlet } from "react-router";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Table from "react-bootstrap/Table";
import Offcanvas from "react-bootstrap/Offcanvas";

import Transitions from "../../animations/Transition";

import { RiEdit2Line, RiArrowGoBackFill } from "react-icons/ri";
import useOffcanvasStore from "../../store/offcanvas";
import { AuthedUserContext } from "../../store/authed-user-context";

import AlertMessage from "../../UI/AlertMessage";
import { formatPrice } from "../../util/format-string";
import DeleteItem from "../DeleteItem";
import { useContext } from "react";

const ViewServicePlan = ({ servicePlan }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();

  const { permissions } = useContext(AuthedUserContext);

  const {
    title,
    ticketCategories,
    companyWorkSchedule,
    customProvisionSchedule,
    type = "",
    hourPackages = [],
    fixedPrice = null,
    pricePerHour = null,
    pricePerHourNonWorking = 0,
    packagesNonWorkingCalcMethod = "",
    packagesNonWorkingCoefficient = 1,
    tariffingPeriod = 10,
  } = servicePlan;

  const tariffingTypes = [
    { name: "Фиксированная оплата", value: "fixedPrice" },
    { name: "Почасовая оплата", value: "hourly" },
    { name: "Пакеты часов", value: "hourPackage" },
  ];

  return (
    <>
      <Transitions>
        <Row className="justify-content-md-end mb-3">
          <Col>
            <h1>{title}</h1>
            <hr></hr>
          </Col>
        </Row>
        <Row className="mb-3">
          <Col className="mb-3">
            <h4>Категории заявок</h4>
            {ticketCategories.map((category) => {
              return (
                <Badge key={category.title} className="mx-1">
                  {category.title}
                </Badge>
              );
            })}
          </Col>
        </Row>
        <Row className="mb-3">
          <Col className="mb-3" sm="6">
            <h4>График оказания услуги</h4>
            {companyWorkSchedule && (
              <AlertMessage
                variant="light"
                message="Согласно графику работы компании"
              />
            )}
            {!companyWorkSchedule && (
              <Table>
                <thead>
                  <tr>
                    <th>День недели</th>
                    <th>Начало</th>
                    <th>Окончание</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Понедельник</td>
                    <td>{customProvisionSchedule.Monday?.start || "-"}</td>
                    <td>{customProvisionSchedule.Monday?.end || "-"}</td>
                  </tr>
                  <tr>
                    <td>Вторник</td>
                    <td>{customProvisionSchedule.Tuesday?.start || "-"}</td>
                    <td>{customProvisionSchedule.Tuesday?.end || "-"}</td>
                  </tr>
                  <tr>
                    <td>Среда</td>
                    <td>{customProvisionSchedule.Wednesday?.start || "-"}</td>
                    <td>{customProvisionSchedule.Wednesday?.end || "-"}</td>
                  </tr>
                  <tr>
                    <td>Четверг</td>
                    <td>{customProvisionSchedule.Thursday?.start || "-"}</td>
                    <td>{customProvisionSchedule.Thursday?.end || "-"}</td>
                  </tr>
                  <tr>
                    <td>Пятница</td>
                    <td>{customProvisionSchedule.Friday?.start || "-"}</td>
                    <td>{customProvisionSchedule.Friday?.end || "-"}</td>
                  </tr>
                  <tr>
                    <td>Суббота</td>
                    <td>{customProvisionSchedule.Saturday?.start || "-"}</td>
                    <td>{customProvisionSchedule.Saturday?.end || "-"}</td>
                  </tr>
                  <tr>
                    <td>Воскресенье</td>
                    <td>{customProvisionSchedule.Sunday?.start || "-"}</td>
                    <td>{customProvisionSchedule.Sunday?.end || "-"}</td>
                  </tr>
                </tbody>
              </Table>
            )}
          </Col>
        </Row>
        <Row>
          <Col className="mb-3">
            <h4>Тарификация</h4>
            <div className="py-2">
              Тип:{" "}
              {
                tariffingTypes.filter((tariff) => tariff.value === type)?.[0]
                  .name
              }
            </div>
            {type === "fixedPrice" && (
              <Table className="m-2">
                <thead>
                  <tr>
                    <th>Общая стоимость</th>
                    <th>Стоимость часа в нерабочее время</th>
                    <th>Период тарификации</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{formatPrice(fixedPrice)}</td>
                    <td>{formatPrice(pricePerHourNonWorking)}</td>
                    <td>{tariffingPeriod} мин.</td>
                  </tr>
                </tbody>
              </Table>
            )}
            {type === "hourly" && (
              <Table className="m-2">
                <thead>
                  <tr>
                    <th>Общая стоимость</th>
                    <th>Стоимость часа в нерабочее время</th>
                    <th>Период тарификации</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{formatPrice(pricePerHour)}</td>
                    <td>{formatPrice(pricePerHourNonWorking)}</td>
                    <td>{tariffingPeriod} мин.</td>
                  </tr>
                </tbody>
              </Table>
            )}
            {type === "hourPackage" && (
              <Table className="m-2">
                <thead>
                  <tr>
                    <th>Пакет часов</th>
                    <th>Стоимость часа</th>
                    <th>Общая стоимость</th>
                    <th>Учёт часов в нерабочее время</th>
                    <th>Период тарификации</th>
                  </tr>
                </thead>
                <tbody>
                  {hourPackages.map((hoursPackage) => (
                    <tr key={hoursPackage._id.toString()}>
                      <td>{hoursPackage.hours} ч.</td>
                      <td>{formatPrice(hoursPackage.pricePerHour)}</td>
                      <td>
                        {formatPrice(
                          hoursPackage.hours * hoursPackage.pricePerHour,
                        )}
                      </td>
                      {packagesNonWorkingCalcMethod === "separatePayment" && (
                        <td>{formatPrice(pricePerHourNonWorking)} / час</td>
                      )}
                      {packagesNonWorkingCalcMethod === "coefficient" && (
                        <td>
                          Коэффициент {packagesNonWorkingCoefficient} ко времени
                          работ
                        </td>
                      )}

                      <td>{tariffingPeriod} мин.</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Col>
        </Row>
        <Row className="py-3 border-top justify-content-end gap-2">
          <Col sm="auto">
            <Button
              onClick={() => navigate("/finances/service-plans")}
              className="mb-2 w-100"
              variant="secondary"
            >
              <RiArrowGoBackFill /> К списку
            </Button>
          </Col>
          {permissions.canManageServicePlans && (
            <>
              <Col sm="auto">
                <Button
                  as={Link}
                  to={`update`}
                  className="mb-2 w-100"
                  onClick={offcanvas.show}
                >
                  <RiEdit2Line /> Изменить
                </Button>
              </Col>
              <Col sm="auto">
                <DeleteItem item={servicePlan} isButton />
              </Col>
            </>
          )}
        </Row>
        <Offcanvas
          show={offcanvas.isActive}
          onHide={() => {
            navigate(-1);
            offcanvas.setClose();
          }}
          keyboard
          placement="bottom"
          className="h-100"
        >
          <Offcanvas.Header closeButton>
            <Offcanvas.Title></Offcanvas.Title>
          </Offcanvas.Header>
          <Offcanvas.Body>
            <Outlet />
          </Offcanvas.Body>
        </Offcanvas>
      </Transitions>
    </>
  );
};

export default ViewServicePlan;
