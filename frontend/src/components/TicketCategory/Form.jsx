import { useState } from "react";

import Form from "react-bootstrap/Form";

import FormWrapper from "../../UI/FormWrapper";
import Select from "../../UI/Select";

import useInitialPrefsStore from "../../store/prefs";

const TicketCategoryForm = ({
  ticketCategory,
  servicePlansList = [],
  usersList = [],
}) => {
  const { modules } = useInitialPrefsStore();

  const [title, setTitle] = useState(ticketCategory?.title || "");
  const [description, setDescription] = useState(
    ticketCategory?.description || "",
  );
  const [isActive, setIsActive] = useState(
    ticketCategory ? ticketCategory.isActive : true,
  );
  const [alwaysWithinPlan, setAlwaysWithinPlan] = useState(
    ticketCategory ? ticketCategory.alwaysWithinPlan : false,
  );

  const titleChangeHandler = (event) => {
    setTitle(event.target.value);
  };

  const descriptionChangeHandler = (event) => {
    setDescription(event.target.value);
  };

  const isActiveChangeHandler = () => {
    setIsActive(!isActive);
  };

  const alwaysWithinPlanChangeHandler = () => {
    setAlwaysWithinPlan(!alwaysWithinPlan);
  };

  const [users, setUsers] = useState(
    ticketCategory ? ticketCategory.users : [],
  );

  const usersChangeHandler = (selectedItems) => {
    setUsers(selectedItems);
  };

  const [servicePlans, setServicePlans] = useState(
    ticketCategory ? ticketCategory.servicePlans : [],
  );

  const servicePlansChangeHandler = (selectedItems) => {
    setServicePlans(selectedItems);
  };

  return (
    <>
      <FormWrapper
        title={ticketCategory?.title || "Новая категория заявок"}
        navigateTo="/ticket-categories"
      >
        <Form.Group className="py-3">
          <Form.Label htmlFor="title">
            Наименование
            <span style={{ color: "red" }}>*</span>
          </Form.Label>
          <Form.Control
            autoFocus
            id="title"
            name="title"
            type="text"
            value={title}
            onChange={titleChangeHandler}
          />
        </Form.Group>
        <Form.Group className="py-3">
          <Form.Label htmlFor="description">Описание</Form.Label>
          <Form.Control
            id="description"
            name="description"
            type="text"
            as="textarea"
            value={description}
            onChange={descriptionChangeHandler}
          />
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label htmlFor="users">Пользователи</Form.Label>
          <Select
            id="users"
            name="users"
            placeholder="Выберите пользователей"
            closeMenuOnSelect={false}
            isClearable
            isSearchable
            isMulti
            value={users}
            options={usersList}
            getOptionLabel={(option) =>
              `${option.lastName} ${option.firstName}`
            }
            getOptionValue={(option) => option._id}
            onChange={usersChangeHandler}
          />
        </Form.Group>
        {modules.finances.isActive && (
          <>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="servicePlan">Услуги</Form.Label>
              <Select
                id="servicePlans"
                name="servicePlans"
                placeholder="Выберите услуги"
                isClearable
                isSearchable
                isMulti
                closeMenuOnSelect={false}
                value={servicePlans}
                options={servicePlansList.filter(
                  (plan) =>
                    !ticketCategory?.servicePlans.some(
                      (sp) => sp._id === plan._id,
                    ),
                )}
                getOptionLabel={(option) => `${option.title}`}
                getOptionValue={(option) => option._id}
                onChange={servicePlansChangeHandler}
              />
            </Form.Group>
            <Form.Group>
              <Form.Check
                checked={alwaysWithinPlan}
                type="switch"
                id="alwaysWithinPlan"
                name="alwaysWithinPlan"
                label="Всегда в рамках тарифного плана"
                className="py-2"
                value={alwaysWithinPlan}
                onChange={alwaysWithinPlanChangeHandler}
              />
            </Form.Group>
          </>
        )}

        <Form.Group>
          <Form.Check
            checked={isActive}
            type="switch"
            id="isActive"
            name="isActive"
            label="Активна"
            className="py-2"
            value={isActive}
            onChange={isActiveChangeHandler}
          />
        </Form.Group>
      </FormWrapper>
    </>
  );
};

export default TicketCategoryForm;
