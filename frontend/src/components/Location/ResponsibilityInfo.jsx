import React from "react";
import { Badge, OverlayTrigger, Tooltip } from "react-bootstrap";
import {
  RiUser3Line,
  RiAdminLine,
  RiTeamLine,
  RiQuestionLine,
} from "react-icons/ri";

const ResponsibilityInfo = ({ location, size = "normal", showDetails = true }) => {
  const getResponsibilityInfo = () => {
    // Priority order: assignedUser > defaultResponsible > subdivision manager > none
    if (location.type === "workplace" && location.assignedUser) {
      return {
        type: "assigned",
        user: location.assignedUser,
        label: "Назначенный пользователь",
        icon: RiUser3Line,
        variant: "success",
        description: "Рабочее место закреплено за конкретным сотрудником",
      };
    }

    if (location.defaultResponsible) {
      return {
        type: "responsible",
        user: location.defaultResponsible,
        label: "Ответственный",
        icon: RiAdminLine,
        variant: "primary",
        description: "Назначен ответственный за данное расположение",
      };
    }

    if (location.subdivision?.manager) {
      return {
        type: "manager",
        user: location.subdivision.manager,
        label: "Руководитель подразделения",
        icon: RiTeamLine,
        variant: "info",
        description: "Ответственность через руководителя подразделения",
      };
    }

    return {
      type: "none",
      user: null,
      label: "Не назначен",
      icon: RiQuestionLine,
      variant: "secondary",
      description: "Ответственный не назначен",
    };
  };

  const responsibility = getResponsibilityInfo();
  const IconComponent = responsibility.icon;

  const getUserFullName = (user) => {
    if (!user) return "";
    return `${user.firstName || ""} ${user.lastName || ""}`.trim();
  };

  const renderContent = () => {
    if (size === "compact") {
      return (
        <OverlayTrigger
          placement="top"
          overlay={
            <Tooltip>
              {responsibility.description}
              {responsibility.user && (
                <>
                  <br />
                  <strong>{getUserFullName(responsibility.user)}</strong>
                  {responsibility.user.email && (
                    <>
                      <br />
                      {responsibility.user.email}
                    </>
                  )}
                </>
              )}
            </Tooltip>
          }
        >
          <Badge bg={responsibility.variant} className="d-flex align-items-center">
            <IconComponent size={14} className="me-1" />
            {responsibility.user ? getUserFullName(responsibility.user) : responsibility.label}
          </Badge>
        </OverlayTrigger>
      );
    }

    return (
      <div className="d-flex align-items-center">
        <IconComponent
          size={size === "large" ? 20 : 16}
          className={`me-2 text-${responsibility.variant}`}
        />
        <div>
          {showDetails && (
            <div className="small text-muted">{responsibility.label}</div>
          )}
          <div className={size === "large" ? "fw-bold" : ""}>
            {responsibility.user ? (
              <>
                {getUserFullName(responsibility.user)}
                {showDetails && responsibility.user.email && (
                  <div className="small text-muted">{responsibility.user.email}</div>
                )}
              </>
            ) : (
              <span className="text-muted">{responsibility.label}</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return renderContent();
};

// Компонент для отображения цепочки ответственности
export const ResponsibilityChain = ({ location }) => {
  const getResponsibilityChain = () => {
    const chain = [];

    // Добавляем назначенного пользователя для рабочего места
    if (location.type === "workplace" && location.assignedUser) {
      chain.push({
        level: "assigned",
        user: location.assignedUser,
        label: "Назначенный пользователь",
        icon: RiUser3Line,
        variant: "success",
      });
    }

    // Добавляем ответственного по умолчанию
    if (location.defaultResponsible) {
      chain.push({
        level: "responsible",
        user: location.defaultResponsible,
        label: "Ответственный",
        icon: RiAdminLine,
        variant: "primary",
      });
    }

    // Добавляем руководителя подразделения
    if (location.subdivision?.manager) {
      chain.push({
        level: "manager",
        user: location.subdivision.manager,
        label: "Руководитель подразделения",
        icon: RiTeamLine,
        variant: "info",
      });
    }

    return chain;
  };

  const chain = getResponsibilityChain();

  if (chain.length === 0) {
    return (
      <div className="text-muted d-flex align-items-center">
        <RiQuestionLine className="me-2" />
        Ответственный не назначен
      </div>
    );
  }

  return (
    <div>
      <div className="small text-muted mb-2">Цепочка ответственности:</div>
      {chain.map((item, index) => {
        const IconComponent = item.icon;
        return (
          <div key={item.level} className="d-flex align-items-center mb-1">
            <div className="me-2" style={{ width: "20px", textAlign: "center" }}>
              {index + 1}.
            </div>
            <IconComponent size={16} className={`me-2 text-${item.variant}`} />
            <div>
              <div className="small text-muted">{item.label}</div>
              <div>
                {item.user.firstName} {item.user.lastName}
                {item.user.email && (
                  <span className="small text-muted ms-2">({item.user.email})</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Компонент для статистики ответственности
export const ResponsibilityStats = ({ locations }) => {
  const getStats = () => {
    const stats = {
      total: locations.length,
      assigned: 0,
      hasResponsible: 0,
      hasManager: 0,
      unassigned: 0,
    };

    locations.forEach((location) => {
      if (location.type === "workplace" && location.assignedUser) {
        stats.assigned++;
      } else if (location.defaultResponsible) {
        stats.hasResponsible++;
      } else if (location.subdivision?.manager) {
        stats.hasManager++;
      } else {
        stats.unassigned++;
      }
    });

    return stats;
  };

  const stats = getStats();

  return (
    <div className="row text-center">
      <div className="col">
        <div className="h5 mb-0 text-success">{stats.assigned}</div>
        <div className="small text-muted">Назначенные</div>
      </div>
      <div className="col">
        <div className="h5 mb-0 text-primary">{stats.hasResponsible}</div>
        <div className="small text-muted">С ответственным</div>
      </div>
      <div className="col">
        <div className="h5 mb-0 text-info">{stats.hasManager}</div>
        <div className="small text-muted">Через руководителя</div>
      </div>
      <div className="col">
        <div className="h5 mb-0 text-warning">{stats.unassigned}</div>
        <div className="small text-muted">Без ответственного</div>
      </div>
    </div>
  );
};

export default ResponsibilityInfo;
