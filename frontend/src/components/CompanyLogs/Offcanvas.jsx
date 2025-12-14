import { useState, useEffect } from "react";
import { useFetcher } from "react-router";

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
  RiCloseLine,
  RiRefreshLine,
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
  const fetcher = useFetcher();

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

  const formatDateTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString("ru-RU");
  };

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

    console.log(log);

    const companyUsers = [
      ...(company.users?.map((user) => ({
        _id: user._id,
        firstName: user.fullName?.split(" ")[0] || "",
        lastName: user.fullName?.split(" ")[1] || "",
        email: user.email,
      })) || []),
      ...(company.employees || []),
    ].filter(
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
  };

  const handleLinkUser = (event) => {
    event.preventDefault();
    if (!selectedUser || !selectedLog) return;

    fetcher.submit(
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

  // Закрыть модальное окно после успешного связывания и обновить логи
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      !fetcher.data.error &&
      showLinkModal
    ) {
      handleCloseLinkModal();
      loadLogs(currentPage, searchQuery);
    }
  }, [fetcher.state, fetcher.data, showLinkModal, currentPage, searchQuery]);

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
            Логи активности - {company.alias}
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
                          {!log.userId && (
                            <Button
                              variant="outline-primary"
                              size="sm"
                              onClick={() => handleShowLinkModal(log)}
                            >
                              <RiUserAddLine />
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
                  : "Логи активности отсутствуют"}
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

export default CompanyLogsOffcanvas;
