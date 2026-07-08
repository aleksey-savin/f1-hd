import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useRevalidator,
  useSearchParams,
  Outlet,
} from "react-router";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Table from "react-bootstrap/Table";
import Offcanvas from "react-bootstrap/Offcanvas";
import Tabs from "react-bootstrap/Tabs";
import Tab from "react-bootstrap/Tab";
import Alert from "react-bootstrap/Alert";

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
  RiFingerprintLine,
  RiStackLine,
  RiFileList2Line,
  RiArrowGoBackFill,
  RiEdit2Line,
  RiUserAddLine,
  RiLinksLine,
  RiLinkUnlink,
  RiRouterLine,
  RiExternalLinkLine,
  RiProfileLine,
  RiPulseLine,
} from "react-icons/ri";

import Spinner from "react-bootstrap/Spinner";

import Transitions from "../../animations/Transition";
import AlertMessage from "../../UI/AlertMessage";
import useOffcanvasStore from "../../store/offcanvas";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";
import DeleteItem from "../DeleteItem";
import DeviceQr from "./DeviceQr";
import AssignUserModal from "./AssignUserModal";
import AttachComponentModal from "./AttachComponentModal";
import MonitoringSection from "../Devices/Mikrotik/MonitoringSection";
import ArtifactsSection from "../Devices/Mikrotik/ArtifactsSection";
import ParametersModal from "../Devices/Mikrotik/ParametersModal";
import ConfirmActionModal from "../../UI/ConfirmActionModal";
import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";
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
  const revalidator = useRevalidator();
  const offcanvas = useOffcanvasStore();
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageClientDevices;
  const [showAssign, setShowAssign] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [detachingId, setDetachingId] = useState(null);
  const [detachError, setDetachError] = useState("");

  // Открепить комплектующее: разрывает связь с хостом (устройство возвращается в
  // общий список как «Готово к выдаче»). После — ревалидация загрузчика страницы.
  const detachComponent = async (componentId) => {
    setDetachingId(componentId);
    setDetachError("");
    const { token } = getLocalStorageData();
    const base = import.meta.env.VITE_API_ADDRESS;
    try {
      const response = await fetch(
        `${base}/api/inventory/client-devices/${device._id}/components/${componentId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Не удалось открепить устройство");
      }
      revalidator.revalidate();
    } catch (err) {
      setDetachError(err.message);
    } finally {
      setDetachingId(null);
    }
  };

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

  // Конфигурация (пресет характеристик модели): имя или собранная из значений строка.
  const config = device.configurationId;
  const configLabel = config
    ? config.name ||
      (config.values || [])
        .map(
          (v) =>
            `${v.attributeId?.name || v.attributeId?.code || "—"}: ${v.value}`,
        )
        .join(", ")
    : null;

  const components = device.components || [];
  const warranty = warrantyState(device.warrantyExpirationDate);

  // Человекочитаемое название для модалки удаления.
  const deleteItem = { _id: device._id, title };

  // Mikrotik-оверлей (если у устройства есть управляющая запись): статус связи +
  // переход на панель управления. В тёмной теме — без info.
  const mikro = device.mikrotik;
  const mikroBadge = !mikro
    ? null
    : !mikro.monitoringEnabled
      ? { variant: "secondary", label: "Mikrotik: мониторинг выкл" }
      : mikro.status === "online"
        ? { variant: "success", label: "Mikrotik: в сети" }
        : { variant: "danger", label: "Mikrotik: не в сети" };

  // ── Mikrotik: вкладки «Мониторинг» и «Конфигурации» ──
  const canManageMikrotik = permissions.canManageMikrotikDevices;
  const canManageMikrotikConfigs = permissions.canManageMikrotikConfigs;
  // Вкладка мониторинга видна и для ещё не подключённых устройств управляемого
  // вендора — там живёт CTA «Подключить к мониторингу».
  const vendorMikrotikEnabled =
    !!device.deviceModelId?.vendorId?.isMikrotikManagementEnabled;
  const showMonitoringTab = !!mikro || vendorMikrotikEnabled;

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(
    ["card", "monitoring", "configs"].includes(requestedTab)
      ? requestedTab
      : "card",
  );

  const [mikrotikRow, setMikrotikRow] = useState(null);
  const [mikrotikLoading, setMikrotikLoading] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const [showMikrotikDetach, setShowMikrotikDetach] = useState(false);
  const [isMikrotikDetaching, setIsMikrotikDetaching] = useState(false);
  const [mikrotikDetachError, setMikrotikDetachError] = useState(null);
  const detachMikrotik = useMikrotikDeviceFilterStore((state) => state.detach);

  // Строка управления Mikrotik (статус, адреса, расписания) для вкладок.
  const reloadMikrotik = useCallback(async () => {
    setMikrotikLoading(true);
    try {
      const { token } = getLocalStorageData();
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/mikrotik-devices/${device._id}`,
        { headers: { Authorization: "Bearer " + token } },
      );
      if (response.ok) setMikrotikRow(await response.json());
    } catch {
      // сеть — вкладка покажет пустое состояние
    } finally {
      setMikrotikLoading(false);
    }
  }, [device._id]);

  useEffect(() => {
    if (showMonitoringTab) reloadMikrotik();
  }, [showMonitoringTab, reloadMikrotik]);

  const mikrotikConfigured =
    !!mikrotikRow && mikrotikRow.status !== "notConfigured";
  const showConfigsTab = mikrotikConfigured && canManageMikrotikConfigs;

  // Deep-link из мастера создания (?mikrotikSetup=1): открыть вкладку мониторинга
  // сразу с формой подключения. Одноразово; параметр стирается из URL.
  const setupHandled = useRef(false);
  useEffect(() => {
    if (setupHandled.current) return;
    if (searchParams.get("mikrotikSetup") !== "1") return;
    setupHandled.current = true;
    if (showMonitoringTab && canManageMikrotik) {
      setActiveTab("monitoring");
      setShowParams(true);
    }
    const next = new URLSearchParams(searchParams);
    next.delete("mikrotikSetup");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, showMonitoringTab, canManageMikrotik]);

  // Активная вкладка стала недоступной (устройство отключили / нет прав) —
  // откатываемся на ближайшую доступную. Пока строка грузится, не дёргаемся.
  useEffect(() => {
    if (activeTab === "monitoring" && !showMonitoringTab) {
      setActiveTab("card");
    }
    if (
      activeTab === "configs" &&
      (!canManageMikrotikConfigs || (mikrotikRow && !mikrotikConfigured))
    ) {
      setActiveTab(showMonitoringTab ? "monitoring" : "card");
    }
  }, [
    activeTab,
    showMonitoringTab,
    canManageMikrotikConfigs,
    mikrotikRow,
    mikrotikConfigured,
  ]);

  const handleMikrotikDetach = async () => {
    setIsMikrotikDetaching(true);
    setMikrotikDetachError(null);
    try {
      const response = await detachMikrotik(device._id);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setMikrotikDetachError(data.message || "Не удалось выполнить действие");
        return;
      }
      setShowMikrotikDetach(false);
      revalidator.revalidate();
      reloadMikrotik();
    } finally {
      setIsMikrotikDetaching(false);
    }
  };

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
            {mikroBadge && (
              <Badge
                bg={mikroBadge.variant}
                className="fw-normal d-inline-flex align-items-center gap-1"
                title={
                  mikro.lastSuccessfulConnectionAt
                    ? `Последняя связь: ${new Date(
                        mikro.lastSuccessfulConnectionAt,
                      ).toLocaleString("ru-RU")}`
                    : undefined
                }
              >
                <RiRouterLine /> {mikroBadge.label}
              </Badge>
            )}
            {mikro && (
              <Link
                to={`/devices/mikrotik?clientDeviceId=${device._id}`}
                className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1"
              >
                <RiExternalLinkLine /> Управление Mikrotik
              </Link>
            )}
          </div>
          <DeviceQr id={device._id} size={128} />
        </div>
      </div>

      {/* ── Вкладки: карточка / мониторинг Mikrotik / конфигурации ── */}
      <div className="company-view-tabs">
        <Tabs
          activeKey={activeTab}
          onSelect={(key) => setActiveTab(key || "card")}
          className="mb-3 scrollable-tabs"
        >
          <Tab
            eventKey="card"
            title={
              <>
                <RiProfileLine /> Карточка
              </>
            }
          >
            <div className="pt-1">
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
            {configLabel && (
              <Line icon={<RiCpuLine />} label="Конфигурация">
                {configLabel}
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
            <Line icon={<RiComputerLine />} label="Имя устройства" mono>
              {device.hostname}
            </Line>
            {device.machineId && (
              <Line icon={<RiFingerprintLine />} label="ID машины (агент)" mono>
                {device.machineId}
              </Line>
            )}
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

        {(canManage || components.length > 0) && (
          <Col xs={12}>
            <SectionCard
              icon={<RiStackLine />}
              title={`Состав сборки · ${components.length}`}
            >
              {detachError && (
                <AlertMessage variant="danger" message={detachError} />
              )}
              {canManage && (
                <div className="d-flex justify-content-end mb-2">
                  <Button
                    variant="outline-primary"
                    size="sm"
                    onClick={() => setShowAttach(true)}
                  >
                    <RiLinksLine /> Прикрепить
                  </Button>
                </div>
              )}
              {components.length === 0 ? (
                <p className="text-body-secondary small mb-0">
                  Комплектующие не прикреплены. Нажмите «Прикрепить», чтобы
                  добавить устройство в сборку.
                </p>
              ) : (
                <Table responsive hover size="sm" className="mb-0 align-middle">
                  <thead>
                    <tr className="text-body-secondary">
                      <th>Тип</th>
                      <th>Производитель / модель</th>
                      <th>Серийный номер</th>
                      <th className="text-center">Кол-во</th>
                      <th>Гарантия</th>
                      {canManage && <th className="text-end">Действия</th>}
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
                          {canManage && (
                            <td className="text-end">
                              <Button
                                variant="outline-danger"
                                size="sm"
                                disabled={detachingId === c._id}
                                onClick={() => detachComponent(c._id)}
                                title="Открепить от сборки"
                              >
                                {detachingId === c._id ? (
                                  <Spinner animation="border" size="sm" />
                                ) : (
                                  <RiLinkUnlink />
                                )}
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </SectionCard>
          </Col>
        )}
      </Row>
            </div>
          </Tab>

          {showMonitoringTab && (
            <Tab
              eventKey="monitoring"
              title={
                <>
                  <RiPulseLine /> Мониторинг
                  {mikrotikConfigured && (
                    <span
                      className={`mikrotik-tab-dot bg-${
                        mikrotikRow.status === "online" ? "success" : "danger"
                      }`}
                    />
                  )}
                </>
              }
            >
              <div className="pt-1">
                {mikrotikLoading && !mikrotikRow ? (
                  <div className="text-center py-5">
                    <Spinner animation="border" />
                  </div>
                ) : mikrotikConfigured ? (
                  <MonitoringSection
                    device={mikrotikRow}
                    canManage={canManageMikrotik}
                    onEditParams={() => setShowParams(true)}
                    onDetach={() => {
                      setMikrotikDetachError(null);
                      setShowMikrotikDetach(true);
                    }}
                    reconciliation={mikrotikRow.reconciliation}
                    onSynced={() => {
                      revalidator.revalidate();
                      reloadMikrotik();
                    }}
                  />
                ) : (
                  <Card className="border-0 shadow-sm">
                    <Card.Body className="text-center py-5">
                      <div className="display-6 text-body-secondary mb-2">
                        <RiRouterLine />
                      </div>
                      <h5 className="mb-2">
                        Устройство ещё не подключено к мониторингу
                      </h5>
                      <p
                        className="text-body-secondary mb-4 mx-auto"
                        style={{ maxWidth: 480 }}
                      >
                        Подключение проверит доступ по API, включит фоновые
                        проверки связи каждые 5 минут и позволит хранить копии
                        конфигурации устройства.
                      </p>
                      {canManageMikrotik ? (
                        <Button
                          variant="primary"
                          onClick={() => setShowParams(true)}
                        >
                          <RiRouterLine /> Подключить к мониторингу
                        </Button>
                      ) : (
                        <div className="text-body-secondary small">
                          Недостаточно прав для подключения — обратитесь к
                          администратору.
                        </div>
                      )}
                    </Card.Body>
                  </Card>
                )}
              </div>
            </Tab>
          )}

          {showConfigsTab && (
            <Tab
              eventKey="configs"
              title={
                <>
                  <RiShieldCheckLine /> Конфигурации
                </>
              }
            >
              <div className="pt-1">
                <ArtifactsSection
                  recordId={mikrotikRow.recordId}
                  type="export"
                  initialSchedule={mikrotikRow.schedules?.export}
                  canManage={canManageMikrotikConfigs}
                />
              </div>
            </Tab>
          )}
        </Tabs>
      </div>

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
                variant="info"
                className="w-100"
                onClick={() => setShowAssign(true)}
              >
                <RiUserAddLine />{" "}
                {assignee ? "Сменить пользователя" : "Выдать пользователю"}
              </Button>
            </Col>
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

      <AssignUserModal
        show={showAssign}
        onHide={() => setShowAssign(false)}
        device={device}
        onAssigned={() => revalidator.revalidate()}
      />

      <AttachComponentModal
        show={showAttach}
        onHide={() => setShowAttach(false)}
        device={device}
        onAttached={() => revalidator.revalidate()}
      />

      {/* Подключение к мониторингу Mikrotik / правка параметров (verify-on-save). */}
      <ParametersModal
        device={{
          clientDeviceId: device._id,
          displayName: title,
          host: mikrotikRow?.host,
        }}
        show={showParams}
        onClose={() => setShowParams(false)}
        onSaved={() => {
          setShowParams(false);
          revalidator.revalidate();
          reloadMikrotik();
        }}
      />

      <ConfirmActionModal
        show={showMikrotikDetach}
        onHide={() => setShowMikrotikDetach(false)}
        onConfirm={handleMikrotikDetach}
        title="Отключить устройство"
        body={
          <>
            Устройство <strong>{title}</strong> будет отвязано от управления
            Mikrotik: сохранённые параметры (учётные данные и сертификат) будут
            удалены, а мониторинг остановлен. Само устройство останется в
            инвентаре — его можно подключить снова.
            {mikrotikDetachError && (
              <Alert variant="danger" className="mt-3 mb-0">
                {mikrotikDetachError}
              </Alert>
            )}
          </>
        }
        confirmLabel="Отключить"
        confirmVariant="danger"
        isLoading={isMikrotikDetaching}
      />

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
