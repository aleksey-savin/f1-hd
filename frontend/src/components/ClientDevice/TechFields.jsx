import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

/**
 * Поля блока «Техническая информация». Управляемый компонент: используется в
 * шаге мастера и в отдельном редакторе с карточки устройства.
 *
 * mikrotikMode — для устройств вендора с управлением Mikrotik: спрашиваем только
 * имя устройства, остальное (серийник, ОС, IP) подтянется с самого устройства
 * при подключении к мониторингу. Скрытые поля не размонтируют значения — они
 * живут в form-состоянии мастера и по-прежнему отправляются.
 */
const TechFields = ({ values, onChange, mikrotikMode = false }) => {
  if (mikrotikMode) {
    return (
      <Row>
        <Col md={6}>
          <Form.Group className="mb-0">
            <Form.Label htmlFor="hostname">
              Имя устройства (hostname)
            </Form.Label>
            <Form.Control
              id="hostname"
              name="hostname"
              type="text"
              placeholder="GW-OFFICE"
              value={values.hostname}
              onChange={(e) => onChange("hostname", e.target.value)}
            />
            <Form.Text muted>
              Остальные данные (серийный номер, ОС, IP-адреса) подтянутся с
              устройства при подключении к мониторингу Mikrotik.
            </Form.Text>
          </Form.Group>
        </Col>
      </Row>
    );
  }

  return (
    <>
      <Row>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="hostname">
              Имя устройства (hostname)
            </Form.Label>
            <Form.Control
              id="hostname"
              name="hostname"
              type="text"
              placeholder="AG-WS001"
              value={values.hostname}
              onChange={(e) => onChange("hostname", e.target.value)}
            />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="operatingSystem">
              Операционная система
            </Form.Label>
            <Form.Control
              id="operatingSystem"
              name="operatingSystem"
              type="text"
              placeholder="Windows 11, Ubuntu 22.04, RouterOS"
              value={values.operatingSystem}
              onChange={(e) => onChange("operatingSystem", e.target.value)}
            />
          </Form.Group>
        </Col>
      </Row>

      <Row>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="ipAddress">IP-адрес</Form.Label>
            <Form.Control
              id="ipAddress"
              name="ipAddress"
              type="text"
              placeholder="192.168.1.100"
              value={values.ipAddress}
              onChange={(e) => onChange("ipAddress", e.target.value)}
            />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="macAddress">MAC-адрес</Form.Label>
            <Form.Control
              id="macAddress"
              name="macAddress"
              type="text"
              placeholder="AA:BB:CC:DD:EE:FF"
              value={values.macAddress}
              onChange={(e) => onChange("macAddress", e.target.value)}
            />
          </Form.Group>
        </Col>
      </Row>

      <Row>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="lastMaintenanceDate">
              Дата последнего обслуживания
            </Form.Label>
            <Form.Control
              id="lastMaintenanceDate"
              name="lastMaintenanceDate"
              type="date"
              value={values.lastMaintenanceDate}
              onChange={(e) => onChange("lastMaintenanceDate", e.target.value)}
            />
          </Form.Group>
        </Col>
      </Row>

      <Form.Group className="mb-0">
        <Form.Label htmlFor="notes">Заметки</Form.Label>
        <Form.Control
          id="notes"
          name="notes"
          as="textarea"
          rows={4}
          placeholder="Дополнительные заметки об устройстве..."
          value={values.notes}
          onChange={(e) => onChange("notes", e.target.value)}
        />
      </Form.Group>
    </>
  );
};

export default TechFields;
