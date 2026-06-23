import { useState, useEffect, useMemo } from "react";
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

// Допустимые типы родителя для каждого типа локации. Списки «ослаблены» (можно
// пропускать уровни — помещение прямо в здании), т.к. реальные данные не всегда
// содержат полную цепочку. Здание — корень, родителя не имеет.
const ALLOWED_PARENT_TYPES = {
  building: [],
  floor: ["building"],
  room: ["floor", "building"],
  workplace: ["room", "floor", "building"],
  storage: ["building", "floor", "room"],
};

const TYPE_LABEL = Object.fromEntries(
  LOCATION_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

// Крошка из цепочки parent (virtual fullPath на бэке асинхронный и непригоден
// для сериализации — строим путь сами по плоскому списку).
const buildLocationPath = (loc, byId) => {
  const names = [loc.name];
  let cur = loc;
  let guard = 0;
  while (cur?.parent && guard < 8) {
    const pid = cur.parent?._id || cur.parent;
    const p = byId.get(String(pid));
    if (!p) break;
    names.unshift(p.name);
    cur = p;
    guard += 1;
  }
  return names.join(" → ");
};

// Все потомки узла (по parent-рёбрам плоского списка) — их нельзя предлагать в
// родители, иначе образуется цикл.
const collectDescendantIds = (rootId, list) => {
  const childrenMap = new Map();
  list.forEach((l) => {
    const pid = l.parent?._id || l.parent;
    if (!pid) return;
    const key = String(pid);
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key).push(String(l._id));
  });
  const result = new Set();
  const stack = [String(rootId)];
  while (stack.length) {
    const id = stack.pop();
    (childrenMap.get(id) || []).forEach((k) => {
      if (!result.has(k)) {
        result.add(k);
        stack.push(k);
      }
    });
  }
  return result;
};

// Поля расположения. Рендерят `name`-атрибуты для сабмита со страницы
// (react-router action) и сообщают агрегированное состояние через onChange для
// инлайн-модалки. Подразделения подгружаются по выбранной компании.
// lockCompany фиксирует компанию (инлайн-создание из формы устройства).
const LocationFormFields = ({
  location: initialLocation,
  companies = [],
  users = [],
  parentLocations = [],
  subdivisions: initialSubdivisions = [],
  preselectedCompany = null,
  preselectedParent = null,
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
    parent:
      initialLocation?.parent?._id ||
      initialLocation?.parent ||
      preselectedParent ||
      "",
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
      parent: location.parent || undefined,
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

  // Опции родителя: та же компания, без себя и потомков, с учётом допустимых
  // типов; подпись — крошка пути. Текущий родитель всегда присутствует, иначе
  // react-select не покажет выбор и сабмит может его обнулить.
  const parentOptions = useMemo(() => {
    if (!location.company) return [];
    const byId = new Map(parentLocations.map((l) => [String(l._id), l]));
    const selfId = initialLocation?._id ? String(initialLocation._id) : null;
    const descendants = selfId
      ? collectDescendantIds(selfId, parentLocations)
      : new Set();
    const allowed = location.type ? ALLOWED_PARENT_TYPES[location.type] : null;

    const toOption = (l) => ({
      value: l._id,
      label: `${buildLocationPath(l, byId)} — ${TYPE_LABEL[l.type] || l.type}`,
    });

    const options = parentLocations
      .filter((l) => {
        const compId = l.company?._id || l.company;
        if (String(compId) !== String(location.company)) return false;
        if (selfId && String(l._id) === selfId) return false;
        if (descendants.has(String(l._id))) return false;
        if (allowed && !allowed.includes(l.type)) return false;
        return true;
      })
      .map(toOption);

    if (
      location.parent &&
      !options.some((o) => String(o.value) === String(location.parent))
    ) {
      const cur = byId.get(String(location.parent));
      if (cur) options.unshift(toOption(cur));
    }
    return options;
  }, [
    parentLocations,
    location.company,
    location.type,
    location.parent,
    initialLocation,
  ]);

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
              onChange={(o) => {
                setField("company", o ? o.value : "");
                setField("parent", "");
              }}
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

      <Row>
        <Col md={12}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="parent">Родительское расположение</Form.Label>
            <Select
              id="parent"
              name="parentLocation"
              placeholder={
                location.type === "building"
                  ? "Здание — верхний уровень иерархии"
                  : "Выберите родительское расположение"
              }
              options={parentOptions}
              value={findOption(parentOptions, location.parent)}
              onChange={(o) => setField("parent", o ? o.value : "")}
              isDisabled={!location.company || location.type === "building"}
              isClearable
            />
            <Form.Text className="text-muted">
              Где это расположение находится в иерархии: здание → этаж →
              помещение → рабочее место
            </Form.Text>
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
