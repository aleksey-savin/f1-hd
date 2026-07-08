import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

import Spinner from "react-bootstrap/Spinner";
import Alert from "react-bootstrap/Alert";
import Offcanvas from "react-bootstrap/Offcanvas";
import Badge from "react-bootstrap/Badge";

import {
  RiZoomInLine,
  RiZoomOutLine,
  RiMapPin2Line,
  RiStarFill,
  RiExternalLinkLine,
  RiFocus3Line,
} from "react-icons/ri";

import useHttp from "../../../hooks/use-http";
import useSemanticZoom from "../../../hooks/useSemanticZoom";
import { getLocalStorageData } from "../../../util/auth";

import EnvironmentLevel from "./EnvironmentLevel";
import EnvironmentDeviceCard, {
  STATUS_META,
  mikrotikBadge,
  deviceIcon,
} from "./EnvironmentDeviceCard";

import "../../../css/environment.css";

const TYPE_LABEL = {
  building: "Здание",
  floor: "Этаж",
  room: "Помещение",
  workplace: "Рабочее место",
  storage: "Склад",
};

// Направленные варианты «наезда камеры»: dir>0 — приближаем (влетаем внутрь:
// уходящий кадр растёт и гаснет, входящий приходит из меньшего), dir<0 — наоборот.
const levelVariants = {
  enter: (dir) => ({ opacity: 0, scale: dir >= 0 ? 0.86 : 1.14 }),
  center: { opacity: 1, scale: 1 },
  exit: (dir) => ({ opacity: 0, scale: dir >= 0 ? 1.14 : 0.86 }),
};
const fadeVariants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
};

const DetailRow = ({ label, value, mono }) =>
  value ? (
    <div className="env-detail__row">
      <span className="env-detail__label">{label}</span>
      <span className={`env-detail__value${mono ? " env-mono" : ""}`}>
        {value}
      </span>
    </div>
  ) : null;

// Физическое окружение заявки. Два режима:
//  - по заявителю (userId): рабочее место и цепочка вверх (здание → этаж →
//    помещение → рабочее место);
//  - по устройству (deviceId, приоритетный): расположение устройства и цепочка
//    вверх, само устройство подсвечено. Режим для авто-заявок мониторинга — их
//    автор служебный и рабочего места не имеет.
// Скролл/стрелки/линейка меняют масштаб по текущему пути; клик по любой дочерней
// локации подгружает её и ветвит путь. Клик по технике — детальная карточка.
const EnvironmentViewer = ({ userId, deviceId }) => {
  const { token } = getLocalStorageData();
  const reduceMotion = useReducedMotion();
  const { isLoading, error, sendRequest } = useHttp();
  const { isLoading: isDiving, sendRequest: fetchNode } = useHttp();

  const deviceMode = !!deviceId;

  const [env, setEnv] = useState(null);
  // Текущий путь (загруженные узлы root→focus) и индекс активного уровня.
  const [path, setPath] = useState([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const stageRef = useRef(null);
  const dirRef = useRef(0); // направление последнего перехода для анимации

  useEffect(() => {
    if (!deviceMode && !userId) return;
    const base = import.meta.env.VITE_API_ADDRESS;
    const url = deviceMode
      ? `${base}/api/inventory/locations/device/${deviceId}/environment`
      : `${base}/api/inventory/locations/user/${userId}/environment`;
    sendRequest(
      {
        url,
        headers: { Authorization: "Bearer " + token },
      },
      (data) => {
        setEnv(data);
        if (data?.chain?.length) {
          setPath(data.chain);
          // Дефолт — самый «приближённый» уровень (рабочее место / расположение
          // устройства).
          setFocusIndex(data.chain.length - 1);
        }
      },
    );
  }, [userId, deviceId, deviceMode, token, sendRequest]);

  // Id узлов цепочки заявителя — по ним подсвечиваем «ветку заявителя» (здесь),
  // оставляя кликабельными ВСЕ дочерние узлы.
  const chainIds = useMemo(
    () => new Set((env?.chain || []).map((n) => String(n._id))),
    [env],
  );

  const hasChain = path.length > 0;
  const maxIndex = Math.max(path.length - 1, 0);
  const safeIndex = Math.min(focusIndex, maxIndex);
  const current = hasChain ? path[safeIndex] : null;

  const navigate = useCallback(
    (next) => {
      setFocusIndex((prev) => {
        const clamped = Math.min(maxIndex, Math.max(0, next));
        if (clamped !== prev) dirRef.current = clamped > prev ? 1 : -1;
        return clamped;
      });
    },
    [maxIndex],
  );

  // Нырнуть в дочернюю локацию. Если она уже следующая в пути — просто приближаем;
  // иначе подгружаем её узел и ветвим путь от текущего уровня.
  const diveInto = useCallback(
    (child) => {
      if (isDiving) return;
      const idx = Math.min(focusIndex, Math.max(path.length - 1, 0));
      const next = path[idx + 1];
      if (next && String(next._id) === String(child._id)) {
        dirRef.current = 1;
        setFocusIndex(idx + 1);
        return;
      }
      fetchNode(
        {
          // userId нужен только для слоя isPersonal — в режиме устройства его нет.
          url: `${import.meta.env.VITE_API_ADDRESS}/api/inventory/locations/${child._id}/node${userId ? `?userId=${userId}` : ""}`,
          headers: { Authorization: "Bearer " + token },
        },
        (node) => {
          dirRef.current = 1;
          setPath((prev) => [...prev.slice(0, idx + 1), node]);
          setFocusIndex(idx + 1);
        },
      );
    },
    [isDiving, focusIndex, path, fetchNode, token, userId],
  );

  useSemanticZoom({
    stageRef,
    levelIndex: safeIndex,
    maxIndex,
    navigate,
    enabled: hasChain,
  });

  const onStageKeyDown = (event) => {
    if (event.key === "ArrowUp" || event.key === "+") {
      event.preventDefault();
      navigate(safeIndex + 1);
    } else if (event.key === "ArrowDown" || event.key === "-") {
      event.preventDefault();
      navigate(safeIndex - 1);
    }
  };

  if (!deviceMode && !userId) {
    return (
      <Alert variant="light" className="mb-0">
        У заявки не указан инициатор — окружение недоступно.
      </Alert>
    );
  }
  if (isLoading) {
    return (
      <div className="env-loading">
        <Spinner animation="border" />
      </div>
    );
  }
  if (error || !env) {
    return (
      <Alert variant="light" className="mb-0">
        {deviceMode
          ? "Не удалось загрузить окружение устройства."
          : "Не удалось загрузить окружение заявителя."}
      </Alert>
    );
  }

  const personal = env.personalDevices || [];
  const canZoomOut = safeIndex > 0;
  const canZoomIn = safeIndex < maxIndex;
  const detailStatus = selectedDevice
    ? STATUS_META[selectedDevice.status]
    : null;
  const DetailIcon = selectedDevice
    ? deviceIcon(selectedDevice.typeName)
    : null;
  const detailMikro = selectedDevice ? mikrotikBadge(selectedDevice) : null;

  return (
    <div className="env-viewer">
      {deviceMode && env.device?.deleted && (
        <Alert variant="light" className="mb-3">
          Устройство удалено из учёта — показано его последнее расположение.
        </Alert>
      )}
      {hasChain ? (
        <>
          <div className="env-stage-grid">
            <div className="env-ruler" aria-hidden="true">
              {path.map((node, i) => (
                <button
                  key={node._id}
                  type="button"
                  className={`env-ruler__tick${i === safeIndex ? " is-active" : ""}`}
                  onClick={() => navigate(i)}
                  title={node.name}
                  tabIndex={-1}
                >
                  <span className="env-ruler__dot" />
                  <span className="env-ruler__label">{node.name}</span>
                </button>
              ))}
            </div>

            <div
              className="env-stage"
              ref={stageRef}
              tabIndex={0}
              role="group"
              aria-busy={isDiving}
              aria-label="Окружение заявителя. Колесо мыши или стрелки вверх/вниз меняют масштаб."
              onKeyDown={onStageKeyDown}
            >
              <AnimatePresence mode="wait" custom={dirRef.current} initial={false}>
                <motion.div
                  key={current._id}
                  custom={dirRef.current}
                  variants={reduceMotion ? fadeVariants : levelVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    duration: reduceMotion ? 0 : 0.32,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <EnvironmentLevel
                    node={current}
                    chainIds={chainIds}
                    highlightId={deviceMode ? deviceId : null}
                    onSelectChild={diveInto}
                    onSelectDevice={setSelectedDevice}
                  />
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="env-controls">
              <button
                type="button"
                className="env-btn"
                disabled={!canZoomOut}
                onClick={() => navigate(safeIndex - 1)}
              >
                <RiZoomOutLine /> Отдалить
              </button>
              <span className="env-controls__hint">
                {TYPE_LABEL[current.type] || current.type}
              </span>
              <button
                type="button"
                className="env-btn"
                disabled={!canZoomIn}
                onClick={() => navigate(safeIndex + 1)}
              >
                Приблизить <RiZoomInLine />
              </button>
            </div>
            <div className="env-hint">
              Колесо мыши или стрелки ↑ / ↓ — масштаб · клик по локации — перейти
            </div>
          </div>
        </>
      ) : deviceMode ? (
        <>
          <Alert variant="light" className="env-noworkplace mb-0">
            <RiMapPin2Line className="me-2 flex-shrink-0" />
            <span>
              Устройство не привязано к расположению в учёте техники. Ниже —
              его карточка.
            </span>
          </Alert>
          {env.device && (
            <div className="env-devices">
              <EnvironmentDeviceCard
                device={env.device}
                showLocation
                highlightId={deviceId}
                onSelect={setSelectedDevice}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <Alert variant="light" className="env-noworkplace mb-0">
            <RiMapPin2Line className="me-2 flex-shrink-0" />
            <span>
              Рабочее место заявителя не сопоставлено в учёте техники. Ниже —
              техника, закреплённая лично за ним.
            </span>
          </Alert>
          {personal.length > 0 && (
            <div className="env-devices">
              {personal.map((device) => (
                <EnvironmentDeviceCard
                  key={device._id}
                  device={device}
                  showLocation
                  onSelect={setSelectedDevice}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Offcanvas
        show={!!selectedDevice}
        onHide={() => setSelectedDevice(null)}
        placement="end"
        className="env-detail-canvas"
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title className="d-flex align-items-center gap-2">
            {DetailIcon && (
              <span className="env-detail__icon">
                <DetailIcon />
              </span>
            )}
            <span className="text-truncate">{selectedDevice?.name}</span>
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {selectedDevice && (
            <>
              {deviceMode &&
                String(selectedDevice._id) === String(deviceId) && (
                  <div className="env-detail__personal">
                    <RiFocus3Line /> Устройство, о котором создана заявка
                  </div>
                )}
              {selectedDevice.isPersonal && (
                <div className="env-detail__personal">
                  <RiStarFill /> Закреплено лично за заявителем
                </div>
              )}
              <div className="env-detail">
                <DetailRow label="Тип" value={selectedDevice.typeName} />
                <DetailRow
                  label="Производитель"
                  value={selectedDevice.vendorName}
                />
                {detailStatus && (
                  <div className="env-detail__row">
                    <span className="env-detail__label">Статус</span>
                    <span className="env-detail__value">
                      <Badge bg={detailStatus.bg} text={detailStatus.text}>
                        {detailStatus.label}
                      </Badge>
                    </span>
                  </div>
                )}
                {detailMikro && (
                  <div className="env-detail__row">
                    <span className="env-detail__label">Mikrotik</span>
                    <span className="env-detail__value">
                      <Badge bg={detailMikro.bg}>{detailMikro.label}</Badge>
                    </span>
                  </div>
                )}
                <DetailRow
                  label="Расположение"
                  value={selectedDevice.locationName}
                />
                <DetailRow
                  label="Инвентарный №"
                  value={selectedDevice.inventoryNumber}
                  mono
                />
                <DetailRow
                  label="Серийный №"
                  value={selectedDevice.serialNumber}
                  mono
                />
                <DetailRow
                  label="IP-адрес"
                  value={selectedDevice.ipAddress}
                  mono
                />
                <DetailRow label="ОС" value={selectedDevice.operatingSystem} />
              </div>
              <Link
                to={`/inventory/client-devices/${selectedDevice._id}`}
                className="btn btn-primary w-100 mt-4 d-inline-flex align-items-center justify-content-center gap-2"
              >
                <RiExternalLinkLine /> Открыть страницу устройства
              </Link>
              {selectedDevice.mikrotikManaged && (
                <Link
                  to={`/devices/mikrotik?clientDeviceId=${selectedDevice._id}`}
                  className="btn btn-outline-primary w-100 mt-2 d-inline-flex align-items-center justify-content-center gap-2"
                >
                  <RiExternalLinkLine /> Открыть в управлении Mikrotik
                </Link>
              )}
            </>
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </div>
  );
};

export default EnvironmentViewer;
