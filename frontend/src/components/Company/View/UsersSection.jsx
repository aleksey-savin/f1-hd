import { useLoaderData } from "react-router";
import { Link } from "react-router";
import { useState, useRef, useMemo } from "react";
import Table from "react-bootstrap/Table";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";

import {
  HiOutlineMagnifyingGlass,
  HiChevronUp,
  HiChevronDown,
  HiChevronUpDown,
} from "react-icons/hi2";
import { RiGroupLine } from "react-icons/ri";

import { formatDate } from "../../../util/format-date";

// Sortable columns. `type: "date"` sorts by timestamp, not alphabetically.
const SORT_COLUMNS = [
  { key: "name", label: "Имя", type: "string" },
  { key: "subdivision", label: "Подразделение", type: "string" },
  { key: "email", label: "Email", type: "string" },
  { key: "phone", label: "Телефон", type: "string" },
  { key: "lastActivity", label: "Последняя активность", type: "date" },
];

// Returns the raw comparable value for a column: a timestamp (number) for the
// date column, a string for the rest, or null/"" when the value is missing.
const getSortValue = (user, key) => {
  switch (key) {
    case "name":
      return `${user.lastName} ${user.firstName}`;
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
  const sectionRef = useRef(null);

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

  const displayedUsers = showAll ? sortedUsers : sortedUsers.slice(0, 10);
  const hasMoreUsers = company.employees.length > 10;

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
          <Table responsive striped hover className="mb-0">
            <thead>
              <tr>
                {SORT_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    onClick={() => requestSort(column.key)}
                    style={{ cursor: "pointer", userSelect: "none" }}
                  >
                    {column.label} {renderSortIcon(column.key)}
                  </th>
                ))}
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {displayedUsers.map((user) => (
                <tr key={user._id}>
                  <td data-cell="Имя">{`${user.lastName} ${user.firstName}`}</td>
                  <td data-cell="Подразделение">{user.subdivision?.name}</td>
                  <td data-cell="Email">
                    <a href={`mailto:${user.email}`}>{user.email}</a>
                  </td>
                  <td data-cell="Телефон">
                    <a href={`tel:${user.phone}`}>{user.phone}</a>
                  </td>
                  <td data-cell="Последняя активность">
                    {user.lastActivity?.date
                      ? formatDate(user.lastActivity.date)
                      : "—"}
                  </td>
                  <td data-cell="Действия">
                    <Button
                      as={Link}
                      size="sm"
                      to={`/users/${user._id}`}
                      target="_blank"
                      variant="outline-secondary"
                    >
                      <HiOutlineMagnifyingGlass />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>

          {hasMoreUsers && (
            <div className="text-center mt-3">
              <Button
                variant="outline-primary"
                size="sm"
                onClick={handleToggle}
              >
                {showAll
                  ? "Показать меньше"
                  : `Показать еще (${company.employees.length - 10})`}
              </Button>
            </div>
          )}
        </>
      ) : (
        <Alert variant="light" className="text-center mb-0">
          Пользователи не найдены
        </Alert>
      )}
    </div>
  );
};
export default UserSection;
