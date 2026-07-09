import { useState, useEffect } from "react";
import { useFetcher } from "react-router";

import { formatDate } from "../../../util/format-date";

import Button from "react-bootstrap/Button";
import Table from "react-bootstrap/Table";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Pagination from "react-bootstrap/Pagination";
import Spinner from "react-bootstrap/Spinner";

import { RiUserAddLine, RiUserLine, RiComputerLine } from "react-icons/ri";

import Select from "../../../UI/Select";
import { getLocalStorageData } from "../../../util/auth";

const CompanyLogsSection = ({ company, permissions }) => {
  const fetcher = useFetcher();

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({
    current: 1,
    total: 1,
    count: 0,
  });
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleCloseLinkModal = () => {
    setShowLinkModal(false);
    setSelectedLog(null);
    setSelectedUser(null);
  };

  const handleShowLinkModal = (log) => {
    setSelectedLog(log);
    setShowLinkModal(true);
  };

  const handleLinkUser = (event) => {
    event.preventDefault();

    if (!selectedUser || !selectedLog) return;

    fetcher.submit(
      {
        intent: "linkUserToAD",
        logId: selectedLog._id,
        userId: selectedUser._id,
      },
      {
        method: "POST",
        action: `/companies/${company._id}`,
      },
    );
  };

  // Единый формат приложения (бизнес-таймзона) — util/format-date.
  const formatDateTime = (dateString) => formatDate(dateString);

  const getActionBadge = (action) => {
    switch (action) {
      case "userLogin":
        return <Badge bg="success">Вход в систему</Badge>;
      default:
        return <Badge bg="secondary">{action}</Badge>;
    }
  };

  // Функция для загрузки логов
  const loadLogs = async (page = 1) => {
    setLoading(true);
    try {
      const { token } = getLocalStorageData();
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/companies/${company._id}/logs?page=${page}`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );

      if (response.ok) {
        const data = await response.json();
        setLogs(data.logs);
        setPagination(data.pagination);
      } else {
        console.error("Failed to load logs");
      }
    } catch (error) {
      console.error("Error loading logs:", error);
    } finally {
      setLoading(false);
    }
  };

  // Загрузка логов при изменении страницы
  useEffect(() => {
    loadLogs(currentPage);
  }, [currentPage, company._id]);

  // Загрузка пользователей компании для связывания
  useEffect(() => {
    if (showLinkModal && users.length === 0) {
      const companyUsers = [
        ...company.users.map((user) => ({
          _id: user.id,
          firstName: user.fullName?.split(" ")[0] || "",
          lastName: user.fullName?.split(" ")[1] || "",
          email: user.email,
        })),
        ...company.employees.map((user) => user),
      ].filter(
        (user, index, self) =>
          index ===
          self.findIndex((u) => u._id.toString() === user._id.toString()),
      );
      setUsers(companyUsers);
    }
  }, [showLinkModal, company.users, company.employees, users.length]);

  // Закрыть модальное окно после успешного связывания
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      !fetcher.data.error &&
      showLinkModal
    ) {
      handleCloseLinkModal();
      // Обновить логи
      loadLogs(currentPage);
    }
  }, [fetcher.state, fetcher.data, showLinkModal]);

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const renderPagination = () => {
    if (pagination.total <= 1) return null;

    const items = [];
    const maxPagesToShow = 5;
    let startPage = Math.max(
      1,
      pagination.current - Math.floor(maxPagesToShow / 2),
    );
    let endPage = Math.min(pagination.total, startPage + maxPagesToShow - 1);

    if (endPage - startPage + 1 < maxPagesToShow) {
      startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }

    for (let page = startPage; page <= endPage; page++) {
      items.push(
        <Pagination.Item
          key={page}
          active={page === pagination.current}
          onClick={() => handlePageChange(page)}
        >
          {page}
        </Pagination.Item>,
      );
    }

    return (
      <div className="d-flex justify-content-center mt-3">
        <Pagination>
          <Pagination.First
            onClick={() => handlePageChange(1)}
            disabled={pagination.current === 1}
          />
          <Pagination.Prev
            onClick={() => handlePageChange(pagination.current - 1)}
            disabled={pagination.current === 1}
          />
          {items}
          <Pagination.Next
            onClick={() => handlePageChange(pagination.current + 1)}
            disabled={pagination.current === pagination.total}
          />
          <Pagination.Last
            onClick={() => handlePageChange(pagination.total)}
            disabled={pagination.current === pagination.total}
          />
        </Pagination>
      </div>
    );
  };

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="mb-0">Лог активности</h5>
        <div className="text-muted small">
          Всего записей: {pagination.count}
        </div>
      </div>

      {loading && (
        <div className="text-center py-3">
          <Spinner animation="border" />
        </div>
      )}

      {logs.length > 0 ? (
        <>
          <Table responsive>
            <thead>
              <tr>
                <th>Время</th>
                <th>Пользователь</th>
                <th>AD Логин</th>
                <th>Компьютер</th>
                <th>Действие</th>
                <th>Связан с</th>
                {permissions.canManageCompanies && <th>Действия</th>}
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log._id}>
                  <td>{formatDateTime(log.timeStamp)}</td>
                  <td>
                    <div>
                      <strong>
                        {log.firstName} {log.lastName}
                      </strong>
                      <br />
                      <small className="text-muted">
                        {log.activeDirectoryObjectGUID}
                      </small>
                    </div>
                  </td>
                  <td className="font-monospace">{log.activeDirectoryLogin}</td>
                  <td>
                    {log.computerName && (
                      <span>
                        <RiComputerLine /> {log.computerName}
                      </span>
                    )}
                  </td>
                  <td>{getActionBadge(log.action)}</td>
                  <td>
                    {log.userId ? (
                      <div className="text-success">
                        <RiUserLine /> {log.userId.firstName}{" "}
                        {log.userId.lastName}
                        <br />
                        <small className="text-muted">{log.userId.email}</small>
                      </div>
                    ) : (
                      <Badge bg="warning">Не связан</Badge>
                    )}
                  </td>
                  {permissions.canManageCompanies && (
                    <td>
                      {!log.userId && (
                        <Button
                          variant="outline-primary"
                          size="sm"
                          onClick={() => handleShowLinkModal(log)}
                        >
                          <RiUserAddLine /> Связать
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>

          {renderPagination()}
        </>
      ) : (
        !loading && <p className="text-muted">Лог активности отсутствует</p>
      )}

      {/* Модальное окно для связывания пользователя */}
      <Modal show={showLinkModal} onHide={handleCloseLinkModal} centered>
        <Form onSubmit={handleLinkUser}>
          <Modal.Header closeButton>
            <Modal.Title>Связать с пользователем</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {fetcher.data?.error && (
              <Alert variant="danger">{fetcher.data.error}</Alert>
            )}

            {selectedLog && (
              <div className="mb-3 p-3 bg-light rounded">
                <strong>Active Directory пользователь:</strong>
                <br />
                {selectedLog.firstName} {selectedLog.lastName} (
                {selectedLog.activeDirectoryLogin})
                <br />
                <small className="text-muted">
                  GUID: {selectedLog.activeDirectoryObjectGUID}
                </small>
              </div>
            )}

            <Form.Group className="mb-3">
              <Form.Label htmlFor="userId">
                Выберите пользователя системы
              </Form.Label>
              <Select
                id="userId"
                placeholder="Выберите пользователя для связывания"
                required
                isClearable
                isSearchable
                options={users}
                getOptionLabel={(option) =>
                  `${option.firstName || ""} ${option.lastName || ""} (${option.email})`
                }
                getOptionValue={(option) => option._id}
                onChange={setSelectedUser}
                value={selectedUser}
              />
              <Form.Text className="text-muted">
                После связывания все записи с данным GUID будут автоматически
                привязаны к выбранному пользователю.
              </Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleCloseLinkModal}>
              Отмена
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={fetcher.state !== "idle" || !selectedUser}
            >
              {fetcher.state !== "idle" ? "Связывание..." : "Связать"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
};

export default CompanyLogsSection;
