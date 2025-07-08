import { useState } from "react";
import { useRevalidator } from "react-router";
import pad from "pad";

import Offcanvas from "react-bootstrap/Offcanvas";
import Table from "react-bootstrap/Table";
import Container from "react-bootstrap/Container";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import Badge from "react-bootstrap/Badge";
import Spinner from "react-bootstrap/Spinner";
import Alert from "react-bootstrap/Alert";
import { getLocalStorageData } from "../../util/auth";
import Select from "../../UI/Select";

const UnrelatedWorksOffcanvas = ({ unrelatedWorks }) => {
  const [showUnrelatedWorks, setShowUnrelatedWorks] = useState(false);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [newCategory, setNewCategory] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const [availableCategories, setAvailableCategories] = useState([]);
  const [ticketInfo, setTicketInfo] = useState({});
  const [alertInfo, setAlertInfo] = useState({
    show: false,
    message: "",
    variant: "danger",
  });
  const [waitingForRevalidation, setWaitingForRevalidation] = useState(false);

  const revalidator = useRevalidator();

  const handleCloseUnrelatedWorks = () => setShowUnrelatedWorks(false);
  const handleShowUnrelatedWorks = () => setShowUnrelatedWorks(true);

  const { token } = getLocalStorageData();

  const handleShowTicketModal = async (ticket, workCategories) => {
    setSelectedTicket(ticket);
    setNewCategory(ticket.categoryId || "");

    // Fetch available categories from the API
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/ticket-categories`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );
      const data = await response.json();

      setAvailableCategories(data || []);
    } catch (error) {
      console.error("Error fetching categories:", error);
      // Fallback to work categories if API fails
      setAvailableCategories(workCategories || []);
    }

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticket?.num}`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );
      const data = await response.json();
      console.log(data);
      setTicketInfo(data?.ticket || {});
    } catch (error) {
      console.error("Error fetching ticket:", error);
      // Fallback to work categories if API fails
      setAvailableCategories(workCategories || []);
    }

    setShowTicketModal(true);
  };

  const handleCloseTicketModal = () => {
    setShowTicketModal(false);
    setSelectedTicket(null);
    setNewCategory("");
  };

  const handleUpdateCategory = async () => {
    if (!selectedTicket || !newCategory) return;

    setIsUpdating(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/tickets/update`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            _id: selectedTicket._id,
            categoryId: newCategory._id,
          }),
        },
      );

      if (response.ok) {
        setWaitingForRevalidation(true);
        revalidator.revalidate();
        // Close modal after a short delay to ensure revalidation completes
        setTimeout(() => {
          handleCloseTicketModal();
          setWaitingForRevalidation(false);
        }, 1000);
      } else {
        console.error("Failed to update ticket category");
        setAlertInfo({
          show: true,
          message: "Не удалось обновить категорию заявки",
          variant: "danger",
        });
      }
    } catch (error) {
      console.error("Error updating category:", error);
      setAlertInfo({
        show: true,
        message: "Произошла ошибка при обновлении категории",
        variant: "danger",
      });
    } finally {
      setIsUpdating(false);
    }
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

  const worktimeTotalDuration = unrelatedWorks.reduce((acc, work) => {
    return acc + (new Date(work.finishedAt) - new Date(work.startedAt));
  }, 0);

  return (
    <>
      {unrelatedWorks.length > 0 && (
        <Button
          onClick={handleShowUnrelatedWorks}
          variant="link"
          size="sm"
          className="text-primary bg-warning mx-2"
        >
          <strong>{`Выполненные работы, не попавшие ни в одну из услуг: ${unrelatedWorks.length}`}</strong>
        </Button>
      )}
      <Offcanvas
        show={showUnrelatedWorks}
        onHide={handleCloseUnrelatedWorks}
        keyboard
        placement="bottom"
        className="h-100"
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            Выполненные работы, не попавшие ни в одну из услуг
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <Container>
            {unrelatedWorks.length === 0 ? (
              <Alert variant="info" className="text-center">
                <Alert.Heading>Список пуст</Alert.Heading>
                <p className="mb-0">
                  Нет выполненных работ, не попавших ни в одну из услуг
                </p>
              </Alert>
            ) : (
              <Table bordered>
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
                  {unrelatedWorks.map((work) => (
                    <tr
                      key={work._id}
                      className={
                        parseInt(msToHMS(work.duration), 10) >= 12
                          ? "table-warning"
                          : ""
                      }
                    >
                      <td data-cell="Заявки">
                        {work.tickets.map((ticket) => (
                          <div key={Math.random()}>
                            <Button
                              variant="link"
                              className="p-0 text-primary"
                              onClick={() =>
                                handleShowTicketModal(
                                  ticket,
                                  work.ticketsCategories,
                                )
                              }
                            >
                              {ticket.num}
                            </Button>
                            <br></br>
                          </div>
                        ))}
                      </td>
                      <td data-cell="инициаторы">
                        {work.tickets.map((ticket) => (
                          <div key={Math.random()}>
                            {ticket.applicantId
                              ? `${ticket.applicantId.lastName} ${ticket.applicantId.firstName}`
                              : "Пользователь не найден"}
                            <br></br>
                          </div>
                        ))}
                      </td>
                      <td data-cell="категории">
                        {work.ticketsCategories.map((category) => (
                          <div key={Math.random()}>
                            <Badge
                              bg={
                                category.alwaysWithinPlan
                                  ? "success"
                                  : "secondary"
                              }
                              className="mb-1"
                            >
                              {category.title}
                            </Badge>
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
                        {msToHMS(
                          new Date(work.finishedAt) - new Date(work.startedAt),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="table-secondary fw-bold">
                    <td colSpan={5}>Итого:</td>
                    <td className="table-align-right">
                      {msToHMS(worktimeTotalDuration)}
                    </td>
                  </tr>
                </tfoot>
              </Table>
            )}
          </Container>
        </Offcanvas.Body>
      </Offcanvas>

      {/* Ticket Info and Category Update Modal */}
      <Modal
        centered
        show={showTicketModal}
        onHide={handleCloseTicketModal}
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>Заявка #{ticketInfo?.num}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {alertInfo.show && (
            <Alert
              variant={alertInfo.variant}
              onClose={() => setAlertInfo({ ...alertInfo, show: false })}
              dismissible
            >
              {alertInfo.message}
            </Alert>
          )}
          {ticketInfo && (
            <div>
              <div className="mb-3">
                <strong>Описание:</strong>
                <p>
                  {ticketInfo.description ||
                    ticketInfo.title ||
                    "Описание не указано"}
                </p>
              </div>

              <div className="mb-3">
                <strong>Инициатор:</strong>
                <p>
                  {ticketInfo.applicant
                    ? `${ticketInfo.applicant.lastName} ${ticketInfo.applicant.firstName}`
                    : "Пользователь не найден"}
                </p>
              </div>

              <div className="mb-3">
                <strong>Статус:</strong>
                <Badge bg="info" className="ms-2">
                  {ticketInfo.state || "Не указан"}
                </Badge>
              </div>

              <div className="mb-3">
                <strong>Текущая категория:</strong>
                <Badge bg="secondary" className="ms-2">
                  {ticketInfo.category?.title || "Не указана"}
                </Badge>
              </div>

              <div className="mb-3">
                <Form.Label htmlFor="category">
                  <strong>Изменить категорию:</strong>
                </Form.Label>

                <Select
                  id="category"
                  name="category"
                  placeholder="Выберите категорию"
                  aria-labelledby="aria-category"
                  inputId="aria-category-input"
                  isClearable
                  isSearchable
                  options={availableCategories}
                  getOptionLabel={(option) => `${option.title}`}
                  getOptionValue={(option) => option._id}
                  value={newCategory}
                  onChange={(selectedItem) => setNewCategory(selectedItem)}
                />
              </div>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseTicketModal}>
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={handleUpdateCategory}
            disabled={!newCategory || isUpdating || waitingForRevalidation}
          >
            {isUpdating || waitingForRevalidation ? (
              <>
                <Spinner
                  as="span"
                  animation="border"
                  size="sm"
                  role="status"
                  aria-hidden="true"
                  className="me-2"
                />
                {isUpdating ? "Обновление..." : "Обновление данных..."}
              </>
            ) : (
              "Обновить категорию"
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default UnrelatedWorksOffcanvas;
