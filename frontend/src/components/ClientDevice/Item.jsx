import { useState } from "react";

import Button from "react-bootstrap/Button";
import {
  RiBuilding2Line,
  RiUser3Line,
  RiMapPin2Line,
  RiQrCodeLine,
} from "react-icons/ri";

import ItemCard from "../../UI/ItemCard";
import DeviceQr from "./DeviceQr";
import { STATUS_LABELS, STATUS_VARIANTS } from "./constants";

function ClientDeviceItem({ item }) {
  // QR скрыт за кнопкой-заглушкой: в списке много карточек, иначе камера при
  // сканировании одной метки случайно ловит соседние коды.
  const [showQr, setShowQr] = useState(false);

  const model = item.deviceModelId;
  const vendorName = model?.vendorId?.name;
  // Тип — из модели (брендовое) или напрямую (самосборное устройство).
  const typeName = model?.deviceTypeId?.name || item.deviceTypeId?.name;

  const title =
    [typeName, vendorName, model?.name].filter(Boolean).join(" ") ||
    [typeName, item.inventoryNumber].filter(Boolean).join(" ") ||
    "Устройство";

  const assignee = item.userId
    ? `${item.userId.firstName} ${item.userId.lastName}`
    : item.locationId?.name;

  const badges = [
    {
      title: STATUS_LABELS[item.status] || item.status || "—",
      isActive: true,
      bg: STATUS_VARIANTS[item.status] || "secondary",
    },
  ];
  if (item.componentCount > 0) {
    badges.push({
      title: `Сборка · ${item.componentCount}`,
      isActive: true,
      bg: "secondary",
    });
  }

  return (
    <ItemCard
      item={item}
      title={title}
      badges={badges}
      itemTitle="clientDevice"
      detailsButton
    >
      {/* Media-object: QR-метка слева, сведения об устройстве справа */}
      <div className="d-flex align-items-center gap-3">
        {showQr ? (
          <button
            type="button"
            title="Скрыть QR-код"
            className="d-none d-sm-inline-flex p-0 border-0 bg-transparent flex-shrink-0"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowQr(false);
            }}
          >
            <DeviceQr id={item._id} size={76} />
          </button>
        ) : (
          <Button
            variant="outline-secondary"
            className="d-none d-sm-flex flex-column align-items-center justify-content-center flex-shrink-0 p-1 lh-sm text-center"
            style={{ width: 76, height: 76 }}
            title="Показать QR-код"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowQr(true);
            }}
          >
            <RiQrCodeLine size={22} />
            <span style={{ fontSize: "0.6rem" }} className="mt-1">
              Показать QR
            </span>
          </Button>
        )}

        <div style={{ minWidth: 0 }}>
          {/* Инвентарный номер — первичный идентификатор актива, как наклейка-тег */}
          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            <span
              className="font-monospace fw-semibold px-2 py-1 rounded border small"
              style={{ borderStyle: "dashed", letterSpacing: "0.04em" }}
              title="Инвентарный номер"
            >
              {item.inventoryNumber || "без инв. №"}
            </span>
            {item.serialNumber && (
              <span className="text-body-secondary small font-monospace">
                SN {item.serialNumber}
              </span>
            )}
          </div>

          <div className="d-flex flex-column gap-1 small">
            <span className="d-inline-flex align-items-center gap-2">
              <RiBuilding2Line className="text-body-secondary flex-shrink-0" />
              {item.companyId?.alias || (
                <span className="text-body-secondary">Компания не указана</span>
              )}
            </span>
            <span className="d-inline-flex align-items-center gap-2">
              {item.userId ? (
                <RiUser3Line className="text-body-secondary flex-shrink-0" />
              ) : (
                <RiMapPin2Line className="text-body-secondary flex-shrink-0" />
              )}
              {assignee || (
                <span className="text-body-secondary">Не назначено</span>
              )}
            </span>
          </div>
        </div>
      </div>
    </ItemCard>
  );
}

export default ClientDeviceItem;
