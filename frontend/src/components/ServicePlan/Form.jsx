import { useState } from "react";
import { useLoaderData } from "react-router";

import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import ToggleButton from "react-bootstrap/ToggleButton";

import Schedule from "../../UI/Schedule";
import FormWrapper from "../../UI/FormWrapper";
import Select from "../../UI/Select";
import { useEffect } from "react";

const ServicePlanForm = ({ title }) => {
  const { servicePlan = {}, ticketCategories = [] } = useLoaderData();

  const [newServicePlan, setNewServicePlan] = useState({
    title: servicePlan.title || "",
    companyWorkSchedule: servicePlan.companyWorkSchedule || false,
    ticketCategories: servicePlan.ticketCategories || [],
    tariffingPeriod: servicePlan.tariffingPeriod || 0,
    tariffingType: servicePlan.type || "fixedPrice",
    fixedPrice: servicePlan.fixedPrice ? Math.round(servicePlan.fixedPrice) : 0,
    pricePerHourNonWorking: servicePlan.pricePerHourNonWorking || 0,
    hourlyPrice: servicePlan.pricePerHour
      ? Math.round(servicePlan.pricePerHour)
      : 0,
    hourPackages: servicePlan.hourPackages
      ? servicePlan.hourPackages.map((hourPackage) => ({
          hours: hourPackage.hours,
          pricePerHour: Math.round(hourPackage.pricePerHour || 0),
          totalPrice: Math.round(hourPackage.totalPrice || 0),
        }))
      : [{ hours: 12, pricePerHour: 1, totalPrice: 0 }],
    packagesNonWorkingCalcMethod:
      servicePlan.packagesNonWorkingCalcMethod || "separatePayment",
    packagesNonWorkingCoefficient:
      servicePlan.packagesNonWorkingCoefficient || 1,
  });

  const [hourPackages, setHourPackages] = useState(
    servicePlan.hourPackages
      ? servicePlan.hourPackages.map((hourPackage) => ({
          hours: hourPackage.hours,
          pricePerHour: Math.round(hourPackage.pricePerHour || 0),
          totalPrice: Math.round(hourPackage.totalPrice || 0),
        }))
      : [{ hours: 12, pricePerHour: 1, totalPrice: 0 }],
  );

  useEffect(() => {
    const updatedPackages = hourPackages.map((hourPackage) => ({
      ...hourPackage,
      totalPrice: Math.round(hourPackage.hours * hourPackage.pricePerHour),
    }));
    setHourPackages(updatedPackages);
  }, []);

  const handleHourPackageHours = (event) => {
    const updatedHourPackages = [...hourPackages];
    const hours = parseFloat(event.target.value) || 0;
    updatedHourPackages[+event.target.name].hours = hours;

    updatedHourPackages[+event.target.name].totalPrice = Math.round(
      hours * updatedHourPackages[+event.target.name].pricePerHour,
    );
    setHourPackages(updatedHourPackages);
  };

  const handleHourPackagePrice = (event) => {
    const updatedHourPackages = [...hourPackages];
    const pricePerHour = parseFloat(event.target.value) || 0;
    updatedHourPackages[+event.target.name].pricePerHour =
      Math.round(pricePerHour);
    updatedHourPackages[+event.target.name].totalPrice = Math.round(
      pricePerHour * updatedHourPackages[+event.target.name].hours,
    );
    setHourPackages(updatedHourPackages);
  };

  const handleHourPackageTotalPrice = (event) => {
    const updatedHourPackages = [...hourPackages];
    const totalPrice = parseFloat(event.target.value) || 0;
    updatedHourPackages[+event.target.name].totalPrice = Math.round(totalPrice);
    updatedHourPackages[+event.target.name].pricePerHour = Math.round(
      totalPrice / updatedHourPackages[+event.target.name].hours || 0,
    );
    setHourPackages(updatedHourPackages);
  };

  const removeHourPackage = (event) => {
    const updatedHourPackages = hourPackages.filter(
      (_, i) => i !== +event.target.name,
    );
    setHourPackages(updatedHourPackages);
  };

  const onAddHourPackage = () => {
    setHourPackages([
      ...hourPackages,
      { hours: 0, pricePerHour: 1, totalPrice: 0 },
    ]);
  };

  const strChangeHandler = (event) => {
    setNewServicePlan({
      ...newServicePlan,
      [event.target.name]: event.target.value,
    });
  };

  const categoriesChangeHandler = (selectedItems) => {
    setNewServicePlan({
      ...newServicePlan,
      ticketCategories: selectedItems,
    });
  };

  const companyWorkScheduleChangeHandler = () => {
    setNewServicePlan({
      ...newServicePlan,
      companyWorkSchedule: !newServicePlan.companyWorkSchedule,
    });
  };

  const tariffingTypes = [
    { name: "Фиксированная оплата", value: "fixedPrice" },
    { name: "Почасовая оплата", value: "hourly" },
    { name: "Пакеты часов", value: "hourPackage" },
  ];

  const packagesNonWorkingCalcMethods = [
    { name: "Отдельная оплата", value: "separatePayment" },
    { name: "Коэффициент ко времени работ", value: "coefficient" },
  ];

  return (
    <FormWrapper title={title}>
      <Row>
        <Col xl="6">
          <Form.Group className="mb-3">
            <Form.Label htmlFor="title">
              Наименование
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Form.Control
              required
              autoFocus
              id="title"
              name="title"
              type="text"
              value={newServicePlan.title}
              onChange={strChangeHandler}
            />
          </Form.Group>
        </Col>
      </Row>
      <Row>
        <Col xl="6">
          <Form.Group className="mb-3">
            <Form.Label htmlFor="ticketCategories">
              Категории заявок
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Select
              required={ticketCategories ? true : false}
              id="ticketCategories"
              name="ticketCategories"
              placeholder="Выберите категории заявок"
              closeMenuOnSelect={false}
              isClearable
              isSearchable
              isMulti
              value={newServicePlan.ticketCategories}
              options={ticketCategories}
              getOptionLabel={(option) => `${option.title}`}
              getOptionValue={(option) => option._id}
              onChange={categoriesChangeHandler}
            />
          </Form.Group>
        </Col>
      </Row>
      <Row>
        <Form.Group className="mb-3">
          <Form.Check
            type="switch"
            id="companyWorkSchedule"
            name="companyWorkSchedule"
            label="Время оказания услуги согласно графику работы компании"
            value={newServicePlan.companyWorkSchedule}
            checked={newServicePlan.companyWorkSchedule}
            onChange={companyWorkScheduleChangeHandler}
          />
        </Form.Group>
      </Row>
      {!newServicePlan.companyWorkSchedule && (
        <Row>
          <Col xl="6">
            <Form.Label>График оказания услуги</Form.Label>
            <Schedule existingSchedule={servicePlan?.customProvisionSchedule} />
          </Col>
        </Row>
      )}

      <Row>
        <Form.Group className="mb-3">
          <Col sm="12">
            <Form.Label htmlFor="tariffingType" className="me-3">
              Тип тарификации
            </Form.Label>
          </Col>
          <Col>
            <ButtonGroup>
              {tariffingTypes.map((radio, idx) => (
                <ToggleButton
                  key={idx}
                  id={`radio-${idx}`}
                  type="radio"
                  variant={`outline-primary`}
                  name="tariffingType"
                  value={radio.value}
                  checked={newServicePlan.tariffingType === radio.value}
                  onChange={strChangeHandler}
                >
                  {radio.name}
                </ToggleButton>
              ))}
            </ButtonGroup>
          </Col>
        </Form.Group>
      </Row>

      {newServicePlan.tariffingType === "fixedPrice" && (
        <>
          <Row className="mb-3">
            <Col xs="auto">
              <Form.Label htmlFor="fixedPrice">Общая стоимость</Form.Label>
              <Form.Control
                type="number"
                id="fixedPrice"
                name="fixedPrice"
                min={1}
                value={newServicePlan.fixedPrice}
                onChange={strChangeHandler}
              />
            </Col>
          </Row>
        </>
      )}
      {newServicePlan.tariffingType === "hourly" && (
        <>
          <Row className="mb-3">
            <Col xs="auto">
              <Form.Label htmlFor="hourlyPrice">
                Стоимость часа в рабочее время
              </Form.Label>
              <Form.Control
                type="number"
                id="hourlyPrice"
                name="hourlyPrice"
                min={1}
                value={newServicePlan.hourlyPrice}
                onChange={strChangeHandler}
              />
            </Col>
          </Row>
        </>
      )}
      {newServicePlan.tariffingType === "hourPackage" && (
        <>
          <Button className="mb-3" onClick={onAddHourPackage}>
            Добавить
          </Button>
          <Row className="mb-3">
            {hourPackages.map((hourPackage) => (
              <Col xs="auto" key={`key-${hourPackages.indexOf(hourPackage)}`}>
                <Card className="mb-3">
                  <Card.Body>
                    <Row className="mb-3">
                      <Col xs="auto">
                        <Form.Label htmlFor="">Количество часов</Form.Label>
                        <Form.Control
                          type="number"
                          id={`hours-${hourPackages.indexOf(hourPackage)}`}
                          name={`${hourPackages.indexOf(hourPackage)}`}
                          min={1}
                          value={hourPackage.hours}
                          onChange={handleHourPackageHours}
                        />
                      </Col>
                    </Row>
                    <Row className="mb-3">
                      <Col xs="auto">
                        <Form.Label>Стоимость часа</Form.Label>
                        <Form.Control
                          type="number"
                          id={`price-${hourPackages.indexOf(hourPackage)}`}
                          name={`${hourPackages.indexOf(hourPackage)}`}
                          min={1}
                          value={hourPackage.pricePerHour}
                          onChange={handleHourPackagePrice}
                        />
                      </Col>
                    </Row>
                    <Row className="mb-3">
                      <Col xs="auto">
                        <Form.Label>Итоговая стоимость пакета</Form.Label>
                        <Form.Control
                          type="number"
                          id={`total-price-${hourPackages.indexOf(hourPackage)}`}
                          name={`${hourPackages.indexOf(hourPackage)}`}
                          min={1}
                          value={hourPackage.totalPrice}
                          onChange={handleHourPackageTotalPrice}
                        />
                      </Col>
                    </Row>
                    <Row className="justify-content-end">
                      <Col xs="auto">
                        <Button
                          size="sm"
                          variant="link"
                          name={`${hourPackages.indexOf(hourPackage)}`}
                          onClick={removeHourPackage}
                        >
                          Удалить
                        </Button>
                      </Col>
                    </Row>
                    <Form.Control
                      hidden
                      id="hourPackages"
                      name="hourPackages"
                      value={JSON.stringify(hourPackages)}
                      onChange={() => {
                        return;
                      }}
                    />
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>
          <Row>
            <Form.Group className="mb-3">
              <Col>
                <Form.Label>Учёт работ вне графика оказания услуги</Form.Label>
              </Col>
              <Col>
                <ButtonGroup>
                  {packagesNonWorkingCalcMethods.map((radio, idx) => (
                    <ToggleButton
                      key={idx}
                      id={`packagesRadio-${idx}`}
                      type="radio"
                      variant={`outline-primary`}
                      name="packagesNonWorkingCalcMethod"
                      value={radio.value}
                      checked={
                        newServicePlan.packagesNonWorkingCalcMethod ===
                        radio.value
                      }
                      onChange={strChangeHandler}
                    >
                      {radio.name}
                    </ToggleButton>
                  ))}
                </ButtonGroup>
              </Col>
            </Form.Group>
          </Row>
          {newServicePlan.packagesNonWorkingCalcMethod === "coefficient" && (
            <Row className="mb-3">
              <Col xs="auto">
                <Form.Label htmlFor="packagesNonWorkingCoefficient">
                  Коэффициент ко времени работ
                </Form.Label>
                <Form.Control
                  type="number"
                  id="packagesNonWorkingCoefficient"
                  name="packagesNonWorkingCoefficient"
                  value={newServicePlan.packagesNonWorkingCoefficient}
                  onChange={strChangeHandler}
                />
              </Col>
            </Row>
          )}
        </>
      )}
      {newServicePlan.packagesNonWorkingCalcMethod !== "coefficient" && (
        <Row className="mb-3">
          <Col xs="auto">
            <Form.Label htmlFor="pricePerHourNonWorking">
              Стоимость часа в нерабочее время
            </Form.Label>
            <Form.Control
              type="number"
              id="pricePerHourNonWorking"
              name="pricePerHourNonWorking"
              min={1}
              value={newServicePlan.pricePerHourNonWorking}
              onChange={strChangeHandler}
            />
          </Col>
        </Row>
      )}
      <Row className="mb-3">
        <Col xs="auto">
          <Form.Label htmlFor="tariffingPeriod">
            Период тарификации, мин.
          </Form.Label>
          <Form.Control
            type="number"
            id="tariffingPeriod"
            name="tariffingPeriod"
            min={1}
            value={newServicePlan.tariffingPeriod}
            onChange={strChangeHandler}
          />
        </Col>
      </Row>
    </FormWrapper>
  );
};

export default ServicePlanForm;
