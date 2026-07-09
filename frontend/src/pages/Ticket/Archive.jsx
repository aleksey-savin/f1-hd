import { useState, useContext, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { RiArchiveLine } from "react-icons/ri";
import DateRangePicker from "../../UI/DateRangePicker/DateRangePicker";
import "react-datepicker/dist/react-datepicker.css";

import Select from "../../UI/Select";
import Transitions from "../../animations/Transition";
import { toDateInputValue } from "../../util/format-date";
import Spinner from "../../animations/Spinner";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Table from "react-bootstrap/Table";
import Card from "react-bootstrap/Card";

import { formatShortDate } from "../../util/format-date";
import { getLocalStorageData } from "../../util/auth";
import { AuthedUserContext } from "../../store/authed-user-context";

const TicketsArchive = () => {
  const { isEndUser } = useContext(AuthedUserContext);
  const { token } = getLocalStorageData();
  const fetcher = useFetcher();

  const data = useLoaderData();
  const formData = data || {};

  const [dateRange, setDateRange] = useState([null, null]);
  const [startDate, endDate] = dateRange;

  const [tickets, setTickets] = useState([]);
  const [selectedCompanies, setSelectedCompanies] = useState(
    formData.companies?.length === 1 ? [formData.companies[0]] : [],
  );
  const [selectedResponsibles, setSelectedResponsibles] = useState(
    formData.responsibles?.length === 1 ? [formData.responsibles[0]] : [],
  );
  const [allApplicants, setAllApplicants] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedApplicants, setSelectedApplicants] = useState([]);

  const isLoading =
    fetcher.state === "submitting" || fetcher.state === "loading";

  useEffect(() => {
    if (selectedCompanies.length === 0) {
      return;
    }

    const companyIds = selectedCompanies.map((company) => company._id);

    setAllApplicants([
      ...formData.applicants.filter((applicant) =>
        companyIds.includes(applicant.company._id.toString()),
      ),
      ...formData.responsibles,
    ]);
  }, [formData.applicants, selectedCompanies, token]);

  const submitHandler = (event) => {
    event.preventDefault();

    const filterData = {
      // Календарный день из датапикера — НЕ через toISOString (это UTC-день:
      // для восточных поясов диапазон уезжал на день назад).
      from: toDateInputValue(startDate),
      to: toDateInputValue(endDate),
      companies: JSON.stringify(
        selectedCompanies.map((company) => company._id),
      ),
      responsibles: JSON.stringify(
        selectedResponsibles.map((resp) => resp._id),
      ),
      categories: JSON.stringify(selectedCategories.map((cat) => cat._id)),
      applicants: JSON.stringify(selectedApplicants.map((app) => app._id)),
      token,
    };

    fetcher.submit(filterData, {
      method: "post",
      action: "/closed-tickets",
    });
  };

  // Update tickets when fetch completes
  useEffect(() => {
    if (fetcher.data && fetcher.data.tickets && !isLoading) {
      setTickets(
        fetcher.data.tickets.map((ticket) => ({
          _id: ticket._id,
          num: ticket.num,
          title: ticket.title,
          applicant: ticket.applicant || {
            lastName: "Пользователь не найден",
            firstName: "",
          },
          category: ticket.category || { title: "Не указана" },
          responsibles: ticket.responsibles,
          createdAt: ticket.createdAt,
          finishedAt: ticket.finishedAt,
        })),
      );
    }
  }, [fetcher.data, isLoading]);

  return (
    <Transitions>
      <h1 className="display-4">
        <RiArchiveLine /> Архив заявок
      </h1>
      <hr />

      <Card className="mb-4 shadow-sm">
        <Card.Body>
          <Form onSubmit={submitHandler}>
            <Row>
              <Col md={6} lg={4}>
                <DateRangePicker
                  label="Период"
                  startDate={startDate}
                  endDate={endDate}
                  onChange={(update) => setDateRange(update)}
                  required
                  className="mb-3"
                />
              </Col>
            </Row>
            <Row>
              {formData.companies?.length > 1 && (
                <Col md={6} lg={4}>
                  <Form.Group className="mb-3">
                    <Form.Label htmlFor="companies">Компании</Form.Label>
                    <Select
                      id="companies"
                      placeholder="Выберите компании"
                      required
                      isMulti
                      isClearable
                      isSearchable
                      defaultValue={
                        formData.companies?.length === 1
                          ? [formData.companies[0]]
                          : []
                      }
                      options={formData.companies}
                      getOptionLabel={(option) => `${option.alias}`}
                      getOptionValue={(option) => option._id}
                      onChange={(selected) =>
                        setSelectedCompanies(selected || [])
                      }
                    />
                  </Form.Group>
                </Col>
              )}
              {formData.applicants?.length > 1 && (
                <Col md={6} lg={4}>
                  <Form.Group className="mb-3">
                    <Form.Label htmlFor="applicants">Инициаторы</Form.Label>
                    <Select
                      id="applicants"
                      placeholder="Выберите инициаторов"
                      isMulti
                      isClearable
                      isSearchable
                      options={allApplicants}
                      getOptionLabel={(option) =>
                        `${option.lastName} ${option.firstName}`
                      }
                      getOptionValue={(option) => option._id}
                      onChange={(selected) =>
                        setSelectedApplicants(selected || [])
                      }
                    />
                  </Form.Group>
                </Col>
              )}
              {!isEndUser && (
                <>
                  {formData.responsibles.length > 1 && (
                    <Col md={6} lg={4}>
                      <Form.Group className="mb-3">
                        <Form.Label htmlFor="responsibles">
                          Ответственные за выполнение
                        </Form.Label>
                        <Select
                          id="responsibles"
                          placeholder="Выберите ответственных"
                          isMulti
                          isClearable
                          isSearchable
                          options={formData.responsibles}
                          defaultValue={
                            formData.responsibles?.length === 1
                              ? [formData.responsibles[0]]
                              : []
                          }
                          getOptionLabel={(option) =>
                            `${option.lastName} ${option.firstName}`
                          }
                          getOptionValue={(option) => option._id}
                          onChange={(selected) =>
                            setSelectedResponsibles(selected || [])
                          }
                        />
                      </Form.Group>
                    </Col>
                  )}
                  {formData.categories?.length > 1 && (
                    <Col md={6} lg={4}>
                      <Form.Group className="mb-3">
                        <Form.Label htmlFor="categories">Категории</Form.Label>
                        <Select
                          id="categories"
                          placeholder="Выберите категории"
                          isMulti
                          isClearable
                          isSearchable
                          options={formData.categories}
                          getOptionLabel={(option) => option.title}
                          getOptionValue={(option) => option._id}
                          onChange={(selected) =>
                            setSelectedCategories(selected || [])
                          }
                        />
                      </Form.Group>
                    </Col>
                  )}
                </>
              )}
            </Row>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Загрузка..." : "Применить фильтр"}
            </Button>
          </Form>
        </Card.Body>
      </Card>

      {isLoading && (
        <div className="text-center py-5">
          <Spinner />
        </div>
      )}

      {!isLoading && tickets.length > 0 && (
        <Transitions>
          <Card className="shadow-sm">
            <Card.Body>
              <div className="table-responsive">
                <Table striped hover className="mb-0 sortable">
                  <thead className="table-light">
                    <tr>
                      <th>№</th>
                      <th>Тема</th>
                      <th>Категория</th>
                      <th>Инициатор</th>
                      <th>Ответственные</th>
                      <th>Создана</th>
                      <th>Закрыта</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((ticket) => (
                      <tr key={ticket._id}>
                        <td>
                          <a
                            href={`/tickets/${ticket.num}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="fw-bold"
                          >
                            {ticket.num}
                          </a>
                        </td>
                        <td>{ticket.title}</td>
                        <td>{ticket.category?.title}</td>
                        <td>
                          {`${ticket.applicant?.lastName} ${ticket.applicant?.firstName}`}
                        </td>
                        <td>
                          {ticket.responsibles?.map((user, index, array) =>
                            index === array.length - 1
                              ? `${user.lastName} ${user.firstName}`
                              : `${user.lastName} ${user.firstName}, `,
                          )}
                        </td>
                        <td>{formatShortDate(ticket.createdAt)}</td>
                        <td>{formatShortDate(ticket.finishedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="table-light">
                    <tr>
                      <td colSpan={6}>
                        <strong>Всего:</strong>
                      </td>
                      <td data-cell="всего">
                        <strong>{tickets.length}</strong>
                      </td>
                    </tr>
                  </tfoot>
                </Table>
              </div>
            </Card.Body>
          </Card>
        </Transitions>
      )}

      {!isLoading && tickets.length === 0 && fetcher.data && (
        <div className="text-center py-5">
          <p className="text-muted">Заявки не найдены</p>
        </div>
      )}
    </Transitions>
  );
};

export default TicketsArchive;

export async function loader() {
  document.title = "АРХИВ ЗАЯВОК";

  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/form-data`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}

export async function action({ request }) {
  const formData = await request.formData();
  const token = formData.get("token");

  // Create an object with the filter data
  const filterData = {
    from: formData.get("from"),
    to: formData.get("to"),
    companies: JSON.parse(formData.get("companies") || "[]"),
    responsibles: JSON.parse(formData.get("responsibles") || "[]"),
    categories: JSON.parse(formData.get("categories") || "[]"),
    applicants: JSON.parse(formData.get("applicants") || "[]"),
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/closed`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(filterData),
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}
