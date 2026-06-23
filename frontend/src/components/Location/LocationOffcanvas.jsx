import { useState } from "react";
import { Link, Form as RouterForm } from "react-router";
import Offcanvas from "react-bootstrap/Offcanvas";
import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Badge from "react-bootstrap/Badge";

import {
  RiBuilding2Line,
  RiStackLine,
  RiDoorLine,
  RiComputerLine,
  RiArchiveLine,
  RiBuildingLine,
  RiGroupLine,
  RiUser3Line,
  RiMapPin2Line,
  RiGlobalLine,
  RiFileTextLine,
  RiNodeTree,
  RiAddLine,
  RiEdit2Line,
  RiDeleteBin6Line,
} from "react-icons/ri";

const TYPE_LABEL = {
  building: "Здание",
  floor: "Этаж",
  room: "Помещение",
  workplace: "Рабочее место",
  storage: "Склад",
};

const TYPE_ICON = {
  building: RiBuilding2Line,
  floor: RiStackLine,
  room: RiDoorLine,
  workplace: RiComputerLine,
  storage: RiArchiveLine,
};

const CHILD_CAPABLE = ["building", "floor", "room"];

// Плашка-иконка + подпись/значение — тот же приём, что .contact-row на страницах
// компании/пользователя.
const InfoRow = ({ icon, label, children }) => (
  <div className="contact-row">
    <span className="contact-row__icon">{icon}</span>
    <div style={{ minWidth: 0 }}>
      <div className="contact-row__label">{label}</div>
      <div className="contact-row__value">{children}</div>
    </div>
  </div>
);

const emptyValue = <span className="text-body-secondary">—</span>;

// Детальная панель расположения (правый Offcanvas): полная информация, включая
// описание (его иначе видно только в форме), и действия — добавить дочернее,
// изменить, удалить.
const LocationOffcanvas = ({
  show,
  node,
  ancestors = [],
  childNodes = [],
  canManage,
  onHide,
  onNavigate,
  offcanvasSetShow,
}) => {
  const [showDelete, setShowDelete] = useState(false);

  const TypeIcon = node ? TYPE_ICON[node.type] || RiDoorLine : RiDoorLine;
  const companyId = node?.company?._id || node?.company;
  const canHaveChildren = CHILD_CAPABLE.includes(node?.type);
  const assignee = node?.assignedUser;

  // Изменить/добавить открывают форму в нижнем Offcanvas — правую панель при этом
  // закрываем, чтобы не накладывались.
  const openFormAndClose = () => {
    offcanvasSetShow();
    onHide();
  };

  return (
    <Offcanvas
      show={show}
      onHide={onHide}
      placement="end"
      keyboard
      className="org-structure"
    >
      <Offcanvas.Header closeButton>
        <div className="w-100" style={{ minWidth: 0 }}>
          {ancestors.length > 0 && (
            <div className="org-tree__breadcrumb">
              {ancestors.map((crumb) => (
                <span key={crumb._id} className="org-tree__crumb-wrap">
                  <button
                    type="button"
                    className="org-tree__crumb"
                    onClick={() => onNavigate(crumb)}
                  >
                    {crumb.name?.trim() || "Без названия"}
                  </button>
                  <span className="org-tree__crumb-sep" aria-hidden>
                    ›
                  </span>
                </span>
              ))}
            </div>
          )}
          <Offcanvas.Title className="d-flex align-items-center gap-2">
            <TypeIcon className="text-primary flex-shrink-0" />
            <span className="text-truncate">{node?.name || "Без названия"}</span>
          </Offcanvas.Title>
        </div>
      </Offcanvas.Header>

      <Offcanvas.Body className="d-flex flex-column">
        {node && (
          <>
            <InfoRow icon={<TypeIcon />} label="Тип">
              {TYPE_LABEL[node.type] || node.type}
            </InfoRow>
            <InfoRow icon={<RiBuildingLine />} label="Компания">
              {node.company?.alias || node.company?.fullTitle || emptyValue}
            </InfoRow>
            {node.subdivision?.name && (
              <InfoRow icon={<RiGroupLine />} label="Подразделение">
                {node.subdivision.name}
              </InfoRow>
            )}
            {assignee && (
              <InfoRow icon={<RiUser3Line />} label="Назначенный пользователь">
                {assignee.firstName} {assignee.lastName}
              </InfoRow>
            )}
            <InfoRow icon={<RiMapPin2Line />} label="Адрес">
              {node.address || emptyValue}
            </InfoRow>
            <InfoRow icon={<RiGlobalLine />} label="Доступность">
              {node.isPublic ? (
                <Badge bg="success">Общедоступное</Badge>
              ) : (
                <span className="text-body-secondary">
                  Только своя компания
                </span>
              )}
            </InfoRow>
            <InfoRow icon={<RiFileTextLine />} label="Описание">
              {node.description ? (
                <span style={{ whiteSpace: "pre-wrap" }}>
                  {node.description}
                </span>
              ) : (
                emptyValue
              )}
            </InfoRow>

            <div className="cap-card-title mt-4 mb-2">
              <RiNodeTree />
              <span>Вложенные расположения ({childNodes.length})</span>
            </div>
            {childNodes.length > 0 ? (
              <div className="d-flex flex-wrap gap-2">
                {childNodes.map((child) => {
                  const ChildIcon = TYPE_ICON[child.type] || RiDoorLine;
                  return (
                    <button
                      key={child._id}
                      type="button"
                      className="org-tree__chip"
                      onClick={() => onNavigate(child)}
                    >
                      <ChildIcon />
                      <span className="text-truncate">
                        {child.name?.trim() || "Без названия"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-body-secondary small">
                Нет вложенных расположений
              </div>
            )}

            {canManage && (
              <div className="mt-auto pt-3 border-top d-grid gap-2">
                <div className="d-flex gap-2">
                  {canHaveChildren && (
                    <Button
                      as={Link}
                      to={`add?company=${companyId}&parent=${node._id}`}
                      onClick={openFormAndClose}
                      variant="outline-secondary"
                      className="flex-fill"
                    >
                      <RiAddLine /> Вложенное
                    </Button>
                  )}
                  <Button
                    as={Link}
                    to={`update/${node._id}`}
                    onClick={openFormAndClose}
                    variant="primary"
                    className="flex-fill"
                  >
                    <RiEdit2Line /> Изменить
                  </Button>
                </div>
                <Button
                  variant="outline-danger"
                  onClick={() => setShowDelete(true)}
                >
                  <RiDeleteBin6Line /> Удалить расположение
                </Button>
              </div>
            )}
          </>
        )}
      </Offcanvas.Body>

      <Modal show={showDelete} onHide={() => setShowDelete(false)} centered>
        <RouterForm
          method="post"
          onSubmit={() => {
            setShowDelete(false);
            onHide();
          }}
        >
          <Modal.Header closeButton>
            <Modal.Title>Удаление расположения</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            Удалить расположение «{node?.name}»? Это действие нельзя отменить.
            Сначала убедитесь, что внутри нет вложенных расположений и техники.
            <input type="hidden" name="id" value={node?._id || ""} readOnly />
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowDelete(false)}>
              Отмена
            </Button>
            <Button variant="danger" type="submit" name="intent" value="delete">
              <RiDeleteBin6Line /> Удалить
            </Button>
          </Modal.Footer>
        </RouterForm>
      </Modal>
    </Offcanvas>
  );
};

export default LocationOffcanvas;
