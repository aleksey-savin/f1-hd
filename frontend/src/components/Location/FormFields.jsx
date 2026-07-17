import { useState, useEffect, useMemo } from "react";

import { RiUser3Line } from "react-icons/ri";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";
import Segmented from "@/components/app/Segmented";

import Select from "../../UI/Select";
import { getLocalStorageData } from "../../util/auth";
import { TYPE_LABEL, TYPE_ICON } from "./type-meta";

// Тип расположения — сегментами с иконками (из общего type-meta, тот же язык,
// что дерево/карточка). Порядок = иерархия сверху вниз.
const TYPE_OPTIONS = ["building", "floor", "room", "workplace", "storage"].map(
  (value) => {
    const Icon = TYPE_ICON[value];
    return {
      value,
      label: TYPE_LABEL[value],
      icon: <Icon size={18} aria-hidden />,
    };
  },
);

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
    // subdivisions в модели — массив; в форме выбираем одно (как раньше),
    // но храним/шлём массивом, иначе бэкенд его не сохраняет.
    subdivision:
      initialLocation?.subdivisions?.[0]?._id ||
      initialLocation?.subdivisions?.[0] ||
      "",
    description: initialLocation?.description || "",
    address: initialLocation?.address || "",
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
      subdivisions: location.subdivision ? [location.subdivision] : [],
      parent: location.parent || undefined,
      assignedUser: location.assignedUser || undefined,
      description: location.description,
      address: location.address,
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

  const isBuilding = location.type === "building";
  const isWorkplace = location.type === "workplace";

  return (
    <>
      {/* Скрытые поля для сабмита со страницы (react-router action) */}
      <input type="hidden" name="type" value={location.type} />
      <input type="hidden" name="company" value={location.company} />
      {location.subdivision && (
        <input type="hidden" name="subdivisions" value={location.subdivision} />
      )}
      <input
        type="hidden"
        name="parentLocation"
        value={isBuilding ? "" : location.parent}
      />
      {isWorkplace && (
        <input
          type="hidden"
          name="assignedUser"
          value={location.assignedUser}
        />
      )}

      <div className="tw:grid tw:gap-x-4 tw:sm:grid-cols-2">
        <Field label="Компания" htmlFor="company" required>
          <Select
            id="company"
            placeholder="Выберите компанию"
            options={companyOptions}
            value={findOption(companyOptions, location.company)}
            onChange={(o) => {
              setField("company", o ? o.value : "");
              setField("subdivision", "");
              setField("parent", "");
            }}
            isDisabled={lockCompany}
          />
        </Field>

        <Field label="Подразделение" htmlFor="subdivision">
          <Select
            id="subdivision"
            placeholder="Выберите подразделение"
            options={subdivisionOptions}
            value={findOption(subdivisionOptions, location.subdivision)}
            onChange={(o) => setField("subdivision", o ? o.value : "")}
            isDisabled={!location.company}
            isClearable
          />
        </Field>
      </div>

      <Field label="Название" htmlFor="name" required>
        <Input
          id="name"
          name="name"
          type="text"
          placeholder="Введите название"
          value={location.name}
          onChange={(e) => setField("name", e.target.value)}
          required
        />
      </Field>

      <Field label="Тип расположения" required>
        <Segmented
          ariaLabel="Тип расположения"
          stacked
          options={TYPE_OPTIONS}
          value={location.type}
          onChange={(value) => {
            setField("type", value);
            // Здание — корень: сбрасываем родителя при переключении на него
            if (value === "building") setField("parent", "");
          }}
        />
      </Field>

      <Field
        label="Родительское расположение"
        htmlFor="parent"
        hint="Где это расположение находится в иерархии: здание → этаж → помещение → рабочее место."
      >
        <Select
          id="parent"
          placeholder={
            isBuilding
              ? "Здание — верхний уровень иерархии"
              : "Выберите родительское расположение"
          }
          options={parentOptions}
          value={findOption(parentOptions, location.parent)}
          onChange={(o) => setField("parent", o ? o.value : "")}
          isDisabled={!location.company || isBuilding}
          isClearable
        />
      </Field>

      {/* Условное поле: только для рабочего места (за ним закрепляется
          сотрудник — ответственный за технику на этом месте) */}
      {isWorkplace && (
        <div className="tw:mb-4 tw:rounded-xl tw:bg-primary/5 tw:p-3 tw:inset-ring tw:inset-ring-border-soft">
          <div className="tw:mb-2 tw:inline-flex tw:items-center tw:gap-1.5 tw:text-[11px] tw:font-bold tw:tracking-wider tw:text-accent-text tw:uppercase">
            <RiUser3Line size={13} aria-hidden /> Для рабочего места
          </div>
          <Field
            label="Назначенный сотрудник"
            htmlFor="assignedUser"
            required
            hint="Кабинет закрепляется за сотрудником — он ответственный за технику на этом месте."
            className="tw:mb-0"
          >
            <Select
              id="assignedUser"
              placeholder="Выберите сотрудника"
              options={userOptions}
              value={findOption(userOptions, location.assignedUser)}
              onChange={(o) => setField("assignedUser", o ? o.value : "")}
              isClearable
            />
          </Field>
        </div>
      )}

      <Field label="Адрес" htmlFor="address">
        <Input
          id="address"
          name="address"
          type="text"
          placeholder="Например, г. Москва, ул. Ленина, 10"
          value={location.address}
          onChange={(e) => setField("address", e.target.value)}
        />
      </Field>

      <Field label="Описание" htmlFor="description">
        <Textarea
          id="description"
          name="description"
          rows={3}
          placeholder="Введите описание (опционально)"
          value={location.description}
          onChange={(e) => setField("description", e.target.value)}
        />
      </Field>

      <SwitchField
        id="isPublic"
        name="isPublic"
        checked={location.isPublic}
        onCheckedChange={(checked) => setField("isPublic", checked)}
        label="Общедоступное расположение"
        hint="Технику можно перемещать сюда даже из других компаний."
        divider
      />
    </>
  );
};

export default LocationFormFields;
