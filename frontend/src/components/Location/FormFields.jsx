import { useState, useEffect } from "react";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";

import { getLocalStorageData } from "../../util/auth";
import Select from "../../UI/Select";

const LOCATION_TYPE_OPTIONS = [
  { value: "building", label: "Здание" },
  { value: "floor", label: "Этаж" },
  { value: "room", label: "Помещение" },
  { value: "workplace", label: "Рабочее место" },
  { value: "storage", label: "Склад" },
];

// Поля расположения. Рендерят `name`-атрибуты для сабмита со страницы
// (react-router action) и сообщают агрегированное состояние через onChange для
// инлайн-модалки. Подразделения подгружаются по выбранной компании.
// lockCompany фиксирует компанию (инлайн-создание из формы устройства).
const LocationFormFields = ({
  location: initialLocation,
  companies = [],
  users = [],
  subdivisions: initialSubdivisions = [],
  preselectedCompany = null,
  lockCompany = false,
  onChange,
}) => {
  const [location, setLocation] = useState({
    name: initialLocation?.name || "",
    company:
      initialLocation?.company?._id ||
      initialLocation?.company ||
      preselectedCompany ||
      "",
    subdivision:
      initialLocation?.subdivision?._id || initialLocation?.subdivision || "",
    description: initialLocation?.description || "",
    isPublic: initialLocation?.isPublic || false,
    type: initialLocation?.type || "",
    assignedUser:
      initialLocation?.assignedUser?._id || initialLocation?.assignedUser || "",
  });

  const [subdivisions, setSubdivisions] = useState(initialSubdivisions || []);
  const [filteredUsers, setFilteredUsers] = useState([]);

  // Подразделения выбранной компании.
  useEffect(() => {
    if (location.company) {
      fetchSubdivisions(location.company);
    } else {
      setSubdivisions([]);
    }
  }, [location.company]);

  // Пользователи выбранной компании (список users может прийти асинхронно).
  useEffect(() => {
    if (!location.company) {
      setFilteredUsers([]);
      return;
    }
    setFilteredUsers(
      users.filter(
        (user) =>
          user.company?._id === location.company ||
          user.company === location.company,
      ),
    );
  }, [location.company, users]);

  // Сообщаем состояние наверх (на странице onChange игнорируется).
  useEffect(() => {
    if (!onChange) return;
    onChange({
      name: location.name,
      type: location.type,
      company: location.company,
      subdivision: location.subdivision || undefined,
      assignedUser: location.assignedUser || undefined,
      description: location.description,
      isPublic: location.isPublic,
    });
  }, [location]);

  const fetchSubdivisions = async (companyId) => {
    const { token } = getLocalStorageData();
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/companies/${companyId}`,
        { headers: { Authorization: "Bearer " + token } },
      );
      if (response.ok) {
        const data = await response.json();
        const flatten = (subs) => {
          let result = [];
          subs.forEach((sub) => {
            result.push(sub);
            if (sub.subdivisions && sub.subdivisions.length > 0) {
              result = result.concat(flatten(sub.subdivisions));
            }
          });
          return result;
        };
        setSubdivisions(flatten(data.company?.subdivisions || []));
      }
    } catch (error) {
      console.error("Error fetching subdivisions:", error);
    }
  };

  const setField = (name, value) =>
    setLocation((prev) => ({ ...prev, [name]: value }));

  const companyOptions = (companies || []).map((c) => ({
    value: c._id,
    label: c.alias || c.fullTitle,
  }));
  const subdivisionOptions = (subdivisions || []).map((s) => ({
    value: s._id,
    label: s.name,
  }));
  const userOptions = filteredUsers.map((u) => ({
    value: u._id,
    label: `${u.firstName} ${u.lastName}`,
  }));

  const findOption = (options, value) =>
    options.find((o) => o.value === value) || null;

  return (
    <>
      <Row>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="company">
              Компания
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Select
              id="company"
              name="company"
              placeholder="Выберите компанию"
              options={companyOptions}
              value={findOption(companyOptions, location.company)}
              onChange={(o) => setField("company", o ? o.value : "")}
              isDisabled={lockCompany}
              required
            />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="subdivision">Подразделение</Form.Label>
            <Select
              id="subdivision"
              name="subdivision"
              placeholder="Выберите подразделение"
              options={subdivisionOptions}
              value={findOption(subdivisionOptions, location.subdivision)}
              onChange={(o) => setField("subdivision", o ? o.value : "")}
              isDisabled={!location.company}
              isClearable
            />
          </Form.Group>
        </Col>
      </Row>

      <Row>
        <Col md={12}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="name">
              Название
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Form.Control
              id="name"
              name="name"
              type="text"
              placeholder="Введите название"
              value={location.name}
              onChange={(e) => setField("name", e.target.value)}
              required
            />
          </Form.Group>
        </Col>
      </Row>

      <Row>
        <Col md={12}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="type">
              Тип расположения
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Select
              id="type"
              name="type"
              placeholder="Выберите тип расположения"
              options={LOCATION_TYPE_OPTIONS}
              value={findOption(LOCATION_TYPE_OPTIONS, location.type)}
              onChange={(o) => setField("type", o ? o.value : "")}
              required
            />
          </Form.Group>
        </Col>
      </Row>

      {location.type === "workplace" && (
        <Row>
          <Col md={12}>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="assignedUser">
                Назначенный пользователь
                <span style={{ color: "red" }}>*</span>
              </Form.Label>
              <Select
                id="assignedUser"
                name="assignedUser"
                placeholder="Выберите пользователя"
                options={userOptions}
                value={findOption(userOptions, location.assignedUser)}
                onChange={(o) => setField("assignedUser", o ? o.value : "")}
                isClearable
              />
            </Form.Group>
          </Col>
        </Row>
      )}

      <Form.Group className="mb-4">
        <Form.Label htmlFor="description">Описание</Form.Label>
        <Form.Control
          id="description"
          name="description"
          as="textarea"
          rows={3}
          placeholder="Введите описание (опционально)"
          value={location.description}
          onChange={(e) => setField("description", e.target.value)}
        />
      </Form.Group>

      <Form.Group className="mb-3">
        <Form.Check
          type="switch"
          id="isPublic"
          name="isPublic"
          label="Общедоступное расположение"
          checked={location.isPublic}
          onChange={(e) => setField("isPublic", e.target.checked)}
        />
        <Form.Text className="text-muted">
          Техника может перемещаться в это расположение даже из других компаний
        </Form.Text>
      </Form.Group>
    </>
  );
};

export default LocationFormFields;
