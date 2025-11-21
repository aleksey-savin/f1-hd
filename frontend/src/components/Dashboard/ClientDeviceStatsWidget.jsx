import { useState, useEffect } from "react";
import Card from "react-bootstrap/Card";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Badge from "react-bootstrap/Badge";
import ProgressBar from "react-bootstrap/ProgressBar";
import Button from "react-bootstrap/Button";
import Spinner from "react-bootstrap/Spinner";
import Alert from "react-bootstrap/Alert";
import ListGroup from "react-bootstrap/ListGroup";
import { useNavigate } from "react-router";

import {
  RiComputerLine,
  RiUserLine,
  RiMapPinLine,
  RiAlertLine,
  RiTimeLine,
  RiBarChartLine,
  RiArrowRightLine,
  RiBuilding2Line,
  RiHome2Line,
  RiSettings3Line,
} from "react-icons/ri";

import { getLocalStorageData } from "../../util/auth";

const ClientDeviceStatsWidget = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    setError("");
    const { token } = getLocalStorageData();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/stats`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );

      if (!response.ok) {
        throw new Error("Ошибка при загрузке статистики");
      }

      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error("Error fetching stats:", error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const getResponsibilityLabel = (type) => {
    const labels = {
      personal: "Персональная",
      department: "Отдел",
      shared: "Общая",
      maintenance: "Обслуживание",
    };
    return labels[type] || type;
  };

  const getResponsibilityIcon = (type) => {
    switch (type) {
      case "personal":
        return <RiUserLine className="me-2" />;
      case "department":
        return <RiBuilding2Line className="me-2" />;
      case "shared":
        return <RiHome2Line className="me-2" />;
      default:
        return <RiSettings3Line className="me-2" />;
    }
  };

  const getStatusVariant = (status) => {
    const variants = {
      "Готово к выдаче": "success",
      "В использовании": "primary",
      "На обслуживании": "warning",
      Списано: "secondary",
      Утеряно: "danger",
      "В ремонте": "warning",
      Резерв: "info",
    };
    return variants[status] || "secondary";
  };

  if (loading) {
    return (
      <Card className="h-100">
        <Card.Header className="d-flex align-items-center">
          <RiComputerLine className="me-2" />
          <span>Статистика устройств</span>
        </Card.Header>
        <Card.Body className="d-flex justify-content-center align-items-center">
          <div className="text-center">
            <Spinner animation="border" className="mb-2" />
            <div>Загрузка статистики...</div>
          </div>
        </Card.Body>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="h-100">
        <Card.Header className="d-flex align-items-center">
          <RiComputerLine className="me-2" />
          <span>Статистика устройств</span>
        </Card.Header>
        <Card.Body>
          <Alert variant="danger">
            <RiAlertLine className="me-2" />
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
          <RiComputerLine className="me-2" />
          <span>Статистика устройств</span>
        </Card.Header>
        <Card.Body className="d-flex justify-content-center align-items-center">
          <div className="text-center text-muted">
            <RiComputerLine size={48} className="mb-3" />
            <div>Нет данных</div>
          </div>
        </Card.Body>
      </Card>
    );
  }

  const responsibilityPercentage =
    stats.total > 0 ? Math.round((stats.assigned / stats.total) * 100) : 0;

  const warrantyAlerts = stats.warrantyExpiring + stats.warrantyExpired;

  return (
    <Card className="h-100">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <div className="d-flex align-items-center">
          <RiComputerLine className="me-2" />
          <span>Статистика устройств</span>
        </div>
        <Button
          variant="outline-primary"
          size="sm"
          onClick={() => navigate("/inventory/client-devices")}
        >
          Подробнее
          <RiArrowRightLine className="ms-1" />
        </Button>
      </Card.Header>

      <Card.Body>
        {/* Main Stats */}
        <Row className="mb-4">
          <Col xs={4} className="text-center">
            <div className="h4 text-primary mb-1">{stats.total}</div>
            <small className="text-muted">Всего устройств</small>
          </Col>
          <Col xs={4} className="text-center">
            <div className="h4 text-success mb-1">{stats.assigned}</div>
            <small className="text-muted">Назначено</small>
          </Col>
          <Col xs={4} className="text-center">
            <div className="h4 text-secondary mb-1">{stats.unassigned}</div>
            <small className="text-muted">Свободно</small>
          </Col>
        </Row>

        {/* Responsibility Progress */}
        <div className="mb-4">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <small className="text-muted">Ответственность назначена</small>
            <small className="text-muted">{responsibilityPercentage}%</small>
          </div>
          <ProgressBar
            now={responsibilityPercentage}
            variant={
              responsibilityPercentage > 80
                ? "success"
                : responsibilityPercentage > 50
                  ? "warning"
                  : "danger"
            }
          />
        </div>

        {/* Warranty Alerts */}
        {warrantyAlerts > 0 && (
          <Alert variant="warning" className="py-2 mb-3">
            <div className="d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center">
                <RiTimeLine className="me-2" />
                <span>Внимание к гарантии</span>
              </div>
              <Badge bg="warning" text="dark">
                {warrantyAlerts}
              </Badge>
            </div>
            {stats.warrantyExpired > 0 && (
              <div className="small mt-1">
                <RiAlertLine className="me-1" />
                Истекла: {stats.warrantyExpired}
              </div>
            )}
            {stats.warrantyExpiring > 0 && (
              <div className="small">
                <RiTimeLine className="me-1" />
                Истекает: {stats.warrantyExpiring}
              </div>
            )}
          </Alert>
        )}

        {/* Responsibility Breakdown */}
        <div className="mb-4">
          <h6 className="mb-3">
            <RiUserLine className="me-2" />
            По типу ответственности
          </h6>
          {Object.entries(stats.byResponsibilityType || {}).length > 0 ? (
            <ListGroup variant="flush">
              {Object.entries(stats.byResponsibilityType).map(
                ([type, count]) => (
                  <ListGroup.Item
                    key={type}
                    className="d-flex justify-content-between align-items-center px-0 py-2"
                  >
                    <div className="d-flex align-items-center">
                      {getResponsibilityIcon(type)}
                      <span>{getResponsibilityLabel(type)}</span>
                    </div>
                    <Badge bg="primary" pill>
                      {count}
                    </Badge>
                  </ListGroup.Item>
                ),
              )}
            </ListGroup>
          ) : (
            <div className="text-muted small">
              Нет данных об ответственности
            </div>
          )}
        </div>

        {/* Status Breakdown */}
        <div className="mb-4">
          <h6 className="mb-3">
            <RiBarChartLine className="me-2" />
            По статусу
          </h6>
          {Object.entries(stats.byStatus || {}).length > 0 ? (
            <ListGroup variant="flush">
              {Object.entries(stats.byStatus)
                .slice(0, 4)
                .map(([status, count]) => (
                  <ListGroup.Item
                    key={status}
                    className="d-flex justify-content-between align-items-center px-0 py-2"
                  >
                    <span>{status}</span>
                    <Badge bg={getStatusVariant(status)} pill>
                      {count}
                    </Badge>
                  </ListGroup.Item>
                ))}
              {Object.keys(stats.byStatus).length > 4 && (
                <ListGroup.Item className="px-0 py-2 text-center">
                  <small className="text-muted">
                    +{Object.keys(stats.byStatus).length - 4} статусов
                  </small>
                </ListGroup.Item>
              )}
            </ListGroup>
          ) : (
            <div className="text-muted small">Нет данных о статусах</div>
          )}
        </div>

        {/* Top Locations */}
        <div>
          <h6 className="mb-3">
            <RiMapPinLine className="me-2" />
            Топ расположений
          </h6>
          {Object.entries(stats.byLocation || {}).length > 0 ? (
            <ListGroup variant="flush">
              {Object.entries(stats.byLocation)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 3)
                .map(([location, count]) => (
                  <ListGroup.Item
                    key={location}
                    className="d-flex justify-content-between align-items-center px-0 py-2"
                  >
                    <span className="text-truncate" title={location}>
                      {location}
                    </span>
                    <Badge bg="info" pill>
                      {count}
                    </Badge>
                  </ListGroup.Item>
                ))}
              {Object.keys(stats.byLocation).length > 3 && (
                <ListGroup.Item className="px-0 py-2 text-center">
                  <small className="text-muted">
                    +{Object.keys(stats.byLocation).length - 3} расположений
                  </small>
                </ListGroup.Item>
              )}
            </ListGroup>
          ) : (
            <div className="text-muted small">Нет данных о расположениях</div>
          )}
        </div>
      </Card.Body>
    </Card>
  );
};

export default ClientDeviceStatsWidget;
