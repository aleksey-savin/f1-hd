import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import TreeNode from "../../../UI/TreeView";
import Select from "../../../UI/Select";
import SubdivisionUsersModal from "./SubdivisionUsersModal";

import { RiNodeTree, RiAddLine } from "react-icons/ri";

const SubdivisionsSection = ({ company, permissions }) => {
  const fetcher = useFetcher();
  const [showModal, setShowModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedSubdivision, setSelectedSubdivision] = useState(null);
  const [parentSubdivision, setParentSubdivision] = useState(undefined);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [subdivisionToDelete, setSubdivisionToDelete] = useState(null);
  const [error, setError] = useState(null);

  const handleClose = () => {
    setShowModal(false);
    setEditMode(false);
    setSelectedSubdivision(null);
    setParentSubdivision(undefined); // Changed from null to undefined
  };

  // Reset form when modal opens
  const handleShow = () => {
    setSelectedSubdivision(null);
    setParentSubdivision(undefined); // Changed from null to undefined
    setEditMode(false);
    setShowModal(true);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setError(null); // Clear any existing error
    const formData = new FormData(event.target);

    if (editMode) {
      formData.append("intent", "updateSubdivision");
      formData.append("subdivisionId", selectedSubdivision._id);
    } else {
      formData.append("intent", "addSubdivision");
    }

    formData.append("companyId", company._id);
    formData.append("parentId", parentSubdivision?._id || "");

    fetcher.submit(formData, {
      method: "PUT",
      action: `/companies/${company._id}`,
    });
  };

  const handleDeleteClick = (subdivisionId) => {
    setSubdivisionToDelete(subdivisionId);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = () => {
    fetcher.submit(
      {
        intent: "deleteSubdivision",
        subdivisionId: subdivisionToDelete,
        companyId: company._id,
      },
      {
        method: "DELETE",
        action: `/companies/${company._id}`,
      },
    );
    setShowDeleteModal(false);
    setSubdivisionToDelete(null);
  };

  // Flatten subdivisions for select options
  const getFlatSubdivisions = (subdivisions, result = []) => {
    subdivisions?.forEach((sub) => {
      result.push(sub);
      if (sub.subdivisions?.length) {
        getFlatSubdivisions(sub.subdivisions, result);
      }
    });
    return result;
  };

  // Effect to set parent subdivision when editing
  useEffect(() => {
    if (editMode && selectedSubdivision) {
      const allSubdivisions = getFlatSubdivisions(company.subdivisions);
      const parent = allSubdivisions.find(
        (sub) => sub._id === selectedSubdivision.parent,
      );
      setParentSubdivision(parent || undefined);
    }
  }, [editMode, selectedSubdivision, company.subdivisions]);

  const wouldCreateCircularReference = (
    subdivisionId,
    targetParentId,
    allSubdivisions,
  ) => {
    if (!targetParentId || !subdivisionId) return false;

    const checkParents = (currentId) => {
      const current = allSubdivisions.find((s) => s._id === currentId);
      if (!current) return false;
      if (current._id === subdivisionId) return true;
      if (current.parent) {
        return checkParents(current.parent);
      }
      return false;
    };

    return checkParents(targetParentId);
  };

  // Add this helper function to get all descendants
  const getDescendantIds = (subdivisionId, allSubdivisions) => {
    const descendants = new Set();

    const addDescendants = (id) => {
      const subdivision = allSubdivisions.find((s) => s._id === id);
      if (!subdivision) return;

      subdivision.subdivisions?.forEach((childId) => {
        descendants.add(childId.toString());
        addDescendants(childId);
      });
    };

    addDescendants(subdivisionId);
    return Array.from(descendants);
  };

  const getAvailableParentOptions = () => {
    const allSubdivisions = getFlatSubdivisions(company.subdivisions) || [];

    if (!selectedSubdivision) {
      return allSubdivisions;
    }

    // Get all descendant IDs of the current subdivision
    const descendantIds = getDescendantIds(
      selectedSubdivision._id,
      allSubdivisions,
    );

    // Filter out the subdivision itself and all its descendants
    return allSubdivisions.filter(
      (sub) =>
        sub._id !== selectedSubdivision._id && !descendantIds.includes(sub._id),
    );
  };

  // Update parent change handler
  const handleParentChange = (newParent) => {
    const allSubdivisions = getFlatSubdivisions(company.subdivisions) || [];

    if (newParent && selectedSubdivision) {
      if (
        wouldCreateCircularReference(
          selectedSubdivision._id,
          newParent._id,
          allSubdivisions,
        )
      ) {
        setError(
          "Невозможно создать циклическую зависимость в структуре подразделений",
        );
        return;
      }
    }

    setParentSubdivision(newParent || undefined);
  };

  const [showUsersModal, setShowUsersModal] = useState(false);
  const [selectedSubdivisionForUsers, setSelectedSubdivisionForUsers] =
    useState(null);

  // Add this handler
  const handleManageUsers = (subdivision) => {
    setSelectedSubdivisionForUsers(subdivision);
    setShowUsersModal(true);
  };

  const handleSaveUsers = (data) => {
    fetcher.submit(
      {
        intent: "updateSubdivisionUsers",
        ...data,
      },
      {
        method: "PATCH",
        action: `/companies/${company._id}`,
      },
    );
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      // If submission was successful (no errors)
      handleClose();
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <>
      <div className="d-flex justify-content-between align-items-center gap-2 mb-3">
        <div className="cap-card-title">
          <RiNodeTree />
          <span>Структура компании</span>
        </div>
        {permissions.canManageCompanies && (
          <Button size="sm" onClick={handleShow}>
            <RiAddLine /> Добавить
          </Button>
        )}
      </div>

      {company.subdivisions.length > 0 && (
        <div className="border rounded p-3">
          {company.subdivisions?.map((subdivision) => (
            <TreeNode
              key={subdivision._id}
              node={subdivision}
              onEdit={(sub) => {
                setSelectedSubdivision(sub);
                setEditMode(true);
                setShowModal(true);
              }}
              onDelete={handleDeleteClick} // Changed from handleDelete
              onManageUsers={handleManageUsers}
              canManage={permissions.canManageCompanies}
            />
          ))}
        </div>
      )}
      {company.subdivisions.length === 0 && (
        <Alert variant="light">Нет подразделений</Alert>
      )}

      <SubdivisionUsersModal
        show={showUsersModal}
        onHide={() => {
          setShowUsersModal(false);
          setSelectedSubdivisionForUsers(null);
        }}
        subdivision={selectedSubdivisionForUsers}
        companyUsers={company.employees}
        company={company}
        onSave={handleSaveUsers}
        fetcher={fetcher}
      />

      <Modal show={showModal} onHide={handleClose} centered>
        <Form onSubmit={handleSubmit}>
          <Modal.Header closeButton>
            <Modal.Title>
              {editMode ? "Изменить подразделение" : "Новое подразделение"}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {(fetcher.data?.error || error) && (
              <Alert
                variant="danger"
                onClose={() => setError(null)}
                dismissible
              >
                {fetcher.data?.error || error}
              </Alert>
            )}
            <Form.Group className="mb-3">
              <Form.Label>Название</Form.Label>
              <Form.Control
                name="name"
                required
                defaultValue={selectedSubdivision?.name || ""}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control
                type="email"
                name="email"
                defaultValue={selectedSubdivision?.email || ""}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Телефон</Form.Label>
              <Form.Control
                name="phone"
                defaultValue={selectedSubdivision?.phone || ""}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Адрес</Form.Label>
              <Form.Control
                name="address"
                defaultValue={selectedSubdivision?.address || ""}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Ссылка на карту</Form.Label>
              <Form.Control
                name="linkToMap"
                defaultValue={selectedSubdivision?.linkToMap || ""}
              />
            </Form.Group>
            <Form.Group>
              <Form.Label>Родительское подразделение</Form.Label>
              <Select
                isClearable
                placeholder="Выберите родительское подразделение"
                options={getAvailableParentOptions()}
                value={parentSubdivision}
                onChange={handleParentChange}
                getOptionLabel={(option) => option.name}
                getOptionValue={(option) => option._id}
                isDisabled={!company.subdivisions?.length}
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleClose}>
              Закрыть
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={fetcher.state !== "idle"}
            >
              Сохранить
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Подтверждение удаления</Modal.Title>
        </Modal.Header>
        <Modal.Body>Удалить подразделение?</Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>
            Отмена
          </Button>
          <Button variant="danger" onClick={handleDeleteConfirm}>
            Удалить
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default SubdivisionsSection;
