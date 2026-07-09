import { useState } from "react";
import { useFetcher } from "react-router";

import Button from "react-bootstrap/Button";
import Table from "react-bootstrap/Table";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";

import AlertMessage from "../../../UI/AlertMessage";
import { formatShortDate } from "../../../util/format-date";

import {
  RiAddLine,
  RiDeleteBinLine,
  RiEyeLine,
  RiEyeOffLine,
  RiFileCopyLine,
  RiKey2Line,
} from "react-icons/ri";

const ApiKeysSection = ({ company, permissions }) => {
  const fetcher = useFetcher();

  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState(null);
  const [keyName, setKeyName] = useState("");
  const [visibleKeys, setVisibleKeys] = useState({});
  const [copiedKey, setCopiedKey] = useState("");

  const handleClose = () => {
    setShowModal(false);
    setKeyName("");
  };

  const handleCloseDelete = () => {
    setShowDeleteModal(false);
    setKeyToDelete(null);
  };

  const handleShow = () => setShowModal(true);

  const handleSubmit = (event) => {
    event.preventDefault();

    fetcher.submit(
      {
        intent: "createApiKey",
        companyId: company._id,
        keyName: keyName,
      },
      {
        method: "POST",
        action: `/companies/${company._id}`,
      },
    );
  };

  const handleDeleteKey = (keyId, keyName) => {
    setKeyToDelete({ id: keyId, name: keyName });
    setShowDeleteModal(true);
  };

  const confirmDeleteKey = () => {
    if (keyToDelete) {
      fetcher.submit(
        {
          intent: "deleteApiKey",
          companyId: company._id,
          keyId: keyToDelete.id,
        },
        {
          method: "POST",
          action: `/companies/${company._id}`,
        },
      );
      handleCloseDelete();
    }
  };

  const toggleKeyVisibility = (keyId) => {
    setVisibleKeys((prev) => ({
      ...prev,
      [keyId]: !prev[keyId],
    }));
  };

  const copyToClipboard = async (key, keyId) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(keyId);
      setTimeout(() => setCopiedKey(""), 2000);
    } catch (err) {
      console.error("Ошибка при копировании:", err);
    }
  };

  const maskKey = (key) => {
    if (key.length <= 8) return key;
    return key.substring(0, 4) + "****" + key.substring(key.length - 4);
  };

  // Закрыть модальные окна после успешных операций
  if (
    fetcher.state === "idle" &&
    fetcher.data &&
    !fetcher.data.error &&
    showModal
  ) {
    handleClose();
  }

  if (
    fetcher.state === "idle" &&
    fetcher.data &&
    !fetcher.data.error &&
    showDeleteModal
  ) {
    handleCloseDelete();
  }

  return (
    <>
      <div className="d-flex justify-content-between align-items-center gap-2 mb-3">
        <div className="cap-card-title">
          <RiKey2Line />
          <span>API-ключи</span>
        </div>
        {permissions.canManageCompanies && (
          <Button variant="primary" size="sm" onClick={handleShow}>
            <RiAddLine /> Создать ключ
          </Button>
        )}
      </div>

      {company.apiKeys && company.apiKeys.length > 0 ? (
        <Table responsive>
          <thead>
            <tr>
              <th>Название</th>
              <th>Ключ</th>
              <th>Создан</th>
              <th>Статус</th>
              {permissions.canManageCompanies && <th>Действия</th>}
            </tr>
          </thead>
          <tbody>
            {company.apiKeys.map((apiKey) => (
              <tr key={apiKey._id}>
                <td>{apiKey.name}</td>
                <td className="d-flex align-items-center gap-2">
                  <span className="font-monospace">
                    {visibleKeys[apiKey._id] ? apiKey.key : maskKey(apiKey.key)}
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0"
                    onClick={() => toggleKeyVisibility(apiKey._id)}
                    title={
                      visibleKeys[apiKey._id] ? "Скрыть ключ" : "Показать ключ"
                    }
                  >
                    {visibleKeys[apiKey._id] ? <RiEyeOffLine /> : <RiEyeLine />}
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0"
                    onClick={() => copyToClipboard(apiKey.key, apiKey._id)}
                    title="Копировать ключ"
                  >
                    <RiFileCopyLine />
                  </Button>
                  {copiedKey === apiKey._id && (
                    <small className="text-success">Скопировано!</small>
                  )}
                </td>
                <td>{formatShortDate(apiKey.createdAt)}</td>
                <td>
                  <Badge bg={apiKey.isActive ? "success" : "danger"}>
                    {apiKey.isActive ? "Активен" : "Неактивен"}
                  </Badge>
                </td>
                {permissions.canManageCompanies && (
                  <td>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => handleDeleteKey(apiKey._id, apiKey.name)}
                    >
                      <RiDeleteBinLine />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <AlertMessage variant="light" message="API-ключи не созданы" />
      )}

      <Modal show={showModal} onHide={handleClose} centered>
        <Form onSubmit={handleSubmit}>
          <Modal.Header closeButton>
            <Modal.Title>Создать API-ключ</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {fetcher.data?.error && (
              <Alert variant="danger">{fetcher.data.error}</Alert>
            )}
            <Form.Group className="mb-3">
              <Form.Label htmlFor="keyName">Название ключа</Form.Label>
              <Form.Control
                type="text"
                id="keyName"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="Введите название для API-ключа"
                required
              />
              <Form.Text className="text-muted">
                Например: "Мобильное приложение", "Интеграция с CRM" и т.д.
              </Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleClose}>
              Отмена
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={fetcher.state !== "idle" || !keyName.trim()}
            >
              {fetcher.state !== "idle" ? "Создание..." : "Создать"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Modal для подтверждения удаления */}
      <Modal show={showDeleteModal} onHide={handleCloseDelete} centered>
        <Modal.Header closeButton>
          <Modal.Title>Удалить API-ключ</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {keyToDelete && (
            <>
              Вы уверены, что хотите удалить API-ключ "
              <strong>{keyToDelete.name}</strong>"?
              <br />
              <small className="text-muted">
                Это действие нельзя отменить.
              </small>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseDelete}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={confirmDeleteKey}
            disabled={fetcher.state !== "idle"}
          >
            <RiDeleteBinLine />{" "}
            {fetcher.state !== "idle" ? "Удаление..." : "Удалить"}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default ApiKeysSection;
