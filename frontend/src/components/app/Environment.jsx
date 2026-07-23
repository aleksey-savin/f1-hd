import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  RiBuilding2Line,
  RiCommunityLine,
  RiDoorLine,
  RiExternalLinkLine,
  RiHistoryLine,
  RiMapPin2Line,
  RiZoomInLine,
  RiZoomOutLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import Spinner from "./Spinner";
import EnvironmentDeviceTile from "./EnvironmentDeviceTile";
import EnvironmentDeviceSheet from "./EnvironmentDeviceSheet";
import useHttp from "../../hooks/use-http";
import useSemanticZoom from "../../hooks/useSemanticZoom";
import { getLocalStorageData } from "../../util/auth";
import { plural } from "../../util/plural";
import { TYPE_LABEL, TYPE_ICON } from "../Location/type-meta";

// Направленные варианты «наезда камеры»: dir>0 — приближаем (уходящий кадр
// растёт и гаснет, входящий приходит из меньшего), dir<0 — наоборот.
const levelVariants = {
  enter: (dir) => ({ opacity: 0, scale: dir >= 0 ? 0.9 : 1.1 }),
  center: { opacity: 1, scale: 1 },
  exit: (dir) => ({ opacity: 0, scale: dir >= 0 ? 1.1 : 0.9 }),
};
const fadeVariants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
};

// Сцена-«план»: едва заметная точечная сетка-миллиметровка отличает панель
// окружения от панелей данных (согласовано на макете).
const PLAN_GRID_STYLE = {
  backgroundImage:
    "radial-gradient(color-mix(in srgb, var(--foreground) 6%, transparent) 1px, transparent 1px)",
  backgroundSize: "18px 18px",
  backgroundPosition: "9px 9px",
};

const SUBJECT_TEXT = {
  applicant: {
    personalLabel: "Закреплено лично за заявителем",
    noWorkplace: "Заявитель не привязан к рабочему месту в учёте техники.",
  },
  user: {
    personalLabel: "Закреплено лично за пользователем",
    noWorkplace: "Пользователь не привязан к рабочему месту в учёте техники.",
  },
};

// Uppercase-метка секции внутри сцены (в духе Eyebrow/SubLabel).
const SectionLabel = ({ count, children }) => (
  <div className="tw:mt-5 tw:mb-2.5 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
    {children}
    {count != null && (
      <span className="tw:font-semibold tw:tracking-normal tw:tabular-nums">
        · {count}
      </span>
    )}
  </div>
);

// Тихая инлайн-строка (удалённое устройство, ошибки загрузки).
const NoteLine = ({ icon: Icon = RiHistoryLine, className, children }) => (
  <div
    className={cn(
      "tw:flex tw:items-center tw:gap-2.5 tw:rounded-lg tw:border tw:border-border-soft tw:bg-accent/50 tw:px-3.5 tw:py-2.5 tw:text-sm tw:text-muted-foreground",
      className,
    )}
  >
    <Icon size={16} className="tw:flex-none tw:text-faint" />
    <span>{children}</span>
  </div>
);

// Пустое состояние по канону карточек: приглушённая иконка, заголовок, абзац.
const EmptyState = ({ icon: Icon, title, children }) => (
  <div className="tw:flex tw:flex-col tw:items-center tw:px-5 tw:pt-6 tw:pb-1 tw:text-center">
    <span
      aria-hidden
      className="tw:grid tw:size-12 tw:place-items-center tw:rounded-xl tw:bg-accent tw:text-faint tw:inset-ring tw:inset-ring-border"
    >
      <Icon size={22} />
    </span>
    <div className="tw:mt-3.5 tw:text-base tw:font-semibold">{title}</div>
    <p className="tw:mx-auto tw:mt-1.5 tw:mb-0 tw:max-w-md tw:text-sm tw:text-muted-foreground">
      {children}
    </p>
  </div>
);

// Сколько вложенных пространств показываем без разворачивания: длинные списки
// на карточках обязаны сворачиваться (у компаний бывают десятки «висячих» РМ).
const CELLS_COLLAPSED = 12;

// Один уровень иерархии: шапка (тип/имя/подразделение + выход на карточку
// расположения), вложенные пространства (кликабельны все; ветка субъекта
// помечена «здесь») и техника этого уровня. Синтетический узел «компания» —
// обзор корневых расположений, техники у него нет.
const EnvLevel = ({
  node,
  chainIds,
  highlightId,
  onSelectChild,
  onSelectDevice,
}) => {
  const isCompany = node.type === "company";
  const Icon = isCompany ? RiCommunityLine : TYPE_ICON[node.type] || RiDoorLine;
  const children = node.children || [];
  const devices = node.devices || [];
  const sub = isCompany ? node.sub : node.subdivisionName;

  // Ключ уровня меняется вместе с узлом (motion key), поэтому состояние
  // разворота само сбрасывается при переходе между уровнями.
  const [showAllCells, setShowAllCells] = useState(false);
  const visibleChildren = showAllCells
    ? children
    : children.slice(0, CELLS_COLLAPSED);

  return (
    <div>
      <div className="tw:group tw:flex tw:items-center tw:gap-3.5 tw:pr-14">
        <span
          aria-hidden
          className="tw:grid tw:size-11 tw:flex-none tw:place-items-center tw:rounded-xl tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border"
        >
          <Icon size={22} />
        </span>
        <div className="tw:min-w-0">
          <div className="tw:text-[11px] tw:font-semibold tw:tracking-wide tw:text-faint tw:uppercase">
            {isCompany ? "Компания" : TYPE_LABEL[node.type] || node.type}
          </div>
          <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-1">
            <span className="tw:truncate tw:text-lg tw:leading-snug tw:font-semibold tw:tracking-tight">
              {node.name}
            </span>
            {!isCompany && (
              <Link
                to={`/inventory/locations/${node._id}`}
                title="Открыть карточку расположения"
                aria-label="Открыть карточку расположения"
                className="tw:grid tw:size-6 tw:flex-none tw:place-items-center tw:rounded-md tw:text-faint tw:no-underline tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:hover:bg-accent tw:hover:text-muted-foreground tw:focus-visible:opacity-100 tw:pointer-coarse:opacity-100"
              >
                <RiExternalLinkLine size={14} />
              </Link>
            )}
          </div>
          {sub && (
            <div className="tw:truncate tw:text-sm tw:text-muted-foreground">
              {sub}
            </div>
          )}
        </div>
      </div>

      {children.length > 0 && (
        <>
          <SectionLabel count={children.length}>
            {isCompany ? node.childrenLabel || "Здания" : "Внутри"}
          </SectionLabel>
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            {visibleChildren.map((child) => {
              const isCurrent = chainIds?.has(String(child._id));
              const meta = [
                TYPE_LABEL[child.type] || child.type,
                child.childCount > 0 &&
                  `${child.childCount} ${plural(child.childCount, "вложенное", "вложенных", "вложенных")}`,
                `${child.deviceCount ?? 0} техн.`,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={child._id}
                  type="button"
                  onClick={() => onSelectChild(child)}
                  title={`Открыть: ${child.name}`}
                  className={cn(
                    "tw:flex tw:min-w-40 tw:cursor-pointer tw:appearance-none tw:flex-col tw:items-start tw:gap-0.5 tw:rounded-lg tw:border tw:border-border-soft tw:bg-background tw:px-3 tw:py-2 tw:text-left tw:transition-colors tw:hover:border-primary/50 tw:hover:bg-accent",
                    isCurrent &&
                      "tw:border-primary/60 tw:inset-ring tw:inset-ring-primary/60",
                  )}
                >
                  <span className="tw:text-sm tw:font-medium">
                    {child.name}
                  </span>
                  <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-1.5 tw:text-xs tw:text-muted-foreground tw:tabular-nums">
                    {meta}
                    {isCurrent && (
                      <span className="tw:inline-flex tw:items-center tw:gap-1 tw:font-semibold tw:text-accent-text">
                        <span
                          aria-hidden
                          className="tw:size-1.5 tw:rounded-full tw:bg-primary tw:ring-3 tw:ring-primary/20"
                        />
                        здесь
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {children.length > CELLS_COLLAPSED && (
            <div className="tw:mt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllCells((prev) => !prev)}
              >
                {showAllCells ? "Свернуть" : `Показать все (${children.length})`}
              </Button>
            </div>
          )}
        </>
      )}

      {!isCompany && (
        <>
          <SectionLabel count={devices.length || undefined}>
            Техника на этом уровне
          </SectionLabel>
          {devices.length > 0 ? (
            <div className="tw:grid tw:gap-2 tw:sm:grid-cols-2 tw:xl:grid-cols-3">
              {devices.map((device) => (
                <EnvironmentDeviceTile
                  key={device._id}
                  device={device}
                  highlightId={highlightId}
                  onSelect={onSelectDevice}
                />
              ))}
            </div>
          ) : (
            <div className="tw:text-sm tw:text-faint">
              Здесь нет закреплённой техники.
            </div>
          )}
        </>
      )}
    </div>
  );
};

// Физическое окружение — семантический zoom по иерархии здание → этаж →
// помещение → рабочее место. Один компонент на три места:
//  - заявка: по заявителю (userId) или по устройству (deviceId, приоритетный —
//    авто-заявки мониторинга, их автор служебный и рабочего места не имеет);
//  - карточка пользователя: userId + subject="user";
//  - карточка компании: companyId — вход с обзора зданий (счётчики по поддереву).
// Скролл/стрелки/линейка/кластер «+/−» меняют масштаб по текущему пути; клик по
// любой дочерней локации подгружает её и ветвит путь. Клик по технике — шторка.
const Environment = ({ userId, deviceId, companyId, subject = "applicant" }) => {
  const { token } = getLocalStorageData();
  const reduceMotion = useReducedMotion();
  const { isLoading, error, sendRequest } = useHttp();
  const { isLoading: isDiving, sendRequest: fetchNode } = useHttp();

  const mode = deviceId ? "device" : userId ? "user" : companyId ? "company" : null;
  const texts = SUBJECT_TEXT[subject] || SUBJECT_TEXT.applicant;

  const [env, setEnv] = useState(null);
  // Текущий путь (загруженные узлы root→focus) и индекс активного уровня.
  const [path, setPath] = useState([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const stageRef = useRef(null);
  const dirRef = useRef(0); // направление последнего перехода для анимации

  useEffect(() => {
    if (!mode) return;
    const base = import.meta.env.VITE_API_ADDRESS;
    const url =
      mode === "device"
        ? `${base}/api/inventory/locations/device/${deviceId}/environment`
        : mode === "user"
          ? `${base}/api/inventory/locations/user/${userId}/environment`
          : `${base}/api/inventory/locations/company/${companyId}/environment`;
    sendRequest(
      { url, headers: { Authorization: "Bearer " + token } },
      (data) => {
        setEnv(data);
        if (mode === "company") {
          // Синтетический корень-обзор: корневые расположения компании как
          // вложенные пространства; дальше навигация идёт обычными узлами.
          // В корне бывают не только здания, но и «висячие» помещения/РМ —
          // подпись не должна врать.
          const buildings = data?.buildings || [];
          if (buildings.length) {
            const onlyBuildings = buildings.every(
              (b) => b.type === "building" || b.type === "storage",
            );
            const rootsWord = onlyBuildings
              ? plural(buildings.length, "здание", "здания", "зданий")
              : plural(
                  buildings.length,
                  "расположение",
                  "расположения",
                  "расположений",
                );
            const total = data.deviceTotal ?? 0;
            setPath([
              {
                _id: `company-${companyId}`,
                type: "company",
                name: data.company?.name || "Компания",
                childrenLabel: onlyBuildings ? "Здания" : "Расположения",
                sub: `${buildings.length} ${rootsWord} · ${total} ${plural(total, "устройство", "устройства", "устройств")} в учёте`,
                children: buildings.map((b) => ({
                  _id: b._id,
                  name: b.name,
                  type: b.type,
                  deviceCount: b.deviceTotal,
                  childCount: b.childCount,
                })),
                devices: [],
              },
            ]);
            setFocusIndex(0);
          }
          return;
        }
        if (data?.chain?.length) {
          setPath(data.chain);
          // Дефолт — самый «приближённый» уровень (рабочее место /
          // расположение устройства).
          setFocusIndex(data.chain.length - 1);
        }
      },
    );
  }, [mode, userId, deviceId, companyId, token, sendRequest]);

  // Id узлов цепочки субъекта — по ним помечаем ветку «здесь», оставляя
  // кликабельными ВСЕ дочерние узлы. В режиме компании цепочки нет.
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

  // Нырнуть в дочернюю локацию. Если она уже следующая в пути — просто
  // приближаем; иначе подгружаем её узел и ветвим путь от текущего уровня.
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
          // userId нужен только для слоя isPersonal — в остальных режимах его нет.
          url: `${import.meta.env.VITE_API_ADDRESS}/api/inventory/locations/${child._id}/node${mode === "user" || mode === "device" ? (userId ? `?userId=${userId}` : "") : ""}`,
          headers: { Authorization: "Bearer " + token },
        },
        (node) => {
          dirRef.current = 1;
          setPath((prev) => [...prev.slice(0, idx + 1), node]);
          setFocusIndex(idx + 1);
        },
      );
    },
    [isDiving, focusIndex, path, fetchNode, token, userId, mode],
  );

  useSemanticZoom({
    stageRef,
    levelIndex: safeIndex,
    maxIndex,
    navigate,
    enabled: hasChain && path.length > 1,
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

  if (!mode) {
    return (
      <NoteLine icon={RiMapPin2Line}>
        У заявки не указан инициатор — окружение недоступно.
      </NoteLine>
    );
  }
  if (isLoading) return <Spinner className="tw:min-h-64" />;
  if (error || !env) {
    return (
      <NoteLine icon={RiMapPin2Line}>
        {mode === "device"
          ? "Не удалось загрузить окружение устройства."
          : mode === "company"
            ? "Не удалось загрузить окружение компании."
            : "Не удалось загрузить окружение."}
      </NoteLine>
    );
  }

  const personal = env.personalDevices || [];
  const canZoomIn = safeIndex < maxIndex;
  const canZoomOut = safeIndex > 0;
  const zoomBtnClass =
    "tw:grid tw:size-9 tw:cursor-pointer tw:appearance-none tw:place-items-center tw:border-0 tw:bg-transparent tw:p-0 tw:text-muted-foreground tw:transition-colors tw:hover:bg-accent tw:hover:text-foreground tw:disabled:cursor-default tw:disabled:opacity-40 tw:disabled:hover:bg-transparent tw:max-md:size-11";

  return (
    <div>
      {mode === "device" && env.device?.deleted && (
        <NoteLine className="tw:mb-3">
          Устройство удалено из учёта — показано его последнее расположение.
        </NoteLine>
      )}

      {hasChain ? (
        <div className="tw:flex tw:items-stretch tw:gap-4 tw:max-md:flex-col tw:max-md:gap-0">
          {/* Линейка глубины: вертикальная на десктопе, лента чипов на мобайле */}
          <div
            role="group"
            aria-label="Уровни окружения"
            className="tw:relative tw:flex tw:flex-none tw:flex-col tw:justify-center tw:gap-0.5 tw:py-2 tw:max-md:flex-row tw:max-md:justify-start tw:max-md:gap-1.5 tw:max-md:overflow-x-auto tw:max-md:py-0 tw:max-md:pb-3"
          >
            <span
              aria-hidden
              className="tw:absolute tw:inset-y-5 tw:w-0.5 tw:rounded-full tw:bg-border tw:max-md:hidden"
              style={{ left: 13 }}
            />
            {path.map((node, i) => {
              const on = i === safeIndex;
              return (
                <button
                  key={node._id}
                  type="button"
                  onClick={() => navigate(i)}
                  title={node.name}
                  className={cn(
                    "tw:relative tw:flex tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2.5 tw:rounded-lg tw:border-0 tw:bg-transparent tw:px-1.5 tw:py-1.5 tw:text-sm tw:font-medium tw:text-muted-foreground tw:transition-colors tw:hover:text-foreground",
                    "tw:max-md:flex-none tw:max-md:rounded-full tw:max-md:border tw:max-md:border-input tw:max-md:bg-background tw:max-md:px-3",
                    on &&
                      "tw:font-semibold tw:text-accent-text tw:max-md:border-transparent tw:max-md:bg-primary/15",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "tw:size-3 tw:flex-none tw:rounded-full tw:border-2 tw:border-border tw:bg-background tw:transition-colors tw:max-md:size-2.5",
                      on &&
                        "tw:border-primary tw:bg-primary tw:ring-4 tw:ring-primary/20 tw:max-md:ring-0",
                    )}
                  />
                  <span className="tw:max-w-36 tw:truncate">{node.name}</span>
                </button>
              );
            })}
          </div>

          <div className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:gap-2.5">
            <div
              ref={stageRef}
              tabIndex={0}
              role="group"
              aria-busy={isDiving}
              aria-label="Окружение. Колесо мыши или стрелки вверх/вниз меняют масштаб."
              onKeyDown={onStageKeyDown}
              className={cn(
                "tw:relative tw:overflow-x-hidden tw:overflow-y-auto tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5",
                path.length > 1 && "tw:min-h-80",
              )}
              style={{
                ...PLAN_GRID_STYLE,
                maxHeight: "calc(100svh - 360px)",
                scrollbarGutter: "stable",
              }}
            >
              {path.length > 1 && (
                <div className="tw:absolute tw:top-3.5 tw:right-3.5 tw:z-10 tw:flex tw:flex-col tw:overflow-hidden tw:rounded-lg tw:border tw:border-border tw:bg-background">
                  <button
                    type="button"
                    onClick={() => navigate(safeIndex + 1)}
                    disabled={!canZoomIn}
                    title="Приблизить"
                    aria-label="Приблизить"
                    className={zoomBtnClass}
                  >
                    <RiZoomInLine size={17} />
                  </button>
                  <span aria-hidden className="tw:h-px tw:bg-border-soft" />
                  <button
                    type="button"
                    onClick={() => navigate(safeIndex - 1)}
                    disabled={!canZoomOut}
                    title="Отдалить"
                    aria-label="Отдалить"
                    className={zoomBtnClass}
                  >
                    <RiZoomOutLine size={17} />
                  </button>
                </div>
              )}

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
                  <EnvLevel
                    node={current}
                    chainIds={chainIds}
                    highlightId={mode === "device" ? deviceId : null}
                    onSelectChild={diveInto}
                    onSelectDevice={setSelectedDevice}
                  />
                </motion.div>
              </AnimatePresence>
            </div>
            {path.length > 1 && (
              <div className="tw:text-center tw:text-xs tw:text-faint tw:max-md:hidden">
                Колесо мыши или ↑ / ↓ — масштаб · клик по расположению — переход
                внутрь · клик по технике — карточка
              </div>
            )}
          </div>
        </div>
      ) : mode === "device" ? (
        <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5">
          <EmptyState
            icon={RiMapPin2Line}
            title="Устройство не привязано к расположению"
          >
            У устройства из заявки нет расположения в учёте техники. Ниже — его
            карточка.
          </EmptyState>
          {env.device && (
            <div className="tw:mx-auto tw:mt-5 tw:max-w-sm">
              <EnvironmentDeviceTile
                device={env.device}
                showLocation
                highlightId={deviceId}
                onSelect={setSelectedDevice}
              />
            </div>
          )}
        </div>
      ) : mode === "company" ? (
        <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5">
          <EmptyState icon={RiBuilding2Line} title="Зданий пока нет">
            Здесь появится физическая структура компании — здания, помещения и
            техника, — когда расположения заведут в учёте.
          </EmptyState>
          <div className="tw:mt-4 tw:pb-2 tw:text-center">
            <Button asChild variant="outline">
              <Link to="/inventory/locations">
                <RiExternalLinkLine /> Открыть раздел «Расположения»
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5">
          <EmptyState icon={RiMapPin2Line} title="Рабочее место не сопоставлено">
            {texts.noWorkplace}
            {personal.length > 0 &&
              " Показана техника, закреплённая лично за ним."}
          </EmptyState>
          {personal.length > 0 && (
            <div className="tw:mt-5">
              <SectionLabel count={personal.length}>
                Закреплено лично
              </SectionLabel>
              <div className="tw:grid tw:gap-2 tw:sm:grid-cols-2">
                {personal.map((device) => (
                  <EnvironmentDeviceTile
                    key={device._id}
                    device={device}
                    showLocation
                    onSelect={setSelectedDevice}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <EnvironmentDeviceSheet
        device={selectedDevice}
        isTarget={
          mode === "device" &&
          selectedDevice &&
          String(selectedDevice._id) === String(deviceId)
        }
        personalLabel={texts.personalLabel}
        onClose={() => setSelectedDevice(null)}
      />
    </div>
  );
};

export default Environment;
