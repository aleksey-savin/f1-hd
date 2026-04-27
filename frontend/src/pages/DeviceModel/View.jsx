import { useContext } from "react";
import { useLoaderData, useNavigate, Link } from "react-router";
import Container from "react-bootstrap/Container";
import Card from "react-bootstrap/Card";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";
import Table from "react-bootstrap/Table";
import Badge from "react-bootstrap/Badge";
import { AuthedUserContext } from "../../store/authed-user-context";
import Forbidden from "../../components/Error/403";
import { getLocalStorageData } from "../../util/auth";
import Transitions from "../../animations/Transition";
import { RiEditLine, RiDeleteBinLine, RiAddLine } from "react-icons/ri";

const ViewDeviceModelPage = () => {
  const { permissions } = useContext(AuthedUserContext);
  const { canUseInventoryModule, canManageClientDevices } = permissions;
  const { deviceModel, configurations } = useLoaderData();
  const navigate = useNavigate();

  const handleDeleteConfiguration = async (configId) => {
    if (!window.confirm("Вы уверены, что хотите удалить эту конфигурацию?")) {
      return;
    }

    const { token } = getLocalStorageData();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-configurations/delete/${configId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
        },
      );

      if (response.ok) {
        // Reload the page to refresh data
        navigate(0);
      } else {
        alert("Ошибка при удалении конфигурации");
      }
    } catch (error) {
      console.error("Error deleting configuration:", error);
      alert("Ошибка при удалении конфигурации");
    }
  };

  if (!canUseInventoryModule || !canManageClientDevices) {
    return <Forbidden />;
  }

  return (
    <Container>
      <Transitions>
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h1>Модель устройства</h1>
          <div>
            <Button
              as={Link}
              to={`/inventory/device-models/update/${deviceModel._id}`}
              variant="primary"
              className="me-2"
            >
              <RiEditLine /> Редактировать
            </Button>
            <Button as={Link} to="/inventory/device-models" variant="secondary">
              Назад к списку
            </Button>
          </div>
        </div>

        <Card className="mb-4">
          <Card.Header>
            <h5>Основная информация</h5>
          </Card.Header>
          <Card.Body>
            <Row>
              <Col md={6}>
                <p>
                  <strong>Название:</strong>{" "}
                  {deviceModel.name || <em>Не указано</em>}
                </p>
                <p>
                  <strong>Тип устройства:</strong>{" "}
                  {deviceModel.deviceTypeId?.name || "—"}
                </p>
                <p>
                  <strong>Производитель:</strong>{" "}
                  {deviceModel.vendorId?.name || "—"}
                </p>
              </Col>
              <Col md={6}>
                <p>
                  <strong>Создано:</strong>{" "}
                  {new Date(deviceModel.createdAt).toLocaleString("ru-RU")}
                  {deviceModel.createdBy && (
                    <>
                      {" "}
                      ({deviceModel.createdBy.firstName}{" "}
                      {deviceModel.createdBy.lastName})
                    </>
                  )}
                </p>
                <p>
                  <strong>Обновлено:</strong>{" "}
                  {new Date(deviceModel.updatedAt).toLocaleString("ru-RU")}
                  {deviceModel.updatedBy && (
                    <>
                      {" "}
                      ({deviceModel.updatedBy.firstName}{" "}
                      {deviceModel.updatedBy.lastName})
                    </>
                  )}
                </p>
              </Col>
            </Row>
            {deviceModel.notes && (
              <Row>
                <Col>
                  <p>
                    <strong>Примечания:</strong>
                  </p>
                  <p className="text-muted">{deviceModel.notes}</p>
                </Col>
              </Row>
            )}
          </Card.Body>
        </Card>

        {deviceModel.compatibleWithModelIds &&
          deviceModel.compatibleWithModelIds.length > 0 && (
            <Card className="mb-4">
              <Card.Header>
                <h5>Совместимые модели</h5>
              </Card.Header>
              <Card.Body>
                <div className="d-flex flex-wrap gap-2">
                  {deviceModel.compatibleWithModelIds.map((model) => (
                    <Badge key={model._id} bg="info">
                      {model.name || "Без названия"}
                    </Badge>
                  ))}
                </div>
              </Card.Body>
            </Card>
          )}

        <Card>
          <Card.Header className="d-flex justify-content-between align-items-center">
            <h5>Конфигурации</h5>
            <Button
              as={Link}
              to={`/inventory/device-configurations/${deviceModel._id}/add`}
              variant="success"
              size="sm"
            >
              <RiAddLine /> Добавить конфигурацию
            </Button>
          </Card.Header>
          <Card.Body>
            {configurations && configurations.length > 0 ? (
              <Table responsive hover>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Атрибуты</th>
                    <th>Создана</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {configurations.map((config, index) => (
                    <tr key={config._id}>
                      <td>{index + 1}</td>
                      <td>
                        {config.values && config.values.length > 0 ? (
                          <div className="d-flex flex-wrap gap-2">
                            {config.values.map((val, idx) => (
                              <Badge key={idx} bg="secondary">
                                {val.attributeId?.name || "—"}:{" "}
                                {val.value || "—"}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <em className="text-muted">Нет атрибутов</em>
                        )}
                      </td>
                      <td>
                        {new Date(config.createdAt).toLocaleDateString("ru-RU")}
                      </td>
                      <td>
                        <Button
                          as={Link}
                          to={`/inventory/device-configurations/${config._id}/update`}
                          variant="outline-primary"
                          size="sm"
                          className="me-2"
                        >
                          <RiEditLine />
                        </Button>
                        <Button
                          variant="outline-danger"
                          size="sm"
                          onClick={() => handleDeleteConfiguration(config._id)}
                        >
                          <RiDeleteBinLine />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-muted">
                Конфигурации не добавлены. Нажмите "Добавить конфигурацию" для
                создания.
              </p>
            )}
          </Card.Body>
        </Card>
      </Transitions>
    </Container>
  );
};

export default ViewDeviceModelPage;

export async function loader({ params }) {
  document.title = "Просмотр модели устройства";

  const { token } = getLocalStorageData();

  // Fetch device model
  const deviceModelResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!deviceModelResponse.ok) {
    throw deviceModelResponse;
  }

  const deviceModel = await deviceModelResponse.json();

  // Fetch configurations for this model
  const configurationsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-configurations/model/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  const configurations = configurationsResponse.ok
    ? await configurationsResponse.json()
    : [];

  return {
    deviceModel,
    configurations,
  };
}
