import { Row, Col, Table, Button } from "react-bootstrap";
import { NavLink } from "react-router";
import AlertMessage from "../../../UI/AlertMessage";
import { formatShortDate } from "../../../util/format-date";
import { formatPrice } from "../../../util/format-string";
import DeleteServicePlan from "../DeleteServicePlan";

const ServicePlansSection = ({
  servicePlans,
  company,
  permissions,
  handleShow,
}) => {
  return (
    <>
      <Row>
        <Col sm="12">
          <h4>Услуги</h4>
          {servicePlans.length === 0 && (
            <AlertMessage variant="light" message="Услуги не подключены" />
          )}
          {servicePlans.length > 0 && (
            <Table responsive>
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th>Действует с</th>
                  <th>Тип тарификации</th>
                  <th>Стоимость</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {servicePlans.map((plan) => {
                  return (
                    <tr key={plan._id.toString()}>
                      <td data-cell="Наименование">
                        <NavLink
                          to={`/finances/service-plans/${plan._id.toString()}`}
                        >
                          {plan.title}
                        </NavLink>
                      </td>
                      <td data-cell="Действует с">
                        {formatShortDate(plan.isActiveSince)}
                      </td>
                      <td data-cell="Тип тарификации">
                        {plan.tariffing.type === "hourPackage" &&
                          "Пакеты часов"}
                        {plan.tariffing.type === "hourly" && "Почасовая оплата"}
                        {plan.tariffing.type === "fixedPrice" &&
                          "Фиксированная оплата"}
                      </td>
                      <td data-cell="Стоимость">
                        {plan.tariffing.type === "hourPackage" && (
                          <>
                            {plan.tariffing.hourPackage.packages.map(
                              (hourPackage) => (
                                <li key={hourPackage.hours}>
                                  {`${hourPackage.hours} ч. * ${formatPrice(hourPackage.pricePerHour)}  = ${formatPrice(hourPackage.pricePerHour * hourPackage.hours)}`}
                                </li>
                              ),
                            )}
                          </>
                        )}
                        {plan.tariffing.type === "hourly" && (
                          <>{`${formatPrice(plan.tariffing.hourly.pricePerHour)} / час`}</>
                        )}
                        {plan.tariffing.type === "fixedPrice" && (
                          <>{`${formatPrice(plan.tariffing.fixedPrice.price)}`}</>
                        )}
                      </td>
                      <td data-cell="Действия">
                        {permissions.canManageServicePlans && (
                          <DeleteServicePlan
                            servicePlan={plan}
                            companyId={company._id.toString()}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          {permissions.canManageServicePlans && (
            <Button variant="primary" size="sm" onClick={handleShow}>
              Добавить услугу
            </Button>
          )}
        </Col>
      </Row>
    </>
  );
};

export default ServicePlansSection;
