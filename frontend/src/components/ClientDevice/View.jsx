import { useContext } from "react";
import { Link, useNavigate, Outlet } from "react-router";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Table from "react-bootstrap/Table";
import Offcanvas from "react-bootstrap/Offcanvas";

import {
  RiComputerLine,
  RiCpuLine,
  RiBuilding2Line,
  RiMapPin2Line,
  RiUser3Line,
  RiBarcodeLine,
  RiPriceTag3Line,
  RiShoppingCart2Line,
  RiShieldCheckLine,
  RiShieldLine,
  RiCalendarLine,
  RiInformationLine,
  RiToolsLine,
  RiGlobalLine,
  RiHardDrive2Line,
  RiStackLine,
  RiFileList2Line,
  RiArrowGoBackFill,
  RiEdit2Line,
} from "react-icons/ri";

import Transitions from "../../animations/Transition";
import useOffcanvasStore from "../../store/offcanvas";
import { AuthedUserContext } from "../../store/authed-user-context";
import DeleteItem from "../DeleteItem";
import DeviceQr from "./DeviceQr";
import { STATUS_LABELS, STATUS_VARIANTS } from "./constants";

const refName = (ref) => ref?.name || ref?.alias || ref?.fullTitle || "";
const dash = <span className="text-body-secondary">—</span>;
const formatDate = (d) => (d ? new Date(d).toLocaleDateString("ru-RU") : null);
const formatMoney = (n) =>
  n || n === 0 ? `${Number(n).toLocaleString("ru-RU")} ₽` : null;

// Состояние гарантии для индикатора: истекла / скоро истекает / действует.
const warrantyState = (dateStr) => {
  if (!dateStr) return null;
  const days = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  const date = formatDate(dateStr);
  if (days < 0) return { variant: "danger", text: `истекла ${date}` };
  if (days <= 30)
    return { variant: "warning", text: `${date} · ${days} дн.` };
  return { variant: "success", text: `до ${date}` };
};

// Карточка-секция (паттерн страниц компании/пользователя).
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
const Line = ({ icon, label, mono, children }) => (
  <div className="contact-row">
    <span className="contact-row__icon">{icon}</span>
    <div style={{ minWidth: 0 }}>
      <div className="contact-row__label">{label}</div>
      <div
        className={`contact-row__value text-break ${mono ? "font-monospace" : ""}`}
      >
        {children || dash}
      </div>
    </div>
  </div>
);

const ViewClientDevice = ({ device = {} }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageClientDevices;

  const model = device.deviceModelId;
  const typeName = model?.deviceTypeId?.name || device.deviceTypeId?.name;
  const vendorName = model?.vendorId?.name;
  const isCustom = !model;

  const title =
    [typeName, vendorName, model?.name].filter(Boolean).join(" ") ||
    [typeName, device.inventoryNumber].filter(Boolean).join(" ") ||
    "Устройство";

  const assignee = device.userId
    ? `${device.userId.firstName} ${device.userId.lastName}`
    : null;

  const components = device.components || [];
  const warranty = warrantyState(device.warrantyExpirationDate);

  // Человекочитаемое название для модалки удаления.
  const deleteItem = { _id: device._id, title };

  return (
    <Transitions>
      {/* ── Шапка ── */}
      <div className="account-hero mb-4">
        <div
          className="d-flex align-items-center justify-content-center rounded-3 border flex-shrink-0 text-body-secondary"
          style={{ width: 72, height: 72, fontSize: "2rem" }}
        >
          {isCustom ? <RiCpuLine /> : <RiComputerLine />}
        </div>

        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <h2 className="mb-1 text-break">{title}</h2>
          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            <Badge
              bg={isCustom ? "secondary" : "primary"}
              className="fw-normal"
            >
              {isCustom ? "Собственная сборка" : "Брендовое устройство"}
            </Badge>
            {typeName && (
              <span className="text-body-secondary small">{typeName}</span>
            )}
          </div>
          <div className="d-flex flex-wrap align-items-center gap-2">
            <span
              className="font-monospace fw-semibold px-2 py-1 rounded border"
              style={{ borderStyle: "dashed", letterSpacing: "0.04em" }}
              title="Инвентарный номер"
            >
              {device.inventoryNumber || "без инв. №"}
            </span>
            {device.serialNumber && (
              <span className="text-body-secondary small font-monospace">
                SN {device.serialNumber}
              </span>
            )}
          </div>
        </div>

        <div className="ms-sm-auto d-flex align-items-start gap-3">
          <div className="d-flex flex-column align-items-end gap-2">
            <Badge
              bg={STATUS_VARIANTS[device.status] || "secondary"}
              className="fs-6 fw-normal"
            >
              {STATUS_LABELS[device.status] || device.status || "—"}
            </Badge>
            {warranty && (
              <Badge
                bg={warranty.variant}
                className="fw-normal d-inline-flex align-items-center gap-1"
              >
                {warranty.variant === "danger" ? (
                  <RiShieldLine />
                ) : (
                  <RiShieldCheckLine />
                )}
                Гарантия {warranty.text}
              </Badge>
            )}
          </div>
          <DeviceQr id={device._id} size={128} />
        </div>
      </div>

      {/* ── Секции ── */}
      <Row className="g-3">
        <Col xs={12} lg={6}>
          <SectionCard icon={<RiBuilding2Line />} title="Назначение">
            <Line icon={<RiBuilding2Line />} label="Компания">
              {refName(device.companyId)}
            </Line>
            <Line icon={<RiMapPin2Line />} label="Расположение">
              {refName(device.locationId)}
            </Line>
            <Line icon={<RiUser3Line />} label="Пользователь">
              {assignee}
            </Line>
          </SectionCard>
        </Col>

        <Col xs={12} lg={6}>
          <SectionCard icon={<RiInformationLine />} title="Идентификация">
            <Line icon={<RiPriceTag3Line />} label="Тип">
              {typeName}
            </Line>
            {!isCustom && (
              <Line icon={<RiPriceTag3Line />} label="Вендор / модель">
                {[vendorName, model?.name].filter(Boolean).join(" ")}
              </Line>
            )}
            <Line icon={<RiBarcodeLine />} label="Инвентарный номер" mono>
              {device.inventoryNumber}
            </Line>
            <Line icon={<RiBarcodeLine />} label="Серийный номер" mono>
              {device.serialNumber}
            </Line>
          </SectionCard>
        </Col>

        <Col xs={12} lg={6}>
          <SectionCard icon={<RiShoppingCart2Line />} title="Закупка">
            <Line icon={<RiCalendarLine />} label="Дата приобретения">
              {formatDate(device.purchasedAt)}
            </Line>
            <Line icon={<RiPriceTag3Line />} label="Стоимость">
              {formatMoney(device.price)}
            </Line>
            <Line icon={<RiFileList2Line />} label="Документ">
              {device.purchaseDocument}
            </Line>
            <Line icon={<RiBuilding2Line />} label="Поставщик">
              {refName(device.supplierId)}
            </Line>
            <Line icon={<RiShieldCheckLine />} label="Гарантия до">
              {formatDate(device.warrantyExpirationDate)}
            </Line>
          </SectionCard>
        </Col>

        <Col xs={12} lg={6}>
          <SectionCard icon={<RiToolsLine />} title="Техническая информация">
            <Line icon={<RiGlobalLine />} label="IP-адрес" mono>
              {device.ipAddress}
            </Line>
            <Line icon={<RiGlobalLine />} label="MAC-адрес" mono>
              {device.macAddress}
            </Line>
            <Line icon={<RiHardDrive2Line />} label="ОС">
              {device.operatingSystem}
            </Line>
            <Line icon={<RiCalendarLine />} label="Последнее обслуживание">
              {formatDate(device.lastMaintenanceDate)}
            </Line>
            {device.notes && (
              <Line icon={<RiInformationLine />} label="Заметки">
                {device.notes}
              </Line>
            )}
          </SectionCard>
        </Col>

        {components.length > 0 && (
          <Col xs={12}>
            <SectionCard
              icon={<RiStackLine />}
              title={`Состав сборки · ${components.length}`}
            >
              <Table responsive hover size="sm" className="mb-0 align-middle">
                <thead>
                  <tr className="text-body-secondary">
                    <th>Тип</th>
                    <th>Производитель / модель</th>
                    <th>Серийный номер</th>
                    <th className="text-center">Кол-во</th>
                    <th>Гарантия</th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((c) => {
                    const cType =
                      c.deviceModelId?.deviceTypeId?.name ||
                      c.deviceTypeId?.name;
                    const cName = [
                      c.deviceModelId?.vendorId?.name,
                      c.deviceModelId?.name,
                    ]
                      .filter(Boolean)
                      .join(" ");
                    const cWar = warrantyState(c.warrantyExpirationDate);
                    return (
                      <tr key={c._id}>
                        <td>{cType || dash}</td>
                        <td>{cName || dash}</td>
                        <td className="font-monospace">
                          {c.serialNumber || dash}
                        </td>
                        <td className="text-center">{c.quantity ?? 1}</td>
                        <td>
                          {cWar ? (
                            <Badge bg={cWar.variant} className="fw-normal">
                              {cWar.text}
                            </Badge>
                          ) : (
                            dash
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </SectionCard>
          </Col>
        )}
      </Row>

      {/* ── Действия ── */}
      <Row className="py-3 mt-2 border-top justify-content-end gap-2">
        <Col sm="auto">
          <Button
            variant="secondary"
            className="w-100"
            onClick={() => navigate("/inventory/client-devices")}
          >
            <RiArrowGoBackFill /> К списку
          </Button>
        </Col>
        {canManage && (
          <>
            <Col sm="auto">
              <Button
                as={Link}
                to="update"
                className="w-100"
                onClick={offcanvas.setShow}
              >
                <RiEdit2Line /> Изменить
              </Button>
            </Col>
            <Col sm="auto">
              <DeleteItem isButton item={deleteItem} />
            </Col>
          </>
        )}
      </Row>

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

export default ViewClientDevice;
