import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import InputGroup from "react-bootstrap/InputGroup";
import Select from "../../../UI/Select";
import SubdivisionUsersModal from "./SubdivisionUsersModal";
import SubdivisionTree from "./SubdivisionTree";
import SubdivisionOffcanvas from "./SubdivisionOffcanvas";

import {
  RiNodeTree,
  RiAddLine,
  RiSearchLine,
  RiExpandVerticalLine,
  RiCollapseVerticalLine,
} from "react-icons/ri";

// Locate a node in the tree by id, collecting its ancestor chain (root → parent)
// for the offcanvas breadcrumb. Returns null when the id is no longer present
// (e.g. after a delete), which lets the offcanvas close itself.
const findNodeWithPath = (nodes, id, path = []) => {
  for (const node of nodes || []) {
    if (node._id === id) return { node, ancestors: path };
    const found = findNodeWithPath(node.subdivisions, id, [...path, node]);
    if (found) return found;
  }
  return null;
};

// Ids of every node that has children — used by «Свернуть всё».
const collectParentIds = (nodes, acc = []) => {
  (nodes || []).forEach((node) => {
    if (node.subdivisions?.length) {
      acc.push(node._id);
      collectParentIds(node.subdivisions, acc);
    }
  });
  return acc;
};

// Keep branches whose name matches the query or that contain a match. A node
// that matches itself keeps its full subtree; otherwise only the path to the
// matching descendants is kept.
const filterTree = (nodes, query) => {
  const out = [];
  (nodes || []).forEach((node) => {
    const selfMatch = (node.name || "").toLowerCase().includes(query);
    const matchedKids = filterTree(node.subdivisions, query);
    if (selfMatch || matchedKids.length) {
      out.push({
        ...node,
        subdivisions: selfMatch ? node.subdivisions || [] : matchedKids,
      });
    }
  });
  return out;
};

const SubdivisionsSection = ({ company, permissions }) => {
  const fetcher = useFetcher();
  const [showModal, setShowModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedSubdivision, setSelectedSubdivision] = useState(null);
  const [parentSubdivision, setParentSubdivision] = useState(undefined);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [subdivisionToDelete, setSubdivisionToDelete] = useState(null);
  const [error, setError] = useState(null);

  // Detail/actions offcanvas (right) — driven by the selected node id, resolved
  // against the live tree so edits show immediately and deletes auto-close it.
  const [selectedSubdivisionId, setSelectedSubdivisionId] = useState(null);

  // Tree view controls: a set of *collapsed* ids (empty = everything expanded)
  // and a free-text filter.
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const handleClose = () => {
    setShowModal(false);
    setEditMode(false);
    setSelectedSubdivision(null);
    setParentSubdivision(undefined);
  };

  // Reset form when opening the root-level «add» modal.
  const handleShow = () => {
    setSelectedSubdivision(null);
    setParentSubdivision(undefined);
    setEditMode(false);
    setError(null);
    setShowModal(true);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setError(null);
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

  // All descendant ids of a subdivision. Children in the assembled tree are
  // full node objects (not raw ids), so read `child._id`.
  const getDescendantIds = (subdivisionId, allSubdivisions) => {
    const descendants = new Set();

    const addDescendants = (id) => {
      const subdivision = allSubdivisions.find((s) => s._id === id);
      if (!subdivision) return;

      subdivision.subdivisions?.forEach((child) => {
        const childId = child._id ?? child;
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

  // --- Offcanvas actions ---------------------------------------------------

  const handleEditFromPanel = (subdivision) => {
    setSelectedSubdivision(subdivision);
    setEditMode(true);
    setError(null);
    setShowModal(true);
  };

  // Add a child under the given subdivision (parent preset, add mode).
  const handleAddChild = (subdivision) => {
    setSelectedSubdivision(null);
    setEditMode(false);
    setParentSubdivision(subdivision);
    setError(null);
    setShowModal(true);
  };

  // --- Tree expand/collapse + search ---------------------------------------

  const isExpanded = (id) => !collapsedIds.has(id);

  const handleToggle = (id) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => setCollapsedIds(new Set());
  const collapseAll = () =>
    setCollapsedIds(new Set(collectParentIds(company.subdivisions)));

  const hasCollapsed = collapsedIds.size > 0;

  const query = searchQuery.trim().toLowerCase();
  const displayTree = query
    ? filterTree(company.subdivisions, query)
    : company.subdivisions;

  // Resolve the open node (and its path) from the live tree.
  const found = selectedSubdivisionId
    ? findNodeWithPath(company.subdivisions, selectedSubdivisionId)
    : null;
  const selectedNode = found?.node || null;
  const selectedAncestors = found?.ancestors || [];

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

      {company.subdivisions.length > 0 ? (
        <div className="org-structure">
          <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
            <InputGroup style={{ maxWidth: 300 }}>
              <InputGroup.Text>
                <RiSearchLine />
              </InputGroup.Text>
              <Form.Control
                type="search"
                placeholder="Поиск подразделения…"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </InputGroup>
            <Button
              variant="secondary"
              onClick={hasCollapsed ? expandAll : collapseAll}
            >
              {hasCollapsed ? (
                <>
                  <RiExpandVerticalLine /> Развернуть всё
                </>
              ) : (
                <>
                  <RiCollapseVerticalLine /> Свернуть всё
                </>
              )}
            </Button>
          </div>

          {displayTree.length > 0 ? (
            <div className="org-tree-wrap">
              <SubdivisionTree
                nodes={displayTree}
                selectedId={selectedSubdivisionId}
                onSelect={(node) => setSelectedSubdivisionId(node._id)}
                isExpanded={isExpanded}
                onToggle={handleToggle}
                forceExpand={Boolean(query)}
              />
            </div>
          ) : (
            <Alert variant="light" className="mb-0">
              Подразделения не найдены
            </Alert>
          )}
        </div>
      ) : (
        <Alert variant="light" className="mb-0">
          Нет подразделений
        </Alert>
      )}

      <SubdivisionOffcanvas
        show={Boolean(selectedNode)}
        node={selectedNode}
        ancestors={selectedAncestors}
        onHide={() => setSelectedSubdivisionId(null)}
        canManage={permissions.canManageCompanies}
        onNavigate={(node) => setSelectedSubdivisionId(node._id)}
        onManageUsers={handleManageUsers}
        onAddChild={handleAddChild}
        onEdit={handleEditFromPanel}
        onDelete={handleDeleteClick}
      />

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
