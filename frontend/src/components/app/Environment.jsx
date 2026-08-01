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
  <div className="mt-5 mb-2.5 flex items-center gap-2 text-xs font-bold tracking-wider text-faint uppercase">
    {children}
    {count != null && (
      <span className="font-semibold tracking-normal tabular-nums">
        · {count}
      </span>
    )}
  </div>
);

// Тихая инлайн-строка (удалённое устройство, ошибки загрузки).
const NoteLine = ({ icon: Icon = RiHistoryLine, className, children }) => (
  <div
    className={cn(
      "flex items-center gap-2.5 rounded-lg border border-border-soft bg-accent/50 px-3.5 py-2.5 text-sm text-muted-foreground",
      className,
    )}
  >
    <Icon size={16} className="flex-none text-faint" />
    <span>{children}</span>
  </div>
);

// Пустое состояние по канону карточек: приглушённая иконка, заголовок, абзац.
const EmptyState = ({ icon: Icon, title, children }) => (
  <div className="flex flex-col items-center px-5 pt-6 pb-1 text-center">
    <span
      aria-hidden
      className="grid size-12 place-items-center rounded-xl bg-accent text-faint inset-ring inset-ring-border"
    >
      <Icon size={22} />
    </span>
    <div className="mt-3.5 text-base font-semibold">{title}</div>
    <p className="mx-auto mt-1.5 mb-0 max-w-md text-sm text-muted-foreground">
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
      <div className="group flex items-center gap-3.5 pr-14">
        <span
          aria-hidden
          className="grid size-11 flex-none place-items-center rounded-xl bg-accent text-muted-foreground inset-ring inset-ring-border"
        >
          <Icon size={22} />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-wide text-faint uppercase">
            {isCompany ? "Компания" : TYPE_LABEL[node.type] || node.type}
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate text-lg leading-snug font-semibold tracking-tight">
              {node.name}
            </span>
            {!isCompany && (
              <Link
                to={`/inventory/locations/${node._id}`}
                title="Открыть карточку расположения"
                aria-label="Открыть карточку расположения"
                className="grid size-6 flex-none place-items-center rounded-md text-faint no-underline opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-muted-foreground focus-visible:opacity-100 pointer-coarse:opacity-100"
              >
                <RiExternalLinkLine size={14} />
              </Link>
            )}
          </div>
          {sub && (
            <div className="truncate text-sm text-muted-foreground">{sub}</div>
          )}
        </div>
      </div>

      {children.length > 0 && (
        <>
          <SectionLabel count={children.length}>
            {isCompany ? node.childrenLabel || "Здания" : "Внутри"}
          </SectionLabel>
          <div className="flex flex-wrap gap-2">
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
                    "flex min-w-40 cursor-pointer appearance-none flex-col items-start gap-0.5 rounded-lg border border-border-soft bg-background px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-accent",
                    isCurrent &&
                      "border-primary/60 inset-ring inset-ring-primary/60",
                  )}
                >
                  <span className="text-sm font-medium">{child.name}</span>
                  <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
                    {meta}
                    {isCurrent && (
                      <span className="inline-flex items-center gap-1 font-semibold text-accent-text">
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full bg-primary ring-3 ring-primary/20"
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
            <div className="mt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllCells((prev) => !prev)}
              >
                {showAllCells
                  ? "Свернуть"
                  : `Показать все (${children.length})`}
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
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
            <div className="text-sm text-faint">
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
const Environment = ({
  userId,
  deviceId,
  companyId,
  subject = "applicant",
  onEmptyChange,
}) => {
  const { token } = getLocalStorageData();
  const reduceMotion = useReducedMotion();
  const { isLoading, error, sendRequest } = useHttp();
  const { isLoading: isDiving, sendRequest: fetchNode } = useHttp();

  const mode = deviceId
    ? "device"
    : userId
      ? "user"
      : companyId
        ? "company"
        : null;
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

  // «Показывать нечего» решает сам виджет — он один знает, что приехало с
  // сервера, — но прячет секцию ХОЗЯИН: метка и панель принадлежат странице.
  // Тот же приём, что у чек-листа: блок, сообщающий только о своём отсутствии,
  // занимает экран и пункт рейла ни за что.
  const empty =
    !mode ||
    (!isLoading &&
      !error &&
      Boolean(env) &&
      path.length === 0 &&
      (env.personalDevices?.length ?? 0) === 0 &&
      !(mode === "device" && env.device));

  useEffect(() => {
    onEmptyChange?.(empty);
  }, [empty]);

  if (!mode) {
    return (
      <NoteLine icon={RiMapPin2Line}>
        У заявки не указан инициатор — окружение недоступно.
      </NoteLine>
    );
  }
  if (isLoading) return <Spinner className="min-h-64" />;
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
    "grid size-9 cursor-pointer appearance-none place-items-center border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent max-md:size-11";

  return (
    <div>
      {mode === "device" && env.device?.deleted && (
        <NoteLine className="mb-3">
          Устройство удалено из учёта — показано его последнее расположение.
        </NoteLine>
      )}

      {hasChain ? (
        <div className="flex items-stretch gap-4 max-md:flex-col max-md:gap-0">
          {/* Линейка глубины: вертикальная на десктопе, лента чипов на мобайле */}
          <div
            role="group"
            aria-label="Уровни окружения"
            className="relative flex flex-none flex-col justify-center gap-0.5 py-2 max-md:flex-row max-md:justify-start max-md:gap-1.5 max-md:overflow-x-auto max-md:py-0 max-md:pb-3"
          >
            <span
              aria-hidden
              className="absolute inset-y-5 w-0.5 rounded-full bg-border max-md:hidden"
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
                    "relative flex cursor-pointer appearance-none items-center gap-2.5 rounded-lg border-0 bg-transparent px-1.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                    "max-md:flex-none max-md:rounded-full max-md:border max-md:border-input max-md:bg-background max-md:px-3",
                    on &&
                      "font-semibold text-accent-text max-md:border-transparent max-md:bg-primary/15",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-3 flex-none rounded-full border-2 border-border bg-background transition-colors max-md:size-2.5",
                      on &&
                        "border-primary bg-primary ring-4 ring-primary/20 max-md:ring-0",
                    )}
                  />
                  <span className="max-w-36 truncate">{node.name}</span>
                </button>
              );
            })}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div
              ref={stageRef}
              tabIndex={0}
              role="group"
              aria-busy={isDiving}
              aria-label="Окружение. Колесо мыши или стрелки вверх/вниз меняют масштаб."
              onKeyDown={onStageKeyDown}
              className={cn(
                "relative overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-card p-5",
                path.length > 1 && "min-h-80",
              )}
              style={{
                ...PLAN_GRID_STYLE,
                maxHeight: "calc(100svh - 360px)",
                scrollbarGutter: "stable",
              }}
            >
              {path.length > 1 && (
                <div className="absolute top-3.5 right-3.5 z-10 flex flex-col overflow-hidden rounded-lg border border-border bg-background">
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
                  <span aria-hidden className="h-px bg-border-soft" />
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

              <AnimatePresence
                mode="wait"
                custom={dirRef.current}
                initial={false}
              >
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
              <div className="text-center text-xs text-faint max-md:hidden">
                Колесо мыши или ↑ / ↓ — масштаб · клик по расположению — переход
                внутрь · клик по технике — карточка
              </div>
            )}
          </div>
        </div>
      ) : mode === "device" ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <EmptyState
            icon={RiMapPin2Line}
            title="Устройство не привязано к расположению"
          >
            У устройства из заявки нет расположения в учёте техники. Ниже — его
            карточка.
          </EmptyState>
          {env.device && (
            <div className="mx-auto mt-5 max-w-sm">
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
        <div className="rounded-xl border border-border bg-card p-5">
          <EmptyState icon={RiBuilding2Line} title="Зданий пока нет">
            Здесь появится физическая структура компании — здания, помещения и
            техника, — когда расположения заведут в учёте.
          </EmptyState>
          <div className="mt-4 pb-2 text-center">
            <Button asChild variant="outline">
              <Link to="/inventory/locations">
                <RiExternalLinkLine /> Открыть раздел «Расположения»
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-5">
          <EmptyState
            icon={RiMapPin2Line}
            title="Рабочее место не сопоставлено"
          >
            {texts.noWorkplace}
            {personal.length > 0 &&
              " Показана техника, закреплённая лично за ним."}
          </EmptyState>
          {personal.length > 0 && (
            <div className="mt-5">
              <SectionLabel count={personal.length}>
                Закреплено лично
              </SectionLabel>
              <div className="grid gap-2 sm:grid-cols-2">
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
