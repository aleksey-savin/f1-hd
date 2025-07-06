import { useState } from "react";

import Select from "../../UI/Select";
import Editor from "../../UI/Editor";

import UpdateChecklist from "../Checklist/Update";

import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import FormWrapper from "../../UI/FormWrapper";
import { useLoaderData } from "react-router";

const RoutineTaskForm = (props) => {
  const { task, companiesList, serviceAccounts, categoriesList } =
    useLoaderData();

  const [formData, setFormData] = useState({
    title: task?.title || "",
    description: task?.description || "",
    company: task?.company || "",
    applicant: task?.applicant || "",
    category: task?.category || "",
    cronSchedule: task?.cronSchedule || "",
    isActive: task?.isActive || true,
    checklist: task?.checklist || [],
  });

  const strFormDataHandler = (event) => {
    setFormData({
      ...formData,
      [event.target.name]: event.target.value,
    });
  };

  const descriptionHandler = (state) => {
    setFormData({
      ...formData,
      description: state,
    });
  };

  const switchFormDataHandler = () => {
    setFormData({
      ...formData,
      isActive: !formData.isActive,
    });
  };

  const companyHandler = (selectedItem) => {
    setFormData({
      ...formData,
      company: selectedItem,
    });
  };

  const applicantHandler = (selectedItem) => {
    setFormData({
      ...formData,
      applicant: selectedItem,
    });
  };

  const categoryHandler = (selectedItem) => {
    setFormData({
      ...formData,
      category: selectedItem,
    });
  };

  const updateChecklist = (checklist) => {
    setFormData({ ...formData, checklist: checklist });
  };

  return (
    <>
      <FormWrapper title={props.title} navigateTo="/routine-tasks">
        <Row>
          <Col xl="6">
            <Form.Group className="w-100 mb-3">
              <Form.Label htmlFor="title">Тема</Form.Label>
              <Form.Control
                autoFocus
                required
                id="title"
                name="title"
                type="text"
                value={formData.title}
                onChange={strFormDataHandler}
              />
            </Form.Group>
          </Col>
        </Row>
        <Row>
          <Col xl="6">
            <Form.Group className="mb-3">
              <Form.Label htmlFor="description">Описание</Form.Label>
              <Editor
                id="description"
                required
                changeHandler={descriptionHandler}
                description={formData.description}
              />
              <input
                type="text"
                name="description"
                value={formData.description}
                onChange={() => {
                  return;
                }}
                hidden
              />
            </Form.Group>
          </Col>
        </Row>
        <Row>
          <Col xl="6">
            <Form.Group className="w-100 mb-3">
              <Form.Label htmlFor="company">Компания</Form.Label>
              <Select
                id="company"
                name="company"
                placeholder="Выберите компанию"
                required
                isClearable
                isSearchable
                value={formData.company}
                options={companiesList}
                getOptionLabel={(option) => `${option.alias}`}
                getOptionValue={(option) => option._id}
                onChange={companyHandler}
              />
            </Form.Group>
          </Col>
        </Row>
        <Row>
          <Col xl="6">
            <Form.Group className="w-100 mb-3">
              <Form.Label htmlFor="applicant">
                Инициатор (только сервисные аккаунты)
              </Form.Label>
              <Select
                id="applicant"
                name="applicant"
                placeholder="Выберите инициатора"
                required
                isClearable
                isSearchable
                value={formData.applicant}
                options={serviceAccounts}
                getOptionLabel={(option) => `${option.firstName}`}
                getOptionValue={(option) => option._id}
                onChange={applicantHandler}
              />
            </Form.Group>
          </Col>
        </Row>
        <Row>
          <Col xl="6">
            <Form.Group className="w-100 mb-3">
              <Form.Label htmlFor="category">Категория</Form.Label>
              <Select
                id="category"
                name="category"
                placeholder="Выберите категорию"
                required
                isClearable
                isSearchable
                value={formData.category}
                options={categoriesList}
                getOptionLabel={(option) => `${option.title}`}
                getOptionValue={(option) => option._id}
                onChange={categoryHandler}
              />
            </Form.Group>
          </Col>
        </Row>
        <Row>
          <Col xl="6">
            <Form.Group className="mb-3">
              <Form.Label htmlFor="cronSchedule">Расписание cron</Form.Label>
              <Form.Control
                id="cronSchedule"
                name="cronSchedule"
                type="text"
                required
                value={formData.cronSchedule}
                onChange={strFormDataHandler}
              />
            </Form.Group>
          </Col>
        </Row>
        <Row>
          <Col xl="6">
            <Form.Check
              checked={formData.isActive}
              type="switch"
              id="isActive"
              name="isActive"
              label="Активно"
              value={formData.isActive}
              onChange={switchFormDataHandler}
            />
          </Col>
        </Row>
        <Row className="mt-3">
          <Col xl="6">
            <UpdateChecklist
              checklist={formData.checklist}
              updateChecklist={updateChecklist}
            />
          </Col>
        </Row>
      </FormWrapper>
    </>
  );
};

export default RoutineTaskForm;
