import { forwardRef, useContext, useEffect } from "react";
import {
  Link,
  Outlet,
  useActionData,
  useNavigate,
  useRevalidator,
} from "react-router";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Dropdown from "react-bootstrap/Dropdown";
import Offcanvas from "react-bootstrap/Offcanvas";

import {
  RiComputerLine,
  RiCpuLine,
  RiPriceTag3Line,
  RiInformationLine,
  RiCalendarLine,
  RiImage2Line,
  RiStackLine,
  RiLinksLine,
  RiAddLine,
  RiEditLine,
  RiEdit2Line,
  RiArrowGoBackFill,
  RiMore2Fill,
} from "react-icons/ri";

import Transitions from "../../animations/Transition";
import AlertMessage from "../../UI/AlertMessage";
import DevicePhotos, { PhotoThumb } from "../Devices/Photos";
import DeleteItem from "../DeleteItem";
import { formatShortDate } from "../../util/format-date";
import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import { AuthedUserContext } from "../../store/authed-user-context";

const dash = <span className="text-body-secondary">—</span>;
// createdAt/updatedAt — инстанты: единый формат в бизнес-таймзоне.
const formatDate = (d) => (d ? formatShortDate(d) : null);
const userName = (u) =>
  u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null;

// Карточка-секция (паттерн страниц компании/пользователя, см. ClientDevice/View).
const SectionCard = ({ icon, title, children }) => (
  <Card className="border-0 shadow-sm h-100">
    <Card.Body>
      <div className="cap-card-title mb-3">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </Card.Body>
  </Card>
);

// Строка «иконка + подпись + значение».
const Line = ({ icon, label, children }) => (
  <div className="contact-row">
    <span className="contact-row__icon">{icon}</span>
    <div style={{ minWidth: 0 }}>
      <div className="contact-row__label">{label}</div>
      <div className="contact-row__value text-break">{children || dash}</div>
    </div>
  </div>
);

// Триггер «три точки» без стандартной каретки dropdown.
const KebabToggle = forwardRef(({ onClick }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label="Действия с конфигурацией"
    className="btn btn-link text-body-secondary p-1 border-0 shadow-none"
    onClick={(e) => {
      e.preventDefault();
      onClick(e);
    }}
  >
    <RiMore2Fill />
  </button>
));
KebabToggle.displayName = "KebabToggle";

// Человекочитаемое значение атрибута по его типу.
const formatAttrValue = (meta, value) => {
  if (value === undefined || value === null || value === "") return null;
  if (!meta) return String(value);
  switch (meta.valueType) {
    case "boolean":
      return value === true || value === "true" ? "Да" : "Нет";
    case "select":
      return (
        meta.options?.find((o) => o.value === value)?.label || String(value)
      );
    default:
      return String(value);
  }
};

const ViewDeviceModel = ({
  deviceModel = {},
  configurations = [],
  attributes = [],
}) => {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const offcanvas = useOffcanvasStore();
  const { showToast } = useToastStore();
  const actionData = useActionData();
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageClientDevices;

  const photos = deviceModel.photos || [];

  // Тост после удаления конфигурации (action страницы вернул { deleted: true }).
  useEffect(() => {
    if (actionData?.deleted) {
      showToast("success", "Конфигурация удалена");
    }
  }, [actionData, showToast]);

  const vendorName = deviceModel.vendorId?.name;
  const typeName = deviceModel.deviceTypeId?.name;
  const title =
    [vendorName, deviceModel.name].filter(Boolean).join(" ") ||
    "(Без названия)";
  const compatible = deviceModel.compatibleWithModelIds || [];

  // Атрибуты типа в заданном порядке — канонический каркас «спецификации».
  const orderedAttributes = [...attributes].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );

  // Строки одной конфигурации: значения по порядку атрибутов типа + legacy-хвост.
  const buildRows = (config) => {
    const byAttr = new Map(
      (config.values || []).map((v) => [
        typeof v.attributeId === "object" ? v.attributeId._id : v.attributeId,
        v,
      ]),
    );
    const rows = [];
    const seen = new Set();

    orderedAttributes.forEach((a) => {
      const meta = typeof a.attributeId === "object" ? a.attributeId : null;
      const attrId = meta?._id || a.attributeId;
      const entry = byAttr.get(attrId);
      if (!entry) return;
      const text = formatAttrValue(meta, entry.value);
      if (text === null) return;
      seen.add(attrId);
      rows.push({
        id: attrId,
        name: meta?.name || "Атрибут",
        unit: meta?.unit,
        value: text,
      });
    });

    (config.values || []).forEach((v) => {
      const meta = typeof v.attributeId === "object" ? v.attributeId : null;
      const attrId = meta?._id || v.attributeId;
      if (seen.has(attrId)) return;
      const text = formatAttrValue(meta, v.value);
      if (text === null) return;
      rows.push({ id: attrId, name: meta?.name || "Атрибут", value: text });
    });

    return rows;
  };

  const summaryOf = (rows) =>
    rows
      .slice(0, 3)
      .map((r) => (r.unit ? `${r.value} ${r.unit}` : r.value))
      .join(" / ");

  const noTypeAttributes = orderedAttributes.length === 0;

  return (
    <Transitions>
      {/* ── Шапка ── */}
      <div className="account-hero mb-4">
        <PhotoThumb photos={photos} icon={<RiComputerLine />} />

        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <h2 className="mb-1 text-break">{title}</h2>
          <div className="d-flex flex-wrap align-items-center gap-2">
            {typeName && (
              <Badge bg="secondary" className="fw-normal">
                {typeName}
              </Badge>
            )}
            {compatible.length > 0 && (
              <Badge bg="light" text="dark" className="fw-normal">
                <RiLinksLine /> Совместимо с {compatible.length}
              </Badge>
            )}
          </div>
        </div>

        {canManage && (
          <div className="ms-sm-auto d-flex align-items-start gap-2">
            <Button
              as={Link}
              to={`/inventory/device-models/update/${deviceModel._id}`}
              onClick={offcanvas.setShow}
            >
              <RiEdit2Line /> Изменить
            </Button>
          </div>
        )}
      </div>

      {/* ── Секции ── */}
      <Row className="g-3">
        <Col xs={12} lg={6}>
          <SectionCard icon={<RiInformationLine />} title="Основное">
            <Line icon={<RiPriceTag3Line />} label="Тип устройства">
              {typeName}
            </Line>
            <Line icon={<RiPriceTag3Line />} label="Производитель">
              {vendorName}
            </Line>
            <Line icon={<RiInformationLine />} label="Примечания">
              {deviceModel.notes}
            </Line>
          </SectionCard>
        </Col>

        <Col xs={12} lg={6}>
          <SectionCard icon={<RiCalendarLine />} title="Служебное">
            <Line icon={<RiCalendarLine />} label="Создано">
              {formatDate(deviceModel.createdAt)}
              {userName(deviceModel.createdBy) &&
                ` · ${userName(deviceModel.createdBy)}`}
            </Line>
            <Line icon={<RiCalendarLine />} label="Обновлено">
              {formatDate(deviceModel.updatedAt)}
              {userName(deviceModel.updatedBy) &&
                ` · ${userName(deviceModel.updatedBy)}`}
            </Line>
          </SectionCard>
        </Col>

        {(canManage || photos.length > 0) && (
          <Col xs={12}>
            <SectionCard
              icon={<RiImage2Line />}
              title={
                photos.length ? `Фотографии · ${photos.length}` : "Фотографии"
              }
            >
              {canManage && (
                <p className="text-body-secondary small mb-3">
                  Каталожные снимки модели. Их показывают все устройства этой
                  модели, у которых нет собственных фотографий.
                </p>
              )}
              <DevicePhotos
                key={deviceModel._id}
                endpoint={`${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models/${deviceModel._id}/photos`}
                photos={photos}
                canManage={canManage}
                onChange={() => revalidator.revalidate()}
              />
            </SectionCard>
          </Col>
        )}
      </Row>

      {/* ── Конфигурации ── */}
      <div className="d-flex justify-content-between align-items-center mt-4 mb-3">
        <div className="cap-card-title mb-0">
          <RiStackLine />
          <span>
            Конфигурации
            {configurations.length > 0 && ` · ${configurations.length}`}
          </span>
        </div>
        {canManage && !noTypeAttributes && (
          <Button
            as={Link}
            to="add"
            onClick={offcanvas.setShow}
            variant="primary"
            size="sm"
          >
            <RiAddLine /> Добавить конфигурацию
          </Button>
        )}
      </div>

      {noTypeAttributes && configurations.length === 0 ? (
        <AlertMessage
          variant="light"
          message="У типа устройства нет характеристик. Сначала добавьте атрибуты к типу устройства, затем создавайте конфигурации."
        />
      ) : configurations.length === 0 ? (
        <AlertMessage
          variant="light"
          message="Конфигураций пока нет. Добавьте первую — например «16 ГБ / 512 ГБ»."
        />
      ) : (
        <Row className="g-3">
          {configurations.map((config, index) => {
            const rows = buildRows(config);
            const label = summaryOf(rows) || `Конфигурация ${index + 1}`;
            return (
              <Col xs={12} md={6} xl={4} key={config._id}>
                <Card className="border-0 shadow-sm h-100">
                  <Card.Body>
                    <div className="d-flex justify-content-between align-items-start mb-3">
                      <div className="cap-card-title mb-0">
                        <RiCpuLine />
                        <span className="text-break text-body">{label}</span>
                      </div>
                      {canManage && (
                        <Dropdown align="end">
                          <Dropdown.Toggle as={KebabToggle} />
                          <Dropdown.Menu>
                            <Dropdown.Item
                              as={Link}
                              to={`update/${config._id}`}
                              onClick={offcanvas.setShow}
                            >
                              <RiEditLine /> Изменить
                            </Dropdown.Item>
                            <DeleteItem
                              item={{ _id: config._id, title: label }}
                            />
                          </Dropdown.Menu>
                        </Dropdown>
                      )}
                    </div>
                    {rows.length === 0 ? (
                      <span className="text-body-secondary small">
                        Без характеристик
                      </span>
                    ) : (
                      rows.map((r) => (
                        <div
                          key={r.id}
                          className="d-flex justify-content-between gap-3 py-1 border-bottom small"
                        >
                          <span className="text-body-secondary">
                            {r.name}
                            {r.unit ? `, ${r.unit}` : ""}
                          </span>
                          <span className="font-monospace text-body text-end">
                            {r.value}
                          </span>
                        </div>
                      ))
                    )}
                  </Card.Body>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* ── Действия ── */}
      <Row className="py-3 mt-2 border-top justify-content-end">
        <Col sm="auto">
          <Button
            variant="secondary"
            className="w-100"
            onClick={() => navigate("/inventory/device-models")}
          >
            <RiArrowGoBackFill /> К списку
          </Button>
        </Col>
      </Row>

      {/* Форма конфигурации (add / update) открывается в нижнем Offcanvas. */}
      <Offcanvas
        show={offcanvas.isActive}
        onHide={() => {
          navigate(-1);
          offcanvas.setClose();
        }}
        keyboard
        placement="bottom"
        className="h-100"
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title></Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <Outlet />
        </Offcanvas.Body>
      </Offcanvas>
    </Transitions>
  );
};

export default ViewDeviceModel;
