import pad from "pad";

import { useState, useRef } from "react";
import { useLoaderData } from "react-router";

import { RiDraftLine } from "react-icons/ri";

import useHttp from "../../hooks/use-http";

import Select from "../../UI/Select";
import Transitions from "../../animations/Transition";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Table from "react-bootstrap/Table";
import Card from "react-bootstrap/Card";

import Spinner from "../../animations/Spinner";

import { getLocalStorageData } from "../../util/auth";

const WorkReport = () => {
  const { token } = getLocalStorageData();

  const { companies, categories } = useLoaderData();

  const fromInputRef = useRef();
  const toInputRef = useRef();

  const [works, setWorks] = useState([]);
  const [totalTime, setTotalTime] = useState();

  const [company, setCompany] = useState({});
  const [category, setCategory] = useState({});

  const companyChangeHandler = (selectedItem) => {
    setCompany(selectedItem);
  };

  const categoryChangeHandler = (selectedItem) => {
    setCategory(selectedItem);
  };

  const msToHMS = (ms) => {
    // 1- Convert to seconds:
    let seconds = ms / 1000;
    // 2- Extract hours:
    const hours = parseInt(seconds / 3600); // 3,600 seconds in 1 hour
    seconds = seconds % 3600; // seconds remaining after extracting hours
    // 3- Extract minutes:
    const minutes = parseInt(seconds / 60); // 60 seconds in 1 minute
    // 4- Keep only seconds not extracted to minutes:
    seconds = seconds % 60;

    const humanized = [
      pad(2, hours.toString(), "0"),
      pad(2, minutes.toString(), "0"),
    ].join(":");

    return humanized;
  };

  const { isLoading, sendRequest: filterWorksHandler } = useHttp();

  const submitHandler = (event) => {
    event.preventDefault();

    const filterData = {
      from: fromInputRef.current.value,
      to: toInputRef.current.value,
      company: company,
      category: category,
    };

    filterWorksHandler(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/report/works`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: filterData,
      },
      (data) => {
        setWorks(
          data.works.map((work) => {
            return {
              _id: work._id,
              ticketsNums: work.ticketsNums,
              description: work.description,
              ticketsCategories: work.ticketsCategories,
              ticketsApplicants: work.ticketsApplicants,
              finishedBy: work.finishedBy,
              startedAt: work.startedAt,
              finishedAt: work.finishedAt,
              duration: new Date(work.finishedAt) - new Date(work.startedAt),
            };
          }),
        );
        setTotalTime(data.totalTime);
      },
    );
  };

  return (
    <Transitions>
      <>
        <Card.Title className="mb-3 border-bottom">
          <h1 className="display-4">
            <RiDraftLine /> Отчёт по работам
          </h1>
        </Card.Title>
        <Form onSubmit={submitHandler}>
          <Row>
            <Col sm="auto">
              <Form.Group className="mb-3">
                <Form.Label htmlFor="company">Компания</Form.Label>
                <Select
                  id="company"
                  placeholder="Выберите компанию"
                  required
                  isClearable
                  isSearchable
                  options={companies}
                  getOptionLabel={(option) => `${option.alias}`}
                  getOptionValue={(option) => option._id}
                  onChange={companyChangeHandler}
                />
              </Form.Group>
            </Col>
            <Col sm="auto">
              <Form.Group className="mb-3">
                <Form.Label htmlFor="category">Категория</Form.Label>
                <Select
                  id="category"
                  placeholder="Выберите категорию"
                  isClearable
                  isSearchable
                  options={categories}
                  getOptionLabel={(option) => `${option.title}`}
                  getOptionValue={(option) => option._id}
                  onChange={categoryChangeHandler}
                />
              </Form.Group>
            </Col>
            <Col sm="auto">
              <Form.Group className="mb-3">
                <Form.Label>Начало периода</Form.Label>
                <Form.Control type="date" ref={fromInputRef} required />
              </Form.Group>
            </Col>
            <Col sm="auto">
              <Form.Group className="mb-3">
                <Form.Label>Конец периода</Form.Label>
                <Form.Control type="date" ref={toInputRef} required />
              </Form.Group>
            </Col>
          </Row>
          <Row className="mb-3">
            <Col sm="auto">
              <Form.Group>
                <Button type="submit" className="mb-2 w-100">
                  Применить
                </Button>
              </Form.Group>
            </Col>
          </Row>
        </Form>
        <Row>
          <Col>
            {works.length > 0 && !isLoading && (
              <Transitions>
                <Table striped hover className="table-responsive sortable">
                  <thead>
                    <tr>
                      <th>Заявки</th>
                      <th>Инициаторы</th>
                      <th>Категории</th>
                      <th>Описание работ</th>
                      <th>Исполнитель</th>
                      <th>Длительность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {works.map((work) => (
                      <tr
                        key={work._id}
                        className={
                          parseInt(msToHMS(work.duration), 10) >= 12
                            ? "table-warning"
                            : ""
                        }
                      >
                        <td data-cell="Заявки">
                          {work.ticketsNums.map((num) => (
                            <div key={Math.random()}>
                              <a
                                href={`/tickets/${num}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {num}
                              </a>
                              <br></br>
                            </div>
                          ))}
                        </td>
                        <td data-cell="инициаторы">
                          {work.ticketsApplicants.map((applicant) => (
                            <div key={Math.random()}>
                              {applicant}
                              <br></br>
                            </div>
                          ))}
                        </td>
                        <td data-cell="категории">
                          {work.ticketsCategories.map((category) => (
                            <div key={Math.random()}>
                              {category.title}
                              <br></br>
                            </div>
                          ))}
                        </td>
                        <td data-cell="описание работ">{work.description}</td>
                        <td data-cell="исполнитель">{work.finishedBy}</td>
                        <td
                          data-cell="длительность"
                          className="table-align-right"
                        >
                          {msToHMS(work.duration)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5}>ИТОГО: </td>
                      <td data-cell="итого">
                        {msToHMS(totalTime ? totalTime : 0)}
                      </td>
                    </tr>
                  </tfoot>
                </Table>
              </Transitions>
            )}
            {isLoading && <Spinner />}
          </Col>
        </Row>
      </>
    </Transitions>
  );
};

export default WorkReport;

export async function loader() {
  document.title = "ОТЧЁТ ПО РАБОТАМ";

  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/report/form-data`,
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
