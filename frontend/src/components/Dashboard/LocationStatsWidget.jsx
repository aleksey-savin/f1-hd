import React, { useState, useEffect } from "react";
import { Card, Row, Col, Spinner, Alert } from "react-bootstrap";
import { Link } from "react-router";
import {
  RiMapPinLine,
  RiBuilding2Line,
  RiRoadMapLine,
  RiHome2Line,
  RiUser3Line,
  RiTeamLine,
  RiAdminLine,
  RiQuestionLine,
  RiArrowRightLine,
} from "react-icons/ri";

import { getLocalStorageData } from "../../util/auth";

const LocationStatsWidget = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchLocationStats();
  }, []);

  const fetchLocationStats = async () => {
    setLoading(true);
    setError("");
    const { token } = getLocalStorageData();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/locations`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );

      if (!response.ok) {
        throw new Error("Ошибка при загрузке статистики расположений");
      }

      const locations = await response.json();
      calculateStats(locations);
    } catch (error) {
      console.error("Error fetching location stats:", error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (locations) => {
    const stats = {
      total: locations.length,
      byType: {
        building: 0,
        floor: 0,
        room: 0,
        workplace: 0,
        storage: 0,
      },
      responsibility: {
        assigned: 0, // workplace с assignedUser
        hasResponsible: 0, // с defaultResponsible
        hasManager: 0, // через subdivision manager
        unassigned: 0, // без ответственного
      },
      companies: new Set(),
      subdivisions: new Set(),
    };

    locations.forEach((location) => {
      // Статистика по типам
      if (stats.byType.hasOwnProperty(location.type)) {
        stats.byType[location.type]++;
      }

      // Статистика по ответственности
      if (location.type === "workplace" && location.assignedUser) {
        stats.responsibility.assigned++;
      } else if (location.defaultResponsible) {
        stats.responsibility.hasResponsible++;
      } else if (location.subdivision?.manager) {
        stats.responsibility.hasManager++;
      } else {
        stats.responsibility.unassigned++;
      }

      // Уникальные компании и подразделения
      if (location.company) {
        stats.companies.add(location.company._id || location.company);
      }
      if (location.subdivision) {
        stats.subdivisions.add(
          location.subdivision._id || location.subdivision,
        );
      }
    });

    stats.companies = stats.companies.size;
    stats.subdivisions = stats.subdivisions.size;

    setStats(stats);
  };

  const getTypeIcon = (type) => {
    const icons = {
      building: RiBuilding2Line,
      floor: RiRoadMapLine,
      room: RiHome2Line,
      workplace: RiUser3Line,
      storage: RiMapPinLine,
    };
    return icons[type] || RiMapPinLine;
  };

  const getTypeColor = (type) => {
    const colors = {
      building: "primary",
      floor: "info",
      room: "success",
      workplace: "warning",
      storage: "secondary",
    };
    return colors[type] || "secondary";
  };

  const getTypeLabel = (type) => {
    const labels = {
      building: "Зданий",
      floor: "Этажей",
      room: "Комнат",
      workplace: "Рабочих мест",
      storage: "Складов",
    };
    return labels[type] || type;
  };

  if (loading) {
    return (
      <Card className="h-100">
        <Card.Header className="d-flex align-items-center">
          <RiMapPinLine className="me-2" />
          <h6 className="mb-0">Статистика расположений</h6>
        </Card.Header>
        <Card.Body className="d-flex align-items-center justify-content-center">
          <Spinner animation="border" variant="primary" />
        </Card.Body>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="h-100">
        <Card.Header className="d-flex align-items-center">
          <RiMapPinLine className="me-2" />
          <h6 className="mb-0">Статистика расположений</h6>
        </Card.Header>
        <Card.Body>
          <Alert variant="danger" className="mb-0">
            {error}
          </Alert>
        </Card.Body>
      </Card>
    );
  }

  if (!stats) {
    return (
      <Card className="h-100">
        <Card.Header className="d-flex align-items-center">
          <RiMapPinLine className="me-2" />
          <h6 className="mb-0">Статистика расположений</h6>
        </Card.Header>
        <Card.Body>
          <div className="text-muted text-center">Нет данных</div>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className="h-100">
      <Card.Header className="d-flex align-items-center justify-content-between">
        <div className="d-flex align-items-center">
          <RiMapPinLine className="me-2" />
          <h6 className="mb-0">Статистика расположений</h6>
        </div>
        <Link
          to="/inventory/locations"
          className="btn btn-outline-primary btn-sm"
        >
          Все <RiArrowRightLine className="ms-1" />
        </Link>
      </Card.Header>
      <Card.Body>
        {/* Общая статистика */}
        <Row className="mb-4">
          <Col className="text-center">
            <div className="h4 mb-0 text-primary">{stats.total}</div>
            <div className="small text-muted">Всего расположений</div>
          </Col>
          <Col className="text-center">
            <div className="h4 mb-0 text-info">{stats.companies}</div>
            <div className="small text-muted">Компаний</div>
          </Col>
          <Col className="text-center">
            <div className="h4 mb-0 text-success">{stats.subdivisions}</div>
            <div className="small text-muted">Подразделений</div>
          </Col>
        </Row>

        {/* Статистика по типам */}
        <div className="mb-4">
          <h6 className="text-muted mb-3">По типам расположений</h6>
          <Row>
            {Object.entries(stats.byType).map(([type, count]) => {
              if (count === 0) return null;
              const IconComponent = getTypeIcon(type);
              return (
                <Col key={type} className="mb-2">
                  <div className="d-flex align-items-center">
                    <IconComponent
                      size={16}
                      className={`me-2 text-${getTypeColor(type)}`}
                    />
                    <div className="flex-grow-1">
                      <div className="fw-bold">{count}</div>
                      <div className="small text-muted">
                        {getTypeLabel(type)}
                      </div>
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>
        </div>

        {/* Статистика по ответственности */}
        <div>
          <h6 className="text-muted mb-3">Ответственность</h6>
          <Row className="g-2">
            {stats.responsibility.assigned > 0 && (
              <Col xs={6}>
                <div className="d-flex align-items-center">
                  <RiUser3Line size={16} className="me-2 text-success" />
                  <div>
                    <div className="fw-bold text-success">
                      {stats.responsibility.assigned}
                    </div>
                    <div className="small text-muted">Назначенные</div>
                  </div>
                </div>
              </Col>
            )}
            {stats.responsibility.hasResponsible > 0 && (
              <Col xs={6}>
                <div className="d-flex align-items-center">
                  <RiAdminLine size={16} className="me-2 text-primary" />
                  <div>
                    <div className="fw-bold text-primary">
                      {stats.responsibility.hasResponsible}
                    </div>
                    <div className="small text-muted">С ответственным</div>
                  </div>
                </div>
              </Col>
            )}
            {stats.responsibility.hasManager > 0 && (
              <Col xs={6}>
                <div className="d-flex align-items-center">
                  <RiTeamLine size={16} className="me-2 text-info" />
                  <div>
                    <div className="fw-bold text-info">
                      {stats.responsibility.hasManager}
                    </div>
                    <div className="small text-muted">Через руководителя</div>
                  </div>
                </div>
              </Col>
            )}
            {stats.responsibility.unassigned > 0 && (
              <Col xs={6}>
                <div className="d-flex align-items-center">
                  <RiQuestionLine size={16} className="me-2 text-warning" />
                  <div>
                    <div className="fw-bold text-warning">
                      {stats.responsibility.unassigned}
                    </div>
                    <div className="small text-muted">Без ответственного</div>
                  </div>
                </div>
              </Col>
            )}
          </Row>
        </div>

        {/* Предупреждение о неназначенных */}
        {stats.responsibility.unassigned > 0 && (
          <Alert variant="warning" className="mt-3 mb-0 py-2">
            <small>
              <RiQuestionLine className="me-1" />У{" "}
              {stats.responsibility.unassigned} расположений нет ответственного
            </small>
          </Alert>
        )}
      </Card.Body>
    </Card>
  );
};

export default LocationStatsWidget;
