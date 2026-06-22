import { NavLink } from "react-router";
import { AuthedUserContext } from "../../store/authed-user-context";
import useInitialPrefs from "../../store/prefs";

import Nav from "react-bootstrap/Nav";
import NavDropdown from "react-bootstrap/NavDropdown";

// Icons
import {
  RiBuilding2Line,
  RiDraftLine,
  RiArchiveLine,
  RiUserLine,
  RiDashboard2Line,
  RiDeviceLine,
  RiBookOpenLine,
} from "react-icons/ri";
import { GoProjectTemplate } from "react-icons/go";

import { TbCheckbox } from "react-icons/tb";
import { useContext } from "react";

// Dropdown Title Components
const DropdownTitles = {
  User: ({ firstName, lastName }) => (
    <span>
      <RiUserLine /> {`${firstName} ${lastName}`}
    </span>
  ),
  Reports: () => (
    <span>
      <RiDraftLine /> Отчёты
    </span>
  ),
};

const EndUserNavs = ({ setShowOffcanvas }) => {
  const { modules } = useInitialPrefs();
  const { dashboard, permissions = {} } = useContext(AuthedUserContext);

  const {
    canSeeWorksReport,
    canSeeAnalytics,
    canUseTimeTrackingModule,

    canManageMikrotikDevices,
  } = permissions;

  // Event Handlers
  const handleClose = () => setShowOffcanvas(false);

  return (
    <>
      <Nav.Link
        hidden={!dashboard?.isActive}
        as={NavLink}
        to="/dashboard"
        onClick={handleClose}
      >
        <RiDashboard2Line /> Dashboard
      </Nav.Link>
      <Nav.Link as={NavLink} to="/tickets" onClick={handleClose}>
        <TbCheckbox /> Заявки
      </Nav.Link>
      <Nav.Link as={NavLink} to="/ticket-templates" onClick={handleClose}>
        <GoProjectTemplate /> Шаблоны заявок
      </Nav.Link>
      <Nav.Link as={NavLink} to="/closed-tickets" onClick={handleClose}>
        <RiArchiveLine /> Архив заявок
      </Nav.Link>
      {modules.inventory.isActive && permissions.canUseInventoryModule && (
        <Nav.Link
          as={NavLink}
          to="/inventory/client-devices"
          onClick={handleClose}
        >
          <RiDeviceLine /> Устройства
        </Nav.Link>
      )}
      {modules.knowledgeBase.isActive && permissions.canSeeKnowledgeBase && (
        <Nav.Link as={NavLink} to="/knowledge-base" onClick={handleClose}>
          <RiBookOpenLine /> База знаний
        </Nav.Link>
      )}
      {/* Reports Dropdown */}
      {modules.timeTracking.isActive && canUseTimeTrackingModule && (
        <NavDropdown
          hidden={!canSeeWorksReport && !canSeeAnalytics}
          title={<DropdownTitles.Reports />}
        >
          {canSeeWorksReport && (
            <NavDropdown.Item
              as={NavLink}
              to="/report/work"
              onClick={handleClose}
            >
              <RiDraftLine /> Отчёт по работам
            </NavDropdown.Item>
          )}
          {canSeeAnalytics && (
            <NavDropdown.Item
              as={NavLink}
              to="/report/analytics"
              onClick={handleClose}
            >
              <RiBuilding2Line /> Аналитика
            </NavDropdown.Item>
          )}
        </NavDropdown>
      )}
    </>
  );
};

export default EndUserNavs;
