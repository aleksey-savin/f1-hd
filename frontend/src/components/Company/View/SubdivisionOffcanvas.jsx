import { useState } from "react";
import { useFetcher } from "react-router";
import Offcanvas from "react-bootstrap/Offcanvas";
import Button from "react-bootstrap/Button";
import Spinner from "react-bootstrap/Spinner";

import {
  RiNodeTree,
  RiUserStarLine,
  RiUser3Line,
  RiGroupLine,
  RiAtLine,
  RiPhoneLine,
  RiMapPin2Line,
  RiEdit2Line,
  RiDeleteBin6Line,
  RiAddLine,
} from "react-icons/ri";

import ViewUser from "../../User/View";

// Single «icon plaque + label/value» row — same idiom as ContactRow on the
// company/user pages (see .contact-row in index.css).
const InfoRow = ({ icon, label, children }) => (
  <div className="contact-row">
    <span className="contact-row__icon">{icon}</span>
    <div style={{ minWidth: 0 }}>
      <div className="contact-row__label">{label}</div>
      <div className="contact-row__value">{children}</div>
    </div>
  </div>
);

// Name rendered as a link that opens the user profile — same treatment as the
// names in the Employees tab table (UsersSection).
const UserLink = ({ userId, onOpen, children }) => (
  <Button
    variant="link"
    className="p-0 text-start text-decoration-none fw-medium align-baseline"
    onClick={() => onOpen(userId)}
  >
    {children}
  </Button>
);

const emptyValue = <span className="text-body-secondary">—</span>;

const SubdivisionOffcanvas = ({
  node,
  ancestors = [],
  show,
  onHide,
  canManage,
  onNavigate,
  onManageUsers,
  onAddChild,
  onEdit,
  onDelete,
}) => {
  const hasName = Boolean(node?.name && node.name.trim());
  const employees = [...(node?.users || [])].sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(
      `${b.lastName} ${b.firstName}`,
      "ru",
    ),
  );
  const children = [...(node?.subdivisions || [])].sort((a, b) =>
    (a.name || "")
      .toLowerCase()
      .localeCompare((b.name || "").toLowerCase(), "ru"),
  );

  // User profile shown full-screen over this panel — renders the same page as
  // /users/:id, exactly like the Employees tab. Layered above this offcanvas
  // via an elevated z-index.
  const profileFetcher = useFetcher();
  const [profileUserId, setProfileUserId] = useState(null);

  const openProfile = (userId) => {
    setProfileUserId(userId);
    profileFetcher.load(`/users/${userId}`);
  };
  const closeProfile = () => setProfileUserId(null);

  const profileData = profileFetcher.data;
  const isProfileReady = profileData?.user?._id === profileUserId;

  return (
    <>
      <Offcanvas
        show={show}
        onHide={onHide}
        placement="end"
        keyboard
        className="org-subdivision-offcanvas"
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
              <RiNodeTree className="text-primary flex-shrink-0" />
              <span className={hasName ? "" : "fst-italic text-body-secondary"}>
                {hasName ? node.name : "Без названия"}
              </span>
            </Offcanvas.Title>
          </div>
        </Offcanvas.Header>

        <Offcanvas.Body className="d-flex flex-column">
          {node && (
            <>
              {/* Руководитель */}
              <InfoRow icon={<RiUserStarLine />} label="Руководитель">
                {node.manager ? (
                  <>
                    <UserLink userId={node.manager._id} onOpen={openProfile}>
                      {node.manager.firstName} {node.manager.lastName}
                    </UserLink>
                    {node.manager.position && (
                      <span className="text-body-secondary">
                        {" "}
                        · {node.manager.position}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-body-secondary">Не назначен</span>
                )}
              </InfoRow>

              {/* Контакты */}
              <InfoRow icon={<RiAtLine />} label="Email">
                {node.email ? (
                  <a href={`mailto:${node.email}`}>{node.email}</a>
                ) : (
                  emptyValue
                )}
              </InfoRow>
              <InfoRow icon={<RiPhoneLine />} label="Телефон">
                {node.phone ? (
                  <a href={`tel:${node.phone}`}>{node.phone}</a>
                ) : (
                  emptyValue
                )}
              </InfoRow>
              <InfoRow icon={<RiMapPin2Line />} label="Адрес">
                {node.address ? (
                  node.linkToMap ? (
                    <a href={node.linkToMap} target="_blank" rel="noreferrer">
                      {node.address}
                    </a>
                  ) : (
                    node.address
                  )
                ) : (
                  emptyValue
                )}
              </InfoRow>

              {/* Сотрудники */}
              <div className="cap-card-title mt-4 mb-2">
                <RiGroupLine />
                <span>Сотрудники ({employees.length})</span>
              </div>
              {employees.length > 0 ? (
                <div className="org-people">
                  {employees.map((user) => (
                    <div key={user._id} className="org-person">
                      <RiUser3Line className="org-person__icon" />
                      <div className="org-person__body">
                        <UserLink userId={user._id} onOpen={openProfile}>
                          {user.lastName} {user.firstName}
                        </UserLink>
                        {user.position && (
                          <div className="org-person__role">
                            {user.position}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-body-secondary small">Нет сотрудников</div>
              )}

              {/* Вложенные подразделения */}
              <div className="cap-card-title mt-4 mb-2">
                <RiNodeTree />
                <span>Вложенные подразделения ({children.length})</span>
              </div>
              {children.length > 0 ? (
                <div className="d-flex flex-wrap gap-2">
                  {children.map((child) => (
                    <button
                      key={child._id}
                      type="button"
                      className="org-tree__chip"
                      onClick={() => onNavigate(child)}
                    >
                      <RiNodeTree />
                      <span className="text-truncate">
                        {child.name?.trim() || "Без названия"}
                      </span>
                      {child.users?.length > 0 && (
                        <span className="org-tree__chip-count">
                          {child.users.length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-body-secondary small">
                  Нет вложенных подразделений
                </div>
              )}

              {/* Действия */}
              {canManage && (
                <div className="mt-auto pt-3 border-top d-grid gap-2">
                  <Button
                    variant="outline-primary"
                    onClick={() => onManageUsers(node)}
                  >
                    <RiUser3Line /> Управление пользователями
                  </Button>
                  <div className="d-flex gap-2">
                    <Button
                      variant="outline-secondary"
                      className="flex-fill"
                      onClick={() => onAddChild(node)}
                    >
                      <RiAddLine /> Вложенное
                    </Button>
                    <Button
                      variant="primary"
                      className="flex-fill"
                      onClick={() => onEdit(node)}
                    >
                      <RiEdit2Line /> Изменить
                    </Button>
                  </div>
                  <Button
                    variant="outline-danger"
                    onClick={() => onDelete(node._id)}
                  >
                    <RiDeleteBin6Line /> Удалить подразделение
                  </Button>
                </div>
              )}
            </>
          )}
        </Offcanvas.Body>
      </Offcanvas>

      {/* Профиль сотрудника во весь экран — поверх панели подразделения. */}
      <Offcanvas
        show={profileUserId !== null}
        onHide={closeProfile}
        keyboard
        placement="bottom"
        className="h-100"
        style={{ zIndex: 1070 }}
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title></Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {isProfileReady ? (
            <ViewUser
              user={profileData.user}
              tickets={profileData.tickets || []}
            />
          ) : (
            <div className="text-center py-5">
              <Spinner animation="border" />
            </div>
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
};

export default SubdivisionOffcanvas;
