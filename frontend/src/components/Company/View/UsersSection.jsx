import { useLoaderData } from "react-router";
import { Link } from "react-router";
import { useState, useRef } from "react";
import Card from "react-bootstrap/Card";
import Table from "react-bootstrap/Table";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";

import { HiOutlineMagnifyingGlass } from "react-icons/hi2";

const UserSection = () => {
  const { company } = useLoaderData();
  const [showAll, setShowAll] = useState(false);
  const sectionRef = useRef(null);

  const displayedUsers = showAll
    ? company.employees
    : company.employees.slice(0, 10);
  const hasMoreUsers = company.employees.length > 10;

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
    <Card className="mb-4" ref={sectionRef}>
      <Card.Body>
        <>
          <h4>Все пользователи ({company.employees.length})</h4>
          {company.employees.length > 0 ? (
            <>
              <Table responsive striped hover>
                <thead>
                  <tr>
                    <th>Имя</th>
                    <th>Подразделение</th>
                    <th>Email</th>
                    <th>Телефон</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedUsers.map((user) => (
                    <tr key={user._id}>
                      <td data-cell="Имя">{`${user.lastName} ${user.firstName}`}</td>
                      <td data-cell="Подразделение">
                        {user.subdivision?.name}
                      </td>
                      <td data-cell="Email">
                        <a href={`mailto:${user.email}`}>{user.email}</a>
                      </td>
                      <td data-cell="Телефон">
                        <a href={`tel:${user.phone}`}>{user.phone}</a>
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
        </>
      </Card.Body>
    </Card>
  );
};
export default UserSection;
