import { useState } from "react";

import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";

import { RiAlarmWarningFill, RiArrowUpCircleFill } from "react-icons/ri";

import CveModal from "./CveModal";

// Индикатор справа от версии прошивки (таблица, мобильная карточка, панель).
// Красная кнопка — опасная CVE, исправляемая обновлением (клик открывает детали);
// зелёная стрелка — просто доступно обновление ветки. Красное вытесняет зелёное.
// status = firmwareStatus строки; null → данных нет, ничего не рендерим.
const FirmwareIndicator = ({ status, displayName }) => {
  const [showCves, setShowCves] = useState(false);

  if (!status) return null;

  if (status.vulnerable) {
    return (
      <>
        <OverlayTrigger
          placement="top"
          overlay={
            <Tooltip>
              Уязвимая прошивка (CVE: {status.cves.length}) — обновите до{" "}
              {status.latestVersion}
            </Tooltip>
          }
        >
          <button
            type="button"
            className="btn btn-link p-0 ms-1 align-baseline text-danger"
            aria-label={`Уязвимая прошивка: ${displayName} — подробности`}
            onClick={(event) => {
              // Строка таблицы сама кликабельна (открывает панель) — не даём
              // клику по индикатору всплыть до неё.
              event.stopPropagation();
              setShowCves(true);
            }}
          >
            <RiAlarmWarningFill aria-hidden />
          </button>
        </OverlayTrigger>
        <CveModal
          show={showCves}
          onClose={() => setShowCves(false)}
          status={status}
          displayName={displayName}
        />
      </>
    );
  }

  if (status.updateAvailable) {
    return (
      <OverlayTrigger
        placement="top"
        overlay={
          <Tooltip>Доступно обновление до {status.latestVersion}</Tooltip>
        }
      >
        <span
          className="ms-1 text-success"
          role="img"
          aria-label={`Доступно обновление до ${status.latestVersion}`}
        >
          <RiArrowUpCircleFill aria-hidden />
        </span>
      </OverlayTrigger>
    );
  }

  return null;
};

export default FirmwareIndicator;
