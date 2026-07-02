import Card from "react-bootstrap/Card";
import Badge from "react-bootstrap/Badge";

import { STATUS_LABELS } from "./constants";

const refId = (value) => value?._id || value || "";
const nameById = (list, id) => {
  const found = list.find((x) => x._id === refId(id));
  return found?.name || found?.alias || found?.fullTitle;
};

// Строка сводки: подпись слева, значение справа. Пустое — приглушённый «—».
const Line = ({ label, value, placeholder = "—" }) => (
  <div className="d-flex justify-content-between gap-3 py-1">
    <span className="text-muted small">{label}</span>
    <span
      className={`small text-end ${value ? "fw-medium" : "text-secondary fst-italic"}`}
    >
      {value || placeholder}
    </span>
  </div>
);

// Сводка выбранного по шагам мастера — показывается справа от формы, чтобы было
// видно, что выбрано на предыдущих шагах. Обновляется по мере заполнения.
const DeviceSummary = ({
  form,
  deviceKind,
  components = [],
  companies = [],
  locations = [],
  deviceTypes = [],
  vendors = [],
  deviceModels = [],
  suppliers = [],
  configurations = [],
  users = [],
}) => {
  const companyName = nameById(companies, form.companyId);
  const locationName = nameById(locations, form.locationId);
  const typeName = nameById(deviceTypes, form.deviceTypeId);
  const vendorName = nameById(vendors, form.vendorId);
  const modelName = nameById(deviceModels, form.deviceModelId);
  const supplierName = nameById(suppliers, form.supplierId);

  // Конфигурация: имя или собранная из значений строка; пользователь — ФИО/email.
  const config = configurations.find(
    (c) => c._id === refId(form.configurationId),
  );
  const configName = config
    ? config.name ||
      (config.values || [])
        .map(
          (v) =>
            `${v.attributeId?.name || v.attributeId?.code || "—"}: ${v.value}`,
        )
        .join(", ")
    : "";
  const user = users.find((u) => u._id === refId(form.userId));
  const userName = user
    ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email
    : "";

  const filledComponents = components.filter(
    (c) => c._attached || c.deviceTypeId || c.deviceModelId,
  ).length;

  const hasPurchase =
    form.purchasedAt ||
    form.price !== "" ||
    form.warrantyExpirationDate ||
    supplierName;
  const hasTech =
    form.hostname ||
    form.ipAddress ||
    form.macAddress ||
    form.operatingSystem ||
    form.notes;

  return (
    <Card className="position-sticky" style={{ top: "1rem" }}>
      <Card.Header className="py-2">
        <h6 className="mb-0">Сводка</h6>
      </Card.Header>
      <Card.Body className="py-2">
        <Line label="Компания" value={companyName} placeholder="не выбрана" />
        <Line label="Расположение" value={locationName} />

        <div className="py-2">
          <Badge bg={deviceKind === "custom" ? "secondary" : "primary"}>
            {deviceKind === "custom" ? "Кастомная сборка" : "Заводская сборка"}
          </Badge>
        </div>

        <Line label="Тип" value={typeName} placeholder="не выбран" />
        {deviceKind === "branded" && (
          <>
            <Line label="Вендор" value={vendorName} />
            <Line label="Модель" value={modelName} />
            {form.deviceModelId && (
              <Line label="Конфигурация" value={configName} />
            )}
          </>
        )}
        <Line
          label="Инв. номер"
          value={form.inventoryNumber}
          placeholder="сгенерируется"
        />
        <Line label="Серийный номер" value={form.serialNumber} />
        <Line label="Статус" value={STATUS_LABELS[form.status]} />
        {form.status === "deployed" && (
          <Line label="Пользователь" value={userName} />
        )}

        <Line
          label="Комплектующие"
          value={filledComponents ? `${filledComponents} шт.` : ""}
          placeholder="нет"
        />

        {hasPurchase && (
          <>
            <div className="text-muted text-uppercase small fw-semibold pt-3 pb-1">
              Покупка
            </div>
            {form.purchasedAt && <Line label="Дата" value={form.purchasedAt} />}
            {form.price !== "" && <Line label="Стоимость" value={form.price} />}
            {supplierName && <Line label="Поставщик" value={supplierName} />}
            {form.warrantyExpirationDate && (
              <Line label="Гарантия до" value={form.warrantyExpirationDate} />
            )}
          </>
        )}

        {hasTech && (
          <>
            <div className="text-muted text-uppercase small fw-semibold pt-3 pb-1">
              Тех. инфо
            </div>
            {form.hostname && <Line label="Имя ПК" value={form.hostname} />}
            {form.ipAddress && <Line label="IP" value={form.ipAddress} />}
            {form.macAddress && <Line label="MAC" value={form.macAddress} />}
            {form.operatingSystem && (
              <Line label="ОС" value={form.operatingSystem} />
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default DeviceSummary;
