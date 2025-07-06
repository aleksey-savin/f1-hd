import { useState } from "react";

import Form from "react-bootstrap/Form";

import timezones from "../../store/timezones";

import Select from "../../UI/Select";

const PrefsGlobals = ({ prefs }) => {
  const [selectedTimezone, setSelectedTimezone] = useState(
    timezones.filter((zone) => zone.value === prefs.timezone)
  );

  const [deadline, setDeadline] = useState(prefs.deadline);

  const deadlineChangeHandler = (event) => {
    setDeadline(event.target.value);
    prefs.deadline = event.target.value;
  };

  const timezoneSelectHandler = (event) => {
    setSelectedTimezone(event);
    prefs.timezone = event.value;
  };

  const [tel, setTel] = useState(prefs.contacts?.tel || "");
  const [email, setEmail] = useState(prefs.contacts?.email || "");
  const [address, setAddress] = useState(prefs.contacts?.address || "");

  const telChangeHandler = (event) => {
    setTel(event.target.value);
    prefs.contacts.tel = event.target.value;
  };

  const emailChangeHandler = (event) => {
    setEmail(event.target.value);
    prefs.contacts.email = event.target.value;
  };

  const addressChangeHandler = (event) => {
    setAddress(event.target.value);
    prefs.contacts.address = event.target.value;
  };

  return (
    <>
      <h4>Время</h4>
      <Form.Group className="mb-3">
        <Form.Label>Общий часовой пояс</Form.Label>
        <Select
          id="timezone"
          name="timezone"
          placeholder="Выберите часовой пояс"
          closeMenuOnSelect
          isClearable
          isSearchable
          value={selectedTimezone}
          options={timezones}
          getOptionLabel={(option) => option.label}
          getOptionValue={(option) => option.value}
          onChange={timezoneSelectHandler}
        />
      </Form.Group>
      <h4>Сроки по-умолчанию</h4>
      <Form.Group className="mb-3">
        <Form.Label>Дедлайн, часы</Form.Label>
        <Form.Control
          type="number"
          value={deadline}
          onChange={deadlineChangeHandler}
        />
      </Form.Group>
      <h4>Контакты</h4>
      <Form.Group className="mb-3">
        <Form.Label>Телефон</Form.Label>
        <Form.Control type="text" value={tel} onChange={telChangeHandler} />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>Email</Form.Label>
        <Form.Control type="text" value={email} onChange={emailChangeHandler} />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>Адрес</Form.Label>
        <Form.Control
          type="text"
          value={address}
          onChange={addressChangeHandler}
        />
      </Form.Group>
    </>
  );
};

export default PrefsGlobals;
