import { useState } from "react";
import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import ListGroup from "react-bootstrap/ListGroup";
import Badge from "react-bootstrap/Badge";
import Collapse from "react-bootstrap/Collapse";
import { useNavigate } from "react-router";

import {
  RiRocketLine,
  RiMapPinLine,
  RiUserLine,
  RiSettings3Line,
  RiCheckLine,
  RiArrowDownSLine,
  RiArrowRightLine,
  RiLightbulbLine,
  RiPlayLine,
} from "react-icons/ri";

const EnhancedDeviceSetupWidget = () => {
  const navigate = useNavigate();
  const [showSteps, setShowSteps] = useState(false);

  // Check if user has completed setup steps (this would come from API in real implementation)
  const setupStatus = {
    locationsCreated:
      localStorage.getItem("setup_locations_created") === "true",
    devicesAdded: localStorage.getItem("setup_devices_added") === "true",
    responsibilityAssigned:
      localStorage.getItem("setup_responsibility_assigned") === "true",
  };

  const completedSteps = Object.values(setupStatus).filter(Boolean).length;
  const totalSteps = Object.keys(setupStatus).length;
  const isCompleted = completedSteps === totalSteps;

  const steps = [
    {
      id: "locationsCreated",
      title: "Настройте расположения",
      description: "Создайте иерархическую структуру: здания, этажи, комнаты",
      icon: RiMapPinLine,
      action: () => navigate("/inventory/locations"),
      actionText: "Настроить расположения",
      completed: setupStatus.locationsCreated,
    },
    {
      id: "devicesAdded",
      title: "Добавьте устройства",
      description: "Используйте новый интерфейс для добавления устройств",
      icon: RiSettings3Line,
      action: () => navigate("/inventory/client-devices/enhanced/add"),
      actionText: "Добавить устройство",
      completed: setupStatus.devicesAdded,
    },
    {
      id: "responsibilityAssigned",
      title: "Назначьте ответственность",
      description: "Настройте автоматическое назначение ответственных лиц",
      icon: RiUserLine,
      action: () => navigate("/inventory/client-devices/enhanced"),
      actionText: "Управление ответственностью",
      completed: setupStatus.responsibilityAssigned,
    },
  ];

  const handleStepComplete = (stepId) => {
    localStorage.setItem(`setup_${stepId}`, "true");
    // Trigger re-render by updating state or context
    window.location.reload();
  };

  const progressPercentage = Math.round((completedSteps / totalSteps) * 100);

  if (isCompleted) {
    return (
      <Card className="border-success">
        <Card.Header className="bg-success text-white d-flex align-items-center">
          <RiCheckLine className="me-2" />
          <span>Настройка завершена!</span>
        </Card.Header>
        <Card.Body className="text-center">
          <RiRocketLine size={48} className="text-success mb-3" />
          <h6 className="text-success">Отлично!</h6>
          <p className="text-muted mb-3">
            Вы настроили все основные функции расширенного управления
            устройствами.
          </p>
          <Button
            variant="outline-success"
            size="sm"
            onClick={() => navigate("/inventory/client-devices/enhanced")}
          >
            Перейти к управлению
            <RiArrowRightLine className="ms-2" />
          </Button>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className="border-primary">
      <Card.Header className="bg-primary text-white d-flex justify-content-between align-items-center">
        <div className="d-flex align-items-center">
          <RiLightbulbLine className="me-2" />
          <span>Настройка расширенных функций</span>
        </div>
        <Badge bg="light" text="dark">
          {completedSteps}/{totalSteps}
        </Badge>
      </Card.Header>

      <Card.Body>
        <div className="mb-3">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <small className="text-muted">Прогресс настройки</small>
            <small className="text-muted">{progressPercentage}%</small>
          </div>
          <div className="progress" style={{ height: "6px" }}>
            <div
              className="progress-bar bg-primary"
              role="progressbar"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>

        <p className="text-muted mb-3">
          Настройте новые функции управления устройствами для максимальной
          эффективности:
        </p>

        <div className="d-flex justify-content-between align-items-center mb-3">
          <span className="text-muted">Шаги настройки</span>
          <Button
            variant="link"
            size="sm"
            onClick={() => setShowSteps(!showSteps)}
            className="p-0"
          >
            {showSteps ? <RiArrowDownSLine /> : <RiArrowRightLine />}
            {showSteps ? "Скрыть" : "Показать"} шаги
          </Button>
        </div>

        <Collapse in={showSteps}>
          <div>
            <ListGroup variant="flush">
              {steps.map((step, index) => {
                const IconComponent = step.icon;
                return (
                  <ListGroup.Item
                    key={step.id}
                    className="d-flex align-items-center justify-content-between px-0 py-3"
                  >
                    <div className="d-flex align-items-start flex-grow-1">
                      <div className="me-3 mt-1">
                        {step.completed ? (
                          <RiCheckLine className="text-success" size={20} />
                        ) : (
                          <IconComponent className="text-muted" size={20} />
                        )}
                      </div>
                      <div className="flex-grow-1">
                        <div className="d-flex align-items-center mb-1">
                          <strong
                            className={
                              step.completed ? "text-success" : "text-dark"
                            }
                          >
                            {index + 1}. {step.title}
                          </strong>
                          {step.completed && (
                            <Badge bg="success" className="ms-2 small">
                              Готово
                            </Badge>
                          )}
                        </div>
                        <small className="text-muted">{step.description}</small>
                      </div>
                    </div>
                    {!step.completed && (
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={step.action}
                        className="ms-3"
                      >
                        <RiPlayLine className="me-1" />
                        {step.actionText}
                      </Button>
                    )}
                  </ListGroup.Item>
                );
              })}
            </ListGroup>
          </div>
        </Collapse>

        {!showSteps && (
          <div className="text-center">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const firstIncompleteStep = steps.find(
                  (step) => !step.completed,
                );
                if (firstIncompleteStep) {
                  firstIncompleteStep.action();
                }
              }}
              disabled={isCompleted}
            >
              <RiPlayLine className="me-2" />
              Продолжить настройку
            </Button>
          </div>
        )}

        <div className="mt-3 p-3 bg-light rounded">
          <div className="d-flex align-items-center mb-2">
            <RiLightbulbLine className="text-warning me-2" />
            <strong className="small">Совет</strong>
          </div>
          <small className="text-muted">
            После настройки расположений система сможет автоматически назначать
            ответственность за устройства на основе их типа и местоположения.
          </small>
        </div>
      </Card.Body>
    </Card>
  );
};

export default EnhancedDeviceSetupWidget;
