import { useLoaderData, useFetcher } from "react-router";
import { useState, useRef, useMemo } from "react";
import Table from "react-bootstrap/Table";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import InputGroup from "react-bootstrap/InputGroup";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Offcanvas from "react-bootstrap/Offcanvas";
import Spinner from "react-bootstrap/Spinner";

import {
  HiOutlineMagnifyingGlass,
  HiChevronUp,
  HiChevronDown,
  HiChevronUpDown,
} from "react-icons/hi2";
import { RiGroupLine } from "react-icons/ri";

import { formatDate } from "../../../util/format-date";

import Select from "../../../UI/Select";
import ViewUser from "../../User/View";

// Sortable columns. `type: "date"` sorts by timestamp, not alphabetically.
const SORT_COLUMNS = [
  { key: "name", label: "Имя", type: "string" },
  { key: "position", label: "Должность", type: "string" },
  { key: "subdivision", label: "Подразделение", type: "string" },
  { key: "email", label: "Email", type: "string" },
  { key: "phone", label: "Телефон", type: "string" },
  { key: "lastActivity", label: "Последняя активность", type: "date" },
];

// Sentinel value for the «employees without a subdivision» filter option.
const NO_SUBDIVISION = "__none__";

// Returns the raw comparable value for a column: a timestamp (number) for the
// date column, a string for the rest, or null/"" when the value is missing.
const getSortValue = (user, key) => {
  switch (key) {
    case "name":
      return `${user.lastName} ${user.firstName}`;
    case "position":
      return user.position || "";
    case "subdivision":
      return user.subdivision?.name || "";
    case "email":
      return user.email || "";
    case "phone":
      return user.phone || "";
    case "lastActivity":
      return user.lastActivity?.date
        ? new Date(user.lastActivity.date).getTime()
        : null;
    default:
      return "";
  }
};

const UserSection = () => {
  const { company } = useLoaderData();
  const [showAll, setShowAll] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
  const [searchQuery, setSearchQuery] = useState("");
  const [subdivisionFilter, setSubdivisionFilter] = useState("all");
  const sectionRef = useRef(null);

  // Offcanvas with the employee profile (renders the full User/View page).
  const profileFetcher = useFetcher();
  const [profileUserId, setProfileUserId] = useState(null);

  const openProfile = (userId) => {
    setProfileUserId(userId);
    profileFetcher.load(`/users/${userId}`);
  };
  const closeProfile = () => setProfileUserId(null);

  const profileData = profileFetcher.data;
  const isProfileReady = profileData?.user?._id === profileUserId;

  // Unique subdivision names present among employees, for the filter dropdown.
  const subdivisionOptions = useMemo(() => {
    const names = new Set();
    company.employees.forEach((user) => {
      if (user.subdivision?.name) names.add(user.subdivision.name);
    });
    return [...names].sort((a, b) => a.localeCompare(b, "ru"));
  }, [company.employees]);

  const hasUnassigned = useMemo(
    () => company.employees.some((user) => !user.subdivision?.name),
    [company.employees],
  );

  // Options for the react-select subdivision filter.
  const subdivisionSelectOptions = useMemo(() => {
    const options = [{ value: "all", label: "Все подразделения" }];
    subdivisionOptions.forEach((name) =>
      options.push({ value: name, label: name }),
    );
    if (hasUnassigned) {
      options.push({ value: NO_SUBDIVISION, label: "Без подразделения" });
    }
    return options;
  }, [subdivisionOptions, hasUnassigned]);

  const selectedSubdivisionOption =
    subdivisionSelectOptions.find(
      (option) => option.value === subdivisionFilter,
    ) ?? subdivisionSelectOptions[0];

  const sortedUsers = useMemo(() => {
    const users = [...company.employees];
    const { key, direction } = sortConfig;
    if (!key) return users;

    const column = SORT_COLUMNS.find((c) => c.key === key);
    const factor = direction === "asc" ? 1 : -1;

    return users.sort((a, b) => {
      const aValue = getSortValue(a, key);
      const bValue = getSortValue(b, key);

      // Empty values (no date / blank field) always sink to the bottom,
      // regardless of the sort direction.
      const aEmpty = aValue === null || aValue === "";
      const bEmpty = bValue === null || bValue === "";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;

      if (column?.type === "date") {
        return (aValue - bValue) * factor;
      }
      return aValue.localeCompare(bValue, "ru") * factor;
    });
  }, [company.employees, sortConfig]);

  // Apply the subdivision filter, then the free-text search, to the sorted list.
  const filteredUsers = useMemo(() => {
    let list = sortedUsers;

    if (subdivisionFilter === NO_SUBDIVISION) {
      list = list.filter((user) => !user.subdivision?.name);
    } else if (subdivisionFilter !== "all") {
      list = list.filter(
        (user) => user.subdivision?.name === subdivisionFilter,
      );
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      list = list.filter((user) => {
        const haystack = [
          `${user.lastName} ${user.firstName}`,
          user.position,
          user.email,
          user.phone,
          user.subdivision?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });
    }

    return list;
  }, [sortedUsers, subdivisionFilter, searchQuery]);

  const displayedUsers = showAll ? filteredUsers : filteredUsers.slice(0, 10);
  const hasMoreUsers = filteredUsers.length > 10;

  const requestSort = (key) => {
    setSortConfig((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  const renderSortIcon = (key) => {
    if (sortConfig.key !== key) {
      return <HiChevronUpDown className="text-muted" />;
    }
    return sortConfig.direction === "asc" ? <HiChevronUp /> : <HiChevronDown />;
  };

  const handleToggle = () => {
    setShowAll(!showAll);

    // Only scroll when collapsing the list
    if (showAll && sectionRef.current) {
      try {
        const yOffset = -100; // height of fixed header
        const element = sectionRef.current;
        const y =
          element.getBoundingClientRect().top + window.pageYOffset + yOffset;
        window.scrollTo({ top: y, behavior: "smooth" });
      } catch (error) {
        console.error("Scroll error:", error);
      }
    }
  };

  return (
    <div ref={sectionRef}>
      <div className="cap-card-title mb-3">
        <RiGroupLine />
        <span>Сотрудники ({company.employees.length})</span>
      </div>
      {company.employees.length > 0 ? (
        <>
          <Row className="g-2 mb-3">
            <Col xs={12} sm={7} md={5} lg={4}>
              <InputGroup>
                <InputGroup.Text>
                  <HiOutlineMagnifyingGlass />
                </InputGroup.Text>
                <Form.Control
                  type="search"
                  placeholder="Поиск по имени, email или телефону…"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setShowAll(false);
                  }}
                />
              </InputGroup>
            </Col>
            <Col xs={12} sm="auto">
              <div style={{ minWidth: 240 }}>
                <Select
                  aria-label="Фильтр по подразделению"
                  options={subdivisionSelectOptions}
                  value={selectedSubdivisionOption}
                  onChange={(selected) => {
                    setSubdivisionFilter(selected?.value ?? "all");
                    setShowAll(false);
                  }}
                  isSearchable={false}
                />
              </div>
            </Col>
          </Row>

          {filteredUsers.length > 0 ? (
            <>
              <Table responsive striped hover className="mb-0">
                <thead>
                  <tr>
                    {SORT_COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        onClick={() => requestSort(column.key)}
                        className={
                          column.key === "lastActivity" ? "text-end" : undefined
                        }
                        style={{ cursor: "pointer", userSelect: "none" }}
                      >
                        {column.label} {renderSortIcon(column.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayedUsers.map((user) => (
                    <tr key={user._id}>
                      <td data-cell="Имя">
                        <Button
                          variant="link"
                          className="p-0 text-start text-decoration-none fw-medium"
                          onClick={() => openProfile(user._id)}
                        >
                          {`${user.lastName} ${user.firstName}`}
                        </Button>
                      </td>
                      <td data-cell="Должность">{user.position}</td>
                      <td data-cell="Подразделение">
                        {user.subdivision?.name}
                      </td>
                      <td data-cell="Email">
                        <a href={`mailto:${user.email}`}>{user.email}</a>
                      </td>
                      <td data-cell="Телефон">
                        <a href={`tel:${user.phone}`}>{user.phone}</a>
                      </td>
                      <td data-cell="Последняя активность" className="text-end">
                        {user.lastActivity?.date
                          ? formatDate(user.lastActivity.date)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              {hasMoreUsers && (
                <div className="text-center mt-3">
                  <Button variant="primary" size="sm" onClick={handleToggle}>
                    {showAll
                      ? "Показать меньше"
                      : `Показать ещё (${filteredUsers.length - 10})`}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <Alert variant="light" className="text-center mb-0">
              Сотрудники не найдены
            </Alert>
          )}
        </>
      ) : (
        <Alert variant="light" className="text-center mb-0">
          Пользователи не найдены
        </Alert>
      )}

      {/* Профиль сотрудника во весь экран (выезжает снизу), закрывается назад
          к карточке компании. Рендерит ту же страницу, что и /users/:id. */}
      <Offcanvas
        show={profileUserId !== null}
        onHide={closeProfile}
        keyboard
        placement="bottom"
        className="h-100"
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title></Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {isProfileReady ? (
            <ViewUser
              user={profileData.user}
              tickets={profileData.tickets || []}
            />
          ) : (
            <div className="text-center py-5">
              <Spinner animation="border" />
            </div>
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </div>
  );
};
export default UserSection;
