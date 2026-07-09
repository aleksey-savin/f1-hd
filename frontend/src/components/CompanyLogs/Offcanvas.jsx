import { useState, useEffect } from "react";
import { useFetcher } from "react-router";

import { formatDate } from "../../util/format-date";

import Offcanvas from "react-bootstrap/Offcanvas";
import Button from "react-bootstrap/Button";
import Table from "react-bootstrap/Table";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Pagination from "react-bootstrap/Pagination";
import Spinner from "react-bootstrap/Spinner";
import InputGroup from "react-bootstrap/InputGroup";
import FormControl from "react-bootstrap/FormControl";

import {
  RiUserAddLine,
  RiUserLine,
  RiComputerLine,
  RiSearchLine,
  RiRefreshLine,
  RiUserUnfollowLine,
} from "react-icons/ri";

import Select from "../../UI/Select";
import { getLocalStorageData } from "../../util/auth";

const CompanyLogsOffcanvas = ({
  show,
  onHide,
  companyId,
  company = {},
  permissions = {},
  initialSearchQuery = "",
}) => {
  const linkFetcher = useFetcher({ key: "linkUser" });
  const unlinkFetcher = useFetcher({ key: "unlinkUser" });

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({
    current: 1,
    total: 1,
    count: 0,
  });
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [currentPage, setCurrentPage] = useState(1);

  // Модальное окно для связывания пользователей
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [users, setUsers] = useState([]);

  // Модальное окно для отвязывания пользователей
  const [showUnlinkModal, setShowUnlinkModal] = useState(false);
  const [selectedUnlinkLog, setSelectedUnlinkLog] = useState(null);

  // Загрузка логов
  const loadLogs = async (page = 1, search = "") => {
    if (!companyId) return;

    setLoading(true);
    try {
      const { token } = getLocalStorageData();
      const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/companies/${companyId}/logs?page=${page}&limit=20${searchParam}`,
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

  // Загружаем логи при открытии offcanvas
  useEffect(() => {
    if (show && companyId) {
      loadLogs(currentPage, searchQuery);
    }
  }, [show, companyId, currentPage]);

  // Обновляем поиск при изменении initialSearchQuery
  useEffect(() => {
    if (initialSearchQuery !== searchQuery) {
      setSearchQuery(initialSearchQuery);
      setCurrentPage(1);
    }
  }, [initialSearchQuery]);

  // Выполняем поиск при изменении searchQuery
  useEffect(() => {
    if (show && companyId) {
      const timeoutId = setTimeout(() => {
        setCurrentPage(1);
        loadLogs(1, searchQuery);
      }, 300);
      return () => clearTimeout(timeoutId);
    }
  }, [searchQuery, show, companyId]);

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
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

  // Модальное окно для связывания пользователей
  const handleShowLinkModal = (log) => {
    setSelectedLog(log);

    // Collect all users from different sources
    const allUsers = [];

    // Company employees
    if (company.employees) {
      company.employees.forEach((user) => {
        allUsers.push({
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
        });
      });
    }

    // Deduplicate users by ID
    const companyUsers = allUsers.filter(
      (user, index, self) =>
        user._id &&
        index ===
          self.findIndex(
            (u) => u._id && u._id.toString() === user._id.toString(),
          ),
    );

    setUsers(companyUsers);
    setShowLinkModal(true);
  };

  const handleCloseLinkModal = () => {
    setShowLinkModal(false);
    setSelectedLog(null);
    setSelectedUser(null);
    setUsers([]); // Reset users list
  };

  const handleLinkUser = (event) => {
    event.preventDefault();
    if (!selectedUser || !selectedLog) return;

    linkFetcher.submit(
      {
        intent: "linkUserToAD",
        activeDirectoryObjectGUID: selectedLog.activeDirectoryObjectGUID,
        userId: selectedUser._id,
      },
      {
        method: "POST",
        action: `/companies/${companyId}`,
      },
    );
  };

  const handleShowUnlinkModal = (log) => {
    setSelectedUnlinkLog(log);
    setShowUnlinkModal(true);
  };

  const handleCloseUnlinkModal = () => {
    setShowUnlinkModal(false);
    setSelectedUnlinkLog(null);
  };

  const handleUnlinkUser = (event) => {
    event.preventDefault();
    if (!selectedUnlinkLog?.userId?._id) return;

    unlinkFetcher.submit(
      {
        intent: "unlinkUserFromAD",
        userId: selectedUnlinkLog.userId._id,
      },
      {
        method: "POST",
        action: `/companies/${companyId}`,
      },
    );
  };

  // Закрыть модальное окно после успешного связывания и обновить логи
  useEffect(() => {
    if (
      linkFetcher.state === "idle" &&
      linkFetcher.data &&
      !linkFetcher.data.error &&
      showLinkModal
    ) {
      const timer = setTimeout(() => {
        handleCloseLinkModal();
        loadLogs(currentPage, searchQuery);
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [
    linkFetcher.state,
    linkFetcher.data,
    showLinkModal,
    currentPage,
    searchQuery,
  ]);

  // Закрыть модальное окно после успешного отвязывания и обновить логи
  useEffect(() => {
    if (
      unlinkFetcher.state === "idle" &&
      unlinkFetcher.data &&
      !unlinkFetcher.data.error &&
      showUnlinkModal
    ) {
      const timer = setTimeout(() => {
        handleCloseUnlinkModal();
        loadLogs(currentPage, searchQuery);
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [
    unlinkFetcher.state,
    unlinkFetcher.data,
    showUnlinkModal,
    currentPage,
    searchQuery,
  ]);

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
        <Pagination size="sm">
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
      <Offcanvas
        show={show}
        onHide={onHide}
        placement="bottom"
        className="h-75"
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            Лог активности - {company.alias}
            <small className="text-muted ms-2">
              Всего записей: {pagination.count}
            </small>
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {/* Поиск и обновление */}
          <div className="mb-3">
            <div className="d-flex gap-2">
              <Button
                variant="outline-secondary"
                onClick={() => loadLogs(currentPage, searchQuery)}
                disabled={loading}
              >
                <RiRefreshLine />
              </Button>
              <div className="flex-grow-1">
                <Form onSubmit={(e) => e.preventDefault()}>
                  <InputGroup>
                    <InputGroup.Text>
                      <RiSearchLine />
                    </InputGroup.Text>
                    <FormControl
                      type="search"
                      placeholder="Поиск по имени, логину, компьютеру..."
                      value={searchQuery}
                      onChange={handleSearchChange}
                    />
                  </InputGroup>
                </Form>
              </div>
            </div>
          </div>

          {loading && (
            <div className="text-center py-4">
              <Spinner animation="border" />
            </div>
          )}

          {!loading && logs.length > 0 && (
            <>
              <Table responsive hover>
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Пользователь</th>
                    <th>AD Логин</th>
                    <th>Компьютер</th>
                    <th>Действие</th>
                    {permissions.canManageCompanies && <th>Действия</th>}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log._id}>
                      <td style={{ minWidth: "140px" }}>
                        <small>{formatDateTime(log.createdAt)}</small>
                      </td>
                      <td>
                        {log.userId && (
                          <div className="text-success">
                            <RiUserLine /> {log.userId.firstName}{" "}
                            {log.userId.lastName}
                            <br />
                            <small className="text-muted">
                              {log.userId.email}
                            </small>
                          </div>
                        )}
                        <strong>
                          {log.firstName} {log.lastName}
                        </strong>
                      </td>
                      <td className="font-monospace">
                        {log.activeDirectoryLogin}
                      </td>
                      <td>
                        {log.computerName && (
                          <span>
                            <RiComputerLine /> {log.computerName}
                          </span>
                        )}
                      </td>
                      <td>{getActionBadge(log.action)}</td>
                      {permissions.canManageCompanies && (
                        <td>
                          {!log.userId?._id ? (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => handleShowLinkModal(log)}
                              disabled={
                                linkFetcher.state !== "idle" ||
                                showLinkModal ||
                                showUnlinkModal
                              }
                            >
                              Связать <RiUserAddLine />
                            </Button>
                          ) : (
                            <Button
                              variant="outline-danger"
                              size="sm"
                              onClick={() => handleShowUnlinkModal(log)}
                              disabled={
                                unlinkFetcher.state !== "idle" ||
                                showLinkModal ||
                                showUnlinkModal
                              }
                            >
                              Отвязать <RiUserUnfollowLine />
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
          )}

          {!loading && logs.length === 0 && (
            <div className="text-center py-4">
              <p className="text-muted">
                {searchQuery
                  ? "По вашему запросу ничего не найдено"
                  : "Лог активности отсутствует"}
              </p>
            </div>
          )}
        </Offcanvas.Body>
      </Offcanvas>

      {/* Модальное окно для связывания пользователя */}
      <Modal show={showLinkModal} onHide={handleCloseLinkModal} centered>
        <Form onSubmit={handleLinkUser}>
          <Modal.Header closeButton>
            <Modal.Title>Связать с пользователем</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {linkFetcher.data?.error && (
              <Alert variant="danger">{linkFetcher.data.error}</Alert>
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
                placeholder={
                  users.length === 0
                    ? "Нет доступных пользователей"
                    : "Выберите пользователя для связывания"
                }
                required
                isClearable
                isSearchable
                options={users}
                getOptionLabel={(option) =>
                  `${option.firstName || ""} ${option.lastName || ""} (${option.email || "Без email"})`
                }
                getOptionValue={(option) => option._id}
                onChange={setSelectedUser}
                value={selectedUser}
                isDisabled={users.length === 0}
              />
              <Form.Text className="text-muted">
                {users.length === 0
                  ? "В компании нет пользователей для связывания."
                  : "После связывания все записи с данным GUID будут автоматически привязаны к выбранному пользователю."}
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
              disabled={linkFetcher.state !== "idle" || !selectedUser}
            >
              {linkFetcher.state !== "idle" ? "Связывание..." : "Связать"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Модальное окно для отвязки пользователя */}
      <Modal show={showUnlinkModal} onHide={handleCloseUnlinkModal} centered>
        <Form onSubmit={handleUnlinkUser}>
          <Modal.Header closeButton>
            <Modal.Title>Отвязать пользователя</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {unlinkFetcher.data?.error && (
              <Alert variant="danger">{unlinkFetcher.data.error}</Alert>
            )}

            {selectedUnlinkLog && (
              <div className="mb-3">
                <p>
                  Вы уверены, что хотите отвязать пользователя от Active
                  Directory?
                </p>

                <div className="p-3 bg-light rounded mb-3">
                  <strong>Связанный пользователь:</strong>
                  <br />
                  {selectedUnlinkLog.userId.firstName}{" "}
                  {selectedUnlinkLog.userId.lastName}
                  <br />
                  <small className="text-muted">
                    {selectedUnlinkLog.userId.email}
                  </small>
                </div>

                <div className="p-3 bg-warning bg-opacity-10 rounded">
                  <strong>Active Directory пользователь:</strong>
                  <br />
                  {selectedUnlinkLog.firstName} {selectedUnlinkLog.lastName} (
                  {selectedUnlinkLog.activeDirectoryLogin})
                  <br />
                  <small className="text-muted">
                    GUID: {selectedUnlinkLog.activeDirectoryObjectGUID}
                  </small>
                </div>

                <Alert variant="warning" className="mt-3">
                  <small>
                    После отвязки все записи логов с данным GUID станут не
                    привязанными к пользователю системы.
                  </small>
                </Alert>
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleCloseUnlinkModal}>
              Отмена
            </Button>
            <Button
              variant="danger"
              type="submit"
              disabled={unlinkFetcher.state !== "idle"}
            >
              {unlinkFetcher.state !== "idle" ? "Отвязка..." : "Отвязать"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
};

export default CompanyLogsOffcanvas;
