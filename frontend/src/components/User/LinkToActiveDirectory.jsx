import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Spinner from "react-bootstrap/Spinner";

import {
  RiShieldCheckLine,
  RiShieldLine,
  RiComputerLine,
} from "react-icons/ri";

import Select from "../../UI/Select";
import { getLocalStorageData } from "../../util/auth";

// Действие на странице пользователя: связать его учётную запись с Active
// Directory или отвязать. Логика связывания та же, что и в
// components/CompanyLogs/, но «инвертированная»: фиксирован пользователь, а
// AD-логин выбирается из логов активности его компании.
const LinkToActiveDirectory = ({ user }) => {
  const companyId = user.company?._id;
  const isLinked = Boolean(user.activeDirectoryObjectGUID);

  const fetcher = useFetcher();

  // Стартуем в состоянии загрузки, если логины предстоит подгрузить, — иначе
  // кнопка на мгновение мелькнёт отключённой до запуска запроса.
  const [loading, setLoading] = useState(Boolean(companyId) && !isLinked);
  // Доступные для связывания AD-логины (уникальные по GUID, ещё ни с кем не
  // связанные).
  const [adLogins, setAdLogins] = useState([]);
  const [show, setShow] = useState(false);
  const [selectedLogin, setSelectedLogin] = useState(null);

  // Загружаем логи компании, чтобы понять, есть ли доступные AD-логины, и
  // заполнить выпадающий список. Для уже связанного пользователя список не
  // нужен — показываем кнопку «Отвязать».
  useEffect(() => {
    if (!companyId || isLinked) return;

    let cancelled = false;

    const loadAdLogins = async () => {
      setLoading(true);
      try {
        const { token } = getLocalStorageData();
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/companies/${companyId}/logs?page=1&limit=1000`,
          { headers: { Authorization: "Bearer " + token } },
        );

        if (!response.ok) return;

        const data = await response.json();
        if (cancelled) return;

        // Оставляем только ещё не связанные записи и убираем дубли по GUID —
        // на один AD-логин приходится много записей входа.
        const seen = new Set();
        const logins = [];
        for (const log of data.logs || []) {
          if (log.userId) continue;
          if (!log.activeDirectoryObjectGUID) continue;
          if (seen.has(log.activeDirectoryObjectGUID)) continue;
          seen.add(log.activeDirectoryObjectGUID);
          logins.push(log);
        }
        setAdLogins(logins);
      } catch (error) {
        console.error("Не удалось загрузить логи компании:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadAdLogins();

    return () => {
      cancelled = true;
    };
  }, [companyId, isLinked]);

  // Закрываем окно только при реальном переходе fetcher из активного
  // состояния в idle с успешным ответом — иначе устаревшие данные fetcher
  // закрыли бы окно сразу при открытии.
  const prevState = useRef(fetcher.state);
  useEffect(() => {
    const wasActive = prevState.current !== "idle";
    prevState.current = fetcher.state;

    if (
      wasActive &&
      fetcher.state === "idle" &&
      fetcher.data &&
      !fetcher.data.error
    ) {
      setShow(false);
      setSelectedLogin(null);
    }
  }, [fetcher.state, fetcher.data]);

  const handleShow = () => setShow(true);
  const handleClose = () => {
    setShow(false);
    setSelectedLogin(null);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!companyId) return;

    if (isLinked) {
      fetcher.submit(
        { intent: "unlinkUserFromAD", userId: user._id },
        { method: "POST", action: `/companies/${companyId}` },
      );
      return;
    }

    if (!selectedLogin) return;

    fetcher.submit(
      {
        intent: "linkUserToAD",
        userId: user._id,
        activeDirectoryObjectGUID: selectedLogin.activeDirectoryObjectGUID,
      },
      { method: "POST", action: `/companies/${companyId}` },
    );
  };

  const submitting = fetcher.state !== "idle";

  // ---- Уже связан: кнопка отвязки ----
  if (isLinked) {
    return (
      <>
        <Button
          variant="outline-danger"
          className="mb-2 w-100"
          onClick={handleShow}
          disabled={!companyId}
        >
          <RiShieldLine /> Отвязать от Active Directory
        </Button>

        <Modal show={show} onHide={handleClose} centered>
          <Form onSubmit={handleSubmit}>
            <Modal.Header closeButton>
              <Modal.Title>Отвязать от Active Directory</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              {fetcher.data?.error && (
                <Alert variant="danger">
                  {fetcher.data.message || "Не удалось отвязать пользователя"}
                </Alert>
              )}
              <p>
                Отвязать пользователя {user.firstName} {user.lastName} от Active
                Directory?
              </p>
              <div className="p-3 bg-light rounded">
                <small className="text-muted">
                  GUID: {user.activeDirectoryObjectGUID}
                </small>
              </div>
              <Alert variant="warning" className="mt-3 mb-0">
                <small>
                  После отвязки все записи логов с данным GUID перестанут быть
                  привязаны к пользователю системы.
                </small>
              </Alert>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onClick={handleClose}>
                Отмена
              </Button>
              <Button variant="danger" type="submit" disabled={submitting}>
                {submitting ? "Отвязка..." : "Отвязать"}
              </Button>
            </Modal.Footer>
          </Form>
        </Modal>
      </>
    );
  }

  // ---- Ещё не связан: кнопка связывания ----
  const noLogins = !loading && adLogins.length === 0;
  const disabled = !companyId || loading || noLogins;

  return (
    <>
      <Button
        variant="outline-primary"
        className="mb-2 w-100"
        onClick={handleShow}
        disabled={disabled}
        title={
          noLogins
            ? "Нет доступных для связывания учётных записей Active Directory"
            : undefined
        }
      >
        {loading ? (
          <Spinner animation="border" size="sm" className="me-1" />
        ) : (
          <RiShieldCheckLine />
        )}{" "}
        Связать с Active Directory
      </Button>

      <Modal show={show} onHide={handleClose} centered>
        <Form onSubmit={handleSubmit}>
          <Modal.Header closeButton>
            <Modal.Title>Связать с Active Directory</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {fetcher.data?.error && (
              <Alert variant="danger">
                {fetcher.data.message || "Не удалось связать пользователя"}
              </Alert>
            )}

            <div className="mb-3 p-3 bg-light rounded">
              <strong>Пользователь системы:</strong>
              <br />
              {user.firstName} {user.lastName}
              {user.email && (
                <>
                  <br />
                  <small className="text-muted">{user.email}</small>
                </>
              )}
            </div>

            <Form.Group className="mb-3">
              <Form.Label htmlFor="adLogin">
                Выберите учётную запись Active Directory
              </Form.Label>
              <Select
                id="adLogin"
                placeholder={
                  adLogins.length === 0
                    ? "Нет доступных AD-логинов"
                    : "Выберите AD-логин для связывания"
                }
                required
                isClearable
                isSearchable
                options={adLogins}
                getOptionLabel={(option) =>
                  `${option.firstName || ""} ${option.lastName || ""} (${option.activeDirectoryLogin})`.trim()
                }
                getOptionValue={(option) => option.activeDirectoryObjectGUID}
                onChange={setSelectedLogin}
                value={selectedLogin}
                isDisabled={adLogins.length === 0}
              />
              <Form.Text className="text-muted">
                После связывания все записи логов с данным GUID будут
                автоматически привязаны к пользователю.
              </Form.Text>
            </Form.Group>

            {selectedLogin && (
              <div className="p-3 bg-light rounded">
                <strong>Active Directory:</strong>
                <br />
                {selectedLogin.firstName} {selectedLogin.lastName} (
                {selectedLogin.activeDirectoryLogin})
                {selectedLogin.computerName && (
                  <>
                    <br />
                    <small className="text-muted">
                      <RiComputerLine /> {selectedLogin.computerName}
                    </small>
                  </>
                )}
                <br />
                <small className="text-muted">
                  GUID: {selectedLogin.activeDirectoryObjectGUID}
                </small>
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleClose}>
              Отмена
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={submitting || !selectedLogin}
            >
              {submitting ? "Связывание..." : "Связать"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
};

export default LinkToActiveDirectory;
