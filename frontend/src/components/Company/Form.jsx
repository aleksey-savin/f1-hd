import { useState, useRef } from "react";

import { useLoaderData } from "react-router";

import Select from "../../UI/Select";

import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import FormWrapper from "../../UI/FormWrapper";
import PhoneInput from "../../UI/PhoneInput";
import Schedule from "../../UI/Schedule";

const CompanyForm = ({ title }) => {
  const { company, responsibles: responsiblesList } = useLoaderData();

  const alias = useRef();
  const fullTitle = useRef();
  const address = useRef();
  const linkToMap = useRef();
  const domains = useRef();

  const [responsibles, setResponsibles] = useState(company?.responsibles || []);
  const [clientsSideResponsibles, setClientsSideResponsibles] = useState(
    company?.clientsSideResponsibles || [],
  );

  const responsiblesChangeHandler = (selectedItems) => {
    setResponsibles(selectedItems);
  };

  const clientsSideResponsiblesChangeHandler = (selectedItems) => {
    setClientsSideResponsibles(selectedItems);
  };

  const [phoneNumber, setPhoneNumber] = useState(company?.phones[0]);

  return (
    <FormWrapper title={title}>
      <Row>
        <Col xl="6">
          <Form.Group className="mb-3">
            <Form.Label htmlFor="alias">
              Короткое наименование
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Form.Control
              required
              autoFocus
              id="alias"
              name="alias"
              type="text"
              defaultValue={company?.alias || ""}
              ref={alias}
            />
          </Form.Group>
        </Col>
      </Row>
      <Row>
        <Col xl="6">
          <Form.Group className="mb-3">
            <Form.Label htmlFor="fullTitle">
              Полное наименование
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Form.Control
              required
              id="fullTitle"
              name="fullTitle"
              type="text"
              defaultValue={company?.fullTitle || ""}
              ref={fullTitle}
            />
          </Form.Group>
        </Col>
      </Row>
      <Row>
        <Col xl="6">
          <Form.Group className="mb-3">
            <Form.Label htmlFor="domains">Почтовые домены</Form.Label>
            <Form.Control
              id="emailDomains"
              name="emailDomains"
              type="text"
              placeholder={"Введите через запятую без @"}
              defaultValue={company?.emailDomains}
              ref={domains}
            />
          </Form.Group>
        </Col>
      </Row>
      <Row>
        <Col xl="6">
          <Form.Group className="mb-3 w-100">
            <Form.Label htmlFor="phones">Телефон</Form.Label>
            <PhoneInput
              id="phones"
              name="phones"
              setValue={setPhoneNumber}
              value={phoneNumber}
            />
          </Form.Group>
        </Col>
      </Row>
      <Row>
        <Col xl="6">
          <Form.Group className="mb-3 w-100">
            <Form.Label htmlFor="phones">Адрес</Form.Label>
            <Form.Control
              id="address"
              name="address"
              defaultValue={company?.address}
              ref={address}
            />
          </Form.Group>
        </Col>
      </Row>
      <Row>
        <Col xl="6">
          <Form.Group className="mb-3 w-100">
            <Form.Label htmlFor="phones">Ссылка на карту</Form.Label>
            <Form.Control
              id="linkToMap"
              name="linkToMap"
              defaultValue={company?.linkToMap}
              ref={linkToMap}
            />
          </Form.Group>
        </Col>
      </Row>
      <Row>
        <Col xl="6">
          <Form.Group className="mb-3">
            <Form.Label htmlFor="responsibles">
              Ответственные
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Select
              required={responsiblesList ? true : false}
              id="responsibles"
              name="responsibles"
              placeholder="Выберите пользователей"
              closeMenuOnSelect={false}
              isClearable
              isSearchable
              isMulti
              value={responsibles}
              options={responsiblesList}
              getOptionLabel={(option) =>
                `${option.lastName} ${option.firstName}`
              }
              getOptionValue={(option) => option._id}
              onChange={responsiblesChangeHandler}
            />
          </Form.Group>
        </Col>
      </Row>
      {company && (
        <Row>
          <Col xl="6">
            <Form.Group className="mb-3">
              <Form.Label htmlFor="clientsSideResponsibles">
                Ответственные со стороны клиента
              </Form.Label>
              <Select
                id="clientsSideResponsibles"
                name="clientsSideResponsibles"
                placeholder="Выберите пользователей"
                closeMenuOnSelect={false}
                isClearable
                isSearchable
                isMulti
                value={clientsSideResponsibles}
                options={company?.employees || []}
                getOptionLabel={(option) =>
                  `${option.lastName} ${option.firstName}`
                }
                getOptionValue={(option) => option._id}
                onChange={clientsSideResponsiblesChangeHandler}
              />
            </Form.Group>
          </Col>
        </Row>
      )}
      <Row>
        <Col xl="6">
          <Form.Label>График работы</Form.Label>
          <Schedule existingSchedule={company?.workSchedule} />
        </Col>
      </Row>
    </FormWrapper>
  );
};

export default CompanyForm;
