import { useRef, useState } from "react";

import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Image from "react-bootstrap/Image";

import timezones from "../../store/timezones";

import Select from "../../UI/Select";
import useToastStore from "../../store/toast-store";
import { getLocalStorageData } from "../../util/auth";

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

  // Лого компании для навбара: загрузка/удаление — сразу, отдельными
  // эндпоинтами (не кнопкой «Сохранить» настроек). Пусто — в баре текст
  // «HelpDesk».
  const { showToast } = useToastStore();
  const logoInputRef = useRef(null);
  const [logo, setLogo] = useState(prefs.contacts?.logo || "");
  const [logoBusy, setLogoBusy] = useState(false);

  const logoRequest = async (path, options) => {
    const { token } = getLocalStorageData();
    setLogoBusy(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}${path}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          ...options,
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || "Не удалось выполнить");
      }
      setLogo(data.logo);
      prefs.contacts.logo = data.logo;
      showToast("success", data.message);
    } catch (error) {
      showToast("danger", error.message);
    } finally {
      setLogoBusy(false);
    }
  };

  const logoFileHandler = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/gif"].includes(file.type)) {
      showToast("danger", "Выберите файл с изображением (jpg, png, gif)");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast("danger", "Размер файла не должен превышать 2Мб");
      return;
    }

    const formData = new FormData();
    formData.append("companyLogo", file);
    logoRequest("/api/preferences/logo", { body: formData });
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
      <Form.Group className="mb-3">
        <Form.Label>Лого компании</Form.Label>
        <div className="mb-2">
          {logo ? (
            <Image
              src={`${import.meta.env.VITE_API_ADDRESS}/uploads/${logo}`}
              alt="Лого компании"
              style={{ maxHeight: "48px" }}
            />
          ) : (
            <Form.Text className="text-muted d-block">
              Не задано — в шапке показывается название «HelpDesk».
            </Form.Text>
          )}
        </div>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={logoFileHandler}
        />
        <Button
          variant="outline-secondary"
          size="sm"
          disabled={logoBusy}
          onClick={() => logoInputRef.current?.click()}
        >
          {logoBusy ? "Загружаю…" : "Загрузить"}
        </Button>{" "}
        {logo && (
          <Button
            variant="outline-danger"
            size="sm"
            disabled={logoBusy}
            onClick={() => logoRequest("/api/preferences/delete-logo", {})}
          >
            Удалить
          </Button>
        )}
        <Form.Text className="text-muted d-block">
          PNG, JPG или GIF до 2 МБ; показывается в шапке высотой 32px.
        </Form.Text>
      </Form.Group>
    </>
  );
};

export default PrefsGlobals;
