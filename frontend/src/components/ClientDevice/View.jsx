import { useEffect, useMemo, useState } from "react";
import { Link, useRevalidator } from "react-router";
import UserLink from "@/components/app/UserLink";
import { BrowserView } from "react-device-detect";
import {
  RiAddLine,
  RiBarcodeLine,
  RiBuilding2Line,
  RiCalendarLine,
  RiCpuLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiFileList2Line,
  RiFingerprintLine,
  RiGlobalLine,
  RiLinkUnlink,
  RiLinksLine,
  RiMapPin2Line,
  RiMoreLine,
  RiPriceTag3Line,
  RiQrCodeLine,
  RiShieldCheckLine,
  RiShoppingCart2Line,
  RiStackLine,
  RiTerminalBoxLine,
  RiUser3Line,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Crumbs, { useCrumbFrom } from "@/components/app/Crumbs";
import AlertMessage from "@/components/app/AlertMessage";
import AnchorRail from "@/components/app/AnchorRail";
import { DeleteDialog } from "@/components/app/DeleteItem";
import FormOutlet from "@/components/app/FormOutlet";
import Environment from "@/components/app/Environment";
import {
  ENVIRONMENT_VIEW_OPTIONS,
  useEnvironmentView,
} from "@/components/app/environment-view";
import Segmented from "@/components/app/Segmented";
import {
  Eyebrow,
  Panel,
  Section,
  SectionEditLink,
} from "@/components/app/Panel";
import PropRow from "@/components/app/PropRow";
import SpecSheet from "@/components/app/SpecSheet";
import {
  buildSpecGroups,
  formatSpecValue,
  specSummary,
} from "@/components/app/spec-sheet";
import {
  buildAssemblyGroups,
  compactKeySpecsLine,
  collapseDiffRows,
  connectedRows,
  devicePartsToAssembly,
  diffWithBuild,
  liveAssembly,
} from "@/components/app/assembly-specs";
import {
  DEVICE_STATUS_META,
  DeviceStatusText,
  deviceIcon,
  mikrotikStatus,
} from "@/components/app/device-status";
import { cn } from "@/lib/utils";

import { formatCalendarDate } from "../../util/format-date";
import { plural } from "../../util/plural";
import PhotoGallery, { photoUrl } from "@/components/app/PhotoGallery";
import AssemblyConfiguration, {
  MissingRequiredAlert,
} from "./AssemblyConfiguration";
import AssignUserDialog from "./AssignUserDialog";
import AttachComponentDialog from "./AttachComponentDialog";
import MonitoringPanel from "./MonitoringPanel";
import NewComponentDialog from "./NewComponentDialog";
import QrDialog from "./QrDialog";
import TicketsPanel from "./TicketsPanel";
import { useCan } from "@/store/authed-user";
import useInitialPrefsStore from "@/store/prefs";

const dash = <span className="text-faint">—</span>;

// Ярлык секции: та же форма, что у «Изменить» в шапке, открытая сразу на своей
// секции (см. docs/ux-ui-guide.md, «Одно поле — одно место правки»).
const refName = (value) =>
  value?.alias || value?.fullTitle || value?.name || null;

const formatMoney = (value) =>
  value || value === 0 ? `${Number(value).toLocaleString("ru-RU")} ₽` : null;

/**
 * Гарантия — фраза с состоянием, а не бейдж: у состояния есть срок, и он важнее
 * самого факта («до 10.06.2027 · ещё 3 мес.»). На исходе тон переключается на
 * warning, истёкшая — приглушённо: это не авария, а факт учёта.
 */
const warrantyState = (value) => {
  if (!value) return null;
  const days = Math.ceil((new Date(value) - new Date()) / 86400000);
  const date = formatCalendarDate(value);
  if (days < 0) return { tone: "off", text: `истекла ${date}` };
  if (days <= 30)
    return {
      tone: "warn",
      text: `до ${date} · ${days} ${plural(days, "день", "дня", "дней")}`,
    };
  const months = Math.round(days / 30);
  return {
    tone: "ok",
    text: `до ${date} · ещё ${months} ${plural(months, "месяц", "месяца", "месяцев")}`,
  };
};

/**
 * Карточка устройства — паспорт единицы техники: что это, чьё, где стоит, что
 * рядом, из чего собрано, сколько стоило, на связи ли и что с ним случалось.
 *
 * Вкладок нет: мониторинг Mikrotik — самостоятельный раздел со своей страницей
 * записи, здесь только сводка со ссылкой туда (см. MonitoringPanel). Секции
 * ПОКАЗЫВАЮТ, правит форма («Изменить» в hero); у правимых секций есть второй
 * вход в неё — `app/SectionEditLink`, карандаш по наведению, открывающий форму
 * сразу на нужной секции. Исключения — операции со своими эндпоинтами: выдача
 * пользователю (меняет статус) и прикрепление комплектующего; они называют себя
 * текстом и видны всегда.
 */
const ViewClientDevice = ({ device = {} }) => {
  const revalidator = useRevalidator();
  const can = useCan();
  const canManage = Boolean(can({ device: ["manage"] }));
  const canManageMikrotik = Boolean(can({ mikrotik: ["manage"] }));
  const mikrotikOn = useInitialPrefsStore(
    (state) => !!state.modules?.mikrotik?.isActive,
  );

  const [qrOpen, setQrOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [newComponentOpen, setNewComponentOpen] = useState(false);
  const [detachingId, setDetachingId] = useState(null);
  const [detachError, setDetachError] = useState("");
  const [hasTickets, setHasTickets] = useState(true);

  // Карточка, открытая из проскроленного списка, иначе уезжает под навбар.
  // Тело — блоком, а не выражением: стрелка с выражением ВОЗВРАЩАЕТ его
  // результат, и React принимает его за функцию очистки («destroy is not a
  // function» при размонтировании). Так же написано во всех прочих карточках.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const [environmentView, setEnvironmentView] = useEnvironmentView();

  const model = device.deviceModelId;
  const type = model?.deviceTypeId || device.deviceTypeId;
  const vendor = model?.vendorId;
  const isCustom = !model;
  // Имя в сети — только у типов-устройств: у комплектующих, расходников и
  // периферии его нет (поле в модели остаётся, здесь не показывается)
  const partLike = Boolean(
    type?.isComponent || type?.isConsumable || type?.isPeripheral,
  );
  // «Параметры устройства» — атрибуты уровня «device» типа (getOne отдаёт
  // deviceLinks и attributes), имя в сети и ID машины агента
  const paramLinks = (device.deviceLinks || []).filter(
    (link) => link.attributeId && typeof link.attributeId === "object",
  );
  const paramValue = (attributeId) =>
    (device.attributes || []).find(
      (entry) =>
        String(entry.attributeId?._id ?? entry.attributeId) ===
        String(attributeId),
    )?.value;
  const showParams =
    !partLike || paramLinks.length > 0 || Boolean(device.machineId);
  const title =
    [vendor?.name, model?.name].filter(Boolean).join(" ") ||
    type?.name ||
    "Устройство";

  // Как устройство назовётся в крошке компании, расположения, человека
  const fromState = useCrumbFrom(title);

  const status = DEVICE_STATUS_META[device.status];
  const warranty = warrantyState(device.warrantyExpirationDate);
  const components = device.components || [];
  const parent = device.parentDeviceId;
  const configuration = device.configurationId;
  // Значения конфигурации по группам эффективного типа (specLinks отдаёт
  // getOne); без групп — секции нет.
  const specLinks = device.specLinks || [];
  const specValues = configuration?.values || [];
  const specGroups = buildSpecGroups(specLinks, specValues);
  const specLabel = specSummary(specLinks, specValues);

  // ПК своей сборки собираемого типа: getOne добавляет сборку типа (слоты и
  // ключевые характеристики), сборку-шаблон и связки типов деталей. Детали в
  // слотах — «Конфигурация» и характеристики, прочие дети — «Подключено».
  const assembly =
    isCustom && device.assembly ? liveAssembly(device.assembly) : null;
  const build = assembly ? device.build || null : null;
  const slotTypeIds = new Set(
    (assembly?.slots || []).map((slot) => slot.typeId._id),
  );
  const inSlot = (component) =>
    slotTypeIds.has(
      component.deviceModelId?.deviceTypeId?._id || component.deviceTypeId?._id,
    );
  const slotParts = assembly
    ? devicePartsToAssembly(components.filter(inSlot))
    : [];
  const connected = assembly
    ? components.filter((component) => !inSlot(component))
    : components;
  const diff = assembly
    ? diffWithBuild(assembly.slots, build ? build.parts || [] : null, slotParts)
    : null;
  const configRows = diff ? collapseDiffRows(diff.rows) : [];
  // Пустая «Конфигурация» — только тем, кто может её наполнить (как раньше
  // у «Состава сборки»)
  const showConfig = configRows.length > 0 || canManage;
  // «Состав сборки» — у типа, который собирается из комплектующих; уже
  // прикреплённые детали видны у любого
  const showComponents =
    components.length > 0 || (canManage && Boolean(type?.assembly?.enabled));
  // «Подключено» — тем же видом строк, что «Конфигурация»
  const connectedConfigRows = assembly
    ? connectedRows(devicePartsToAssembly(connected))
    : [];
  // «Конфигурация · N» — штук деталей: «2 × память» — две
  const configUnits = slotParts.reduce((sum, part) => sum + part.quantity, 0);
  // Сжатая сводка — первой строкой «Конфигурации» (в шапке её больше нет)
  const keySpecsSummary = assembly
    ? compactKeySpecsLine(assembly.keySpecs, slotParts, assembly.slots)
    : "";
  const assemblyGroups = assembly
    ? buildAssemblyGroups(slotParts, device.partLinks || {})
    : [];

  const photos = device.photos || [];
  const modelPhotos = model?.photos || [];
  const effectivePhotos = photos.length ? photos : modelPhotos;

  // Живой статус связи — из оверлея загрузчика (полные данные тянет секция).
  const mikro = mikrotikStatus({
    mikrotikManaged: Boolean(device.mikrotik),
    mikrotikMonitoringEnabled: device.mikrotik?.monitoringEnabled,
    mikrotikStatus: device.mikrotik?.status,
  });
  // Секция мониторинга есть у подключённых и у управляемых вендоров (там —
  // вход в подключение) — пока включён модуль «Мониторинг Mikrotik».
  const showMonitoring =
    mikrotikOn &&
    (Boolean(device.mikrotik) || Boolean(vendor?.isMikrotikManagementEnabled));

  const detachComponent = async (componentId) => {
    setDetachingId(componentId);
    setDetachError("");
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/${device._id}/components/${componentId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Не удалось открепить устройство");
      }
      revalidator.revalidate();
    } catch (error) {
      setDetachError(error.message);
    } finally {
      setDetachingId(null);
    }
  };

  // Строка прикреплённого устройства (прежняя строка «Состава сборки»):
  // плитка типа, имя, «тип · номер · SN», гарантия, «открепить».
  const componentRow = (component) => {
    const componentType =
      component.deviceModelId?.deviceTypeId?.name ||
      component.deviceTypeId?.name;
    const ComponentIcon = deviceIcon(componentType);
    const componentWarranty = warrantyState(component.warrantyExpirationDate);
    const name =
      [component.deviceModelId?.vendorId?.name, component.deviceModelId?.name]
        .filter(Boolean)
        .join(" ") ||
      componentType ||
      "Устройство";
    return (
      <div
        key={component._id}
        className="flex items-center gap-3.5 border-t border-border-soft py-2.5 first:border-t-0"
      >
        <Link
          to={`/inventory/client-devices/${component._id}`}
          className="flex min-w-0 flex-1 items-center gap-3 text-foreground no-underline"
        >
          <span
            aria-hidden
            className="grid size-9 flex-none place-items-center rounded-lg bg-accent text-muted-foreground"
          >
            <ComponentIcon size={17} />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {name}
              {component.quantity > 1 && (
                <span className="font-normal text-faint">
                  {" "}
                  × {component.quantity}
                </span>
              )}
            </span>
            <span className="block truncate text-sm text-muted-foreground">
              {[
                componentType,
                component.inventoryNumber,
                component.serialNumber ? `SN ${component.serialNumber}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </Link>
        <span className="hidden w-48 flex-none text-sm lg:block">
          {componentWarranty ? (
            <span
              className={cn(
                componentWarranty.tone === "warn"
                  ? "text-warning"
                  : "text-muted-foreground",
              )}
            >
              Гарантия {componentWarranty.text}
            </span>
          ) : (
            <span className="text-faint">Гарантия не указана</span>
          )}
        </span>
        {canManage && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Открепить от сборки"
            aria-label="Открепить от сборки"
            disabled={detachingId === component._id}
            onClick={() => detachComponent(component._id)}
            className="flex-none text-faint"
          >
            <RiLinkUnlink />
          </Button>
        )}
      </div>
    );
  };

  // «Новая» / «Прикрепить» — у «Состава сборки» и у «Конфигурации» одни
  const componentActions = canManage && (
    <>
      <Button
        variant="outline"
        size="xs"
        onClick={() => setNewComponentOpen(true)}
      >
        <RiAddLine /> Новая
      </Button>
      <Button variant="outline" size="xs" onClick={() => setAttachOpen(true)}>
        <RiLinksLine /> Прикрепить
      </Button>
    </>
  );

  // Рейл собирается только из реально отрисованных секций.
  const railSections = useMemo(
    () =>
      [
        { id: "placement", label: "Размещение" },
        { id: "identity", label: "Идентификация" },
        specGroups.length && !assembly
          ? { id: "specs", label: "Характеристики" }
          : null,
        showParams ? { id: "params", label: "Параметры устройства" } : null,
        ...(assembly
          ? [
              showConfig ? { id: "components", label: "Конфигурация" } : null,
              connected.length
                ? { id: "connected", label: "Подключено" }
                : null,
              assemblyGroups.length
                ? { id: "specs", label: "Характеристики" }
                : null,
            ]
          : [
              showComponents
                ? { id: "components", label: "Состав сборки" }
                : null,
            ]),
        { id: "purchase", label: "Закупка и гарантия" },
        device.notes ? { id: "notes", label: "Заметки" } : null,
        showMonitoring ? { id: "monitoring", label: "Мониторинг" } : null,
        hasTickets ? { id: "tickets", label: "Заявки" } : null,
        effectivePhotos.length || canManage
          ? { id: "photos", label: "Фотографии" }
          : null,
        { id: "environment", label: "Окружение" },
      ].filter(Boolean),
    [
      specGroups.length,
      showParams,
      Boolean(device.notes),
      showComponents,
      Boolean(assembly),
      showConfig,
      connected.length,
      assemblyGroups.length,
      canManage,
      showMonitoring,
      hasTickets,
      effectivePhotos.length,
    ],
  );

  const TypeIcon = deviceIcon(type?.name);
  // Подстрока не повторяет заголовок: у сборки он и есть тип, у модели в нём
  // уже производитель
  const heroSub = assembly ? (
    <>
      Своя сборка
      {build && (
        <>
          {" · "}
          <Link
            to={`/inventory/device-builds/${build._id}`}
            state={fromState}
            className="font-medium text-accent-text no-underline hover:underline"
          >
            {build.name || "Без названия"}
          </Link>
        </>
      )}
    </>
  ) : isCustom ? (
    "Собственная сборка"
  ) : (
    type?.name || null
  );
  const heroPhoto = effectivePhotos[0] ? photoUrl(effectivePhotos[0]) : null;

  return (
    <>
      <div className="mx-auto w-full max-w-5xl">
        <Crumbs />

        {/* Hero (макет «Шапка карточки устройства»): имя, что это, статус и
            действия. Инвентарный номер — в «Идентификации», характеристики
            сборки — в «Конфигурации». Телефон: иконка в строке с заголовком,
            остальное во всю ширину (сетка; с md — прежний ряд) */}
        <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 md:flex md:flex-wrap md:items-start md:gap-4">
          <span
            aria-hidden
            className="grid size-11 flex-none place-items-center overflow-hidden rounded-xl bg-accent text-xl text-muted-foreground inset-ring inset-ring-border bg-cover bg-center md:size-14 md:rounded-2xl md:text-2xl"
            style={
              heroPhoto ? { backgroundImage: `url(${heroPhoto})` } : undefined
            }
          >
            {!heroPhoto && <TypeIcon />}
          </span>

          <div className="contents md:block md:min-w-0 md:flex-1">
            <h1 className="col-start-2 my-0 self-center text-xl leading-tight font-semibold tracking-tight md:text-2xl">
              {title}
            </h1>

            {heroSub && (
              <div className="col-span-full mt-3 text-sm text-muted-foreground md:mt-2">
                {heroSub}
              </div>
            )}

            <div className="col-span-full mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {status && (
                <DeviceStatusText tone={status.tone} className="text-sm">
                  {status.label}
                </DeviceStatusText>
              )}
              {warranty && (
                <span
                  className={cn(
                    "text-sm",
                    warranty.tone === "warn"
                      ? "text-warning"
                      : "text-muted-foreground",
                  )}
                >
                  Гарантия {warranty.text}
                </span>
              )}
              {mikro && (
                <DeviceStatusText tone={mikro.tone} className="text-sm">
                  {mikro.label}
                </DeviceStatusText>
              )}
            </div>
          </div>

          <div className="col-span-full mt-3.5 flex items-center gap-2 md:mt-0 md:flex-none">
            {/* QR — отдельная кнопка, а не пункт меню: код открывают часто и
                не глядя в списки действий */}
            <Button
              variant="outline"
              onClick={() => setQrOpen(true)}
              title="Показать QR-код"
            >
              <RiQrCodeLine /> QR-код
            </Button>
            {canManage && (
              <>
                {/* В «⋯» — только разрушающее: выдача и прикрепление живут
                    ярлыками своих секций, дублировать их незачем */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Действия"
                      title="Действия"
                    >
                      <RiMoreLine />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setDeleteOpen(true)}
                    >
                      <RiDeleteBinLine /> Удалить
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* Телефон: «Изменить» первой и во всю оставшуюся ширину */}
                <Button asChild className="max-md:order-first max-md:flex-1">
                  <Link to="update">
                    <RiEdit2Line /> Изменить
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Секции одним скроллом; слева — липкий рейл-якорь (только десктоп) */}
        <div className="flex items-start gap-7">
          <BrowserView className="contents">
            <AnchorRail
              sections={railSections}
              ariaLabel="Разделы карточки"
              className="mt-6"
            />
          </BrowserView>
          <div className="min-w-0 flex-1">
            <Section>
              <Eyebrow
                id="placement"
                action={
                  canManage && (
                    <>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => setAssignOpen(true)}
                      >
                        {device.userId ? "Сменить пользователя" : "Выдать"}
                      </Button>
                      <SectionEditLink
                        to="update#placement"
                        label="Размещение"
                       
                      />
                    </>
                  )
                }
              >
                Размещение
              </Eyebrow>
              <Panel>
                {/* Комплектующее, расходник, периферия: путь наверх — в списке
                    устройств его нет; размещение детали — это её сборка */}
                {parent && (
                  <PropRow icon={<RiStackLine size={17} />} label="В составе">
                    <Link
                      to={`/inventory/client-devices/${parent._id}`}
                      state={fromState}
                      className="text-foreground no-underline hover:text-accent-text"
                    >
                      {[
                        parent.deviceModelId?.name || parent.deviceTypeId?.name,
                        parent.inventoryNumber,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Link>
                  </PropRow>
                )}
                <PropRow icon={<RiBuilding2Line size={17} />} label="Компания">
                  {device.companyId ? (
                    <Link
                      to={`/companies/${device.companyId._id}`}
                      state={fromState}
                      className="text-foreground no-underline hover:text-accent-text"
                    >
                      {refName(device.companyId)}
                    </Link>
                  ) : (
                    dash
                  )}
                </PropRow>
                <PropRow
                  icon={<RiMapPin2Line size={17} />}
                  label="Расположение"
                >
                  {device.locationId ? (
                    <>
                      <Link
                        to={`/inventory/locations/${device.locationId._id}`}
                      state={fromState}
                        className="text-foreground no-underline hover:text-accent-text"
                      >
                        {device.locationId.name}
                      </Link>
                      {device.locationPath?.length > 1 && (
                        // Путь целиком: «Серверная» без здания не отвечает на
                        // вопрос «куда ехать».
                        <span className="mt-0.5 block truncate text-xs font-normal text-faint">
                          {device.locationPath
                            .map((node) => node.name)
                            .join(" › ")}
                        </span>
                      )}
                    </>
                  ) : (
                    dash
                  )}
                </PropRow>
                <PropRow icon={<RiUser3Line size={17} />} label="Закреплено за">
                  {device.userId ? (
                    <UserLink
                      id={device.userId._id}
                      state={fromState}
                      className="text-foreground no-underline hover:text-accent-text"
                    >
                      {[device.userId.lastName, device.userId.firstName]
                        .filter(Boolean)
                        .join(" ")}
                    </UserLink>
                  ) : (
                    dash
                  )}
                </PropRow>
              </Panel>
            </Section>

            <Section>
              <Eyebrow
                id="identity"
                action={
                  canManage && (
                    <SectionEditLink
                      to="update#device"
                      label="Идентификация"
                     
                    />
                  )
                }
              >
                Идентификация
              </Eyebrow>
              <Panel>
                <PropRow
                  icon={<RiPriceTag3Line size={17} />}
                  label="Тип · модель"
                >
                  {type ? (
                    <>
                      <Link
                        to={`/inventory/device-types/${type._id}`}
                      state={fromState}
                        className="text-foreground no-underline hover:text-accent-text"
                      >
                        {type.name}
                      </Link>
                      {model && (
                        <>
                          {" · "}
                          <Link
                            to={`/inventory/device-models/${model._id}`}
                      state={fromState}
                            className="text-foreground no-underline hover:text-accent-text"
                          >
                            {[vendor?.name, model.name]
                              .filter(Boolean)
                              .join(" ")}
                          </Link>
                        </>
                      )}
                    </>
                  ) : (
                    dash
                  )}
                </PropRow>
                <PropRow
                  icon={<RiQrCodeLine size={17} />}
                  label="Инвентарный номер"
                  copy={
                    device.inventoryNumber
                      ? {
                          value: device.inventoryNumber,
                          label: "Инвентарный номер",
                        }
                      : undefined
                  }
                >
                  {device.inventoryNumber ? (
                    <span className="font-mono">{device.inventoryNumber}</span>
                  ) : (
                    dash
                  )}
                </PropRow>
                <PropRow
                  icon={<RiBarcodeLine size={17} />}
                  label="Серийный номер"
                  copy={
                    device.serialNumber
                      ? { value: device.serialNumber, label: "Серийный номер" }
                      : undefined
                  }
                >
                  {device.serialNumber ? (
                    <span className="font-mono">{device.serialNumber}</span>
                  ) : (
                    dash
                  )}
                </PropRow>
              </Panel>
            </Section>

            {specGroups.length > 0 && !assembly && (
              <>
                <Eyebrow id="specs">
                  Характеристики
                  {specLabel && (
                    <span className="min-w-0 truncate">· {specLabel}</span>
                  )}
                </Eyebrow>
                <Panel>
                  <SpecSheet groups={specGroups} />
                </Panel>
              </>
            )}

            {showParams && (
              <Section>
                <Eyebrow
                  id="params"
                  action={
                    canManage && (
                      <SectionEditLink
                        to="update#params"
                        label="Параметры устройства"
                      />
                    )
                  }
                >
                  Параметры устройства
                </Eyebrow>
                <Panel>
                  {!partLike && (
                    <PropRow
                      icon={<RiTerminalBoxLine size={17} />}
                      label="Имя устройства"
                    >
                      {device.hostname ? (
                        <span className="font-mono">{device.hostname}</span>
                      ) : (
                        dash
                      )}
                    </PropRow>
                  )}
                  {paramLinks.map((link) => {
                    const attr = link.attributeId;
                    const text = formatSpecValue(attr, paramValue(attr._id));
                    const network =
                      attr.code === "ip_address" || attr.code === "mac_address";
                    return (
                      <PropRow
                        key={attr._id}
                        icon={
                          network ? (
                            <RiGlobalLine size={17} />
                          ) : attr.code === "operatingsystem" ? (
                            <RiCpuLine size={17} />
                          ) : attr.valueType === "date" ? (
                            <RiCalendarLine size={17} />
                          ) : (
                            <RiPriceTag3Line size={17} />
                          )
                        }
                        label={attr.name}
                        copy={
                          attr.code === "ip_address" && text
                            ? { value: text, label: attr.name }
                            : undefined
                        }
                      >
                        {text ? (
                          <span className={network ? "font-mono" : undefined}>
                            {text}
                          </span>
                        ) : (
                          dash
                        )}
                      </PropRow>
                    );
                  })}
                  {device.machineId && (
                    <PropRow
                      icon={<RiFingerprintLine size={17} />}
                      label="ID машины (агент)"
                    >
                      <span className="font-mono text-sm">
                        {device.machineId}
                      </span>
                    </PropRow>
                  )}
                </Panel>
              </Section>
            )}

            {assembly ? (
              <>
                {/* ПК своей сборки: «Конфигурация» вместо «Состава сборки» —
                    детали по слотам со сверкой со сборкой; прочие дети —
                    «Подключено» теми же строками; характеристики — из деталей */}
                {showConfig && (
                  <>
                    <Eyebrow
                      id="components"
                      count={configUnits}
                      action={componentActions}
                    >
                      Конфигурация
                    </Eyebrow>
                    <MissingRequiredAlert names={diff.missingRequired} />
                  </>
                )}
                {/* Над панелью: строки внутри неё — до края (гасят отступ) */}
                {detachError && (
                  <AlertMessage
                    variant="danger"
                    message={detachError}
                    className="mt-0 mb-2.5"
                  />
                )}
                {showConfig && (
                  <Panel>
                    {configRows.length === 0 ? (
                      <p className="my-1 text-sm text-muted-foreground">
                        Комплектующие не прикреплены. «Прикрепить» добавит в
                        сборку свободное устройство этой компании.
                      </p>
                    ) : (
                      <AssemblyConfiguration
                        rows={configRows}
                        summary={keySpecsSummary}
                        canManage={canManage}
                        detachingId={detachingId}
                        onDetach={detachComponent}
                        onNew={() => setNewComponentOpen(true)}
                        onAttach={() => setAttachOpen(true)}
                      />
                    )}
                  </Panel>
                )}

                {connectedConfigRows.length > 0 && (
                  <>
                    <Eyebrow id="connected" count={connectedConfigRows.length}>
                      Подключено
                    </Eyebrow>
                    <Panel>
                      <AssemblyConfiguration
                        rows={connectedConfigRows}
                        connected
                        canManage={canManage}
                        detachingId={detachingId}
                        onDetach={detachComponent}
                      />
                    </Panel>
                  </>
                )}

                {assemblyGroups.length > 0 && (
                  <>
                    <Eyebrow id="specs">Характеристики</Eyebrow>
                    <Panel>
                      <SpecSheet groups={assemblyGroups} />
                    </Panel>
                  </>
                )}
              </>
            ) : (
              showComponents && (
                <>
                  <Eyebrow
                    id="components"
                    count={components.length}
                    action={componentActions}
                  >
                    Состав сборки
                  </Eyebrow>
                  <Panel>
                    {detachError && (
                      <AlertMessage variant="danger" message={detachError} />
                    )}
                    {components.length === 0 ? (
                      <p className="my-1 text-sm text-muted-foreground">
                        Комплектующие не прикреплены. «Прикрепить» добавит в
                        сборку свободное устройство этой компании.
                      </p>
                    ) : (
                      components.map(componentRow)
                    )}
                  </Panel>
                </>
              )
            )}

            <Section>
              <Eyebrow
                id="purchase"
                action={
                  canManage && (
                    <SectionEditLink
                      to="update#purchase"
                      label="Закупка и гарантия"
                     
                    />
                  )
                }
              >
                Закупка и гарантия
              </Eyebrow>
              <Panel>
                <PropRow
                  icon={<RiShoppingCart2Line size={17} />}
                  label="Приобретено · стоимость"
                >
                  {[
                    formatCalendarDate(device.purchasedAt),
                    formatMoney(device.price),
                  ].filter(Boolean).length
                    ? [
                        formatCalendarDate(device.purchasedAt),
                        formatMoney(device.price),
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : dash}
                </PropRow>
                <PropRow
                  icon={<RiFileList2Line size={17} />}
                  label="Документ · поставщик"
                >
                  {[device.purchaseDocument, refName(device.supplierId)].filter(
                    Boolean,
                  ).length
                    ? [device.purchaseDocument, refName(device.supplierId)]
                        .filter(Boolean)
                        .join(" · ")
                    : dash}
                </PropRow>
                <PropRow
                  icon={<RiShieldCheckLine size={17} />}
                  label="Гарантия"
                >
                  {warranty ? (
                    <span
                      className={
                        warranty.tone === "warn" ? "text-warning" : undefined
                      }
                    >
                      {warranty.text}
                    </span>
                  ) : (
                    dash
                  )}
                </PropRow>
                <PropRow
                  icon={<RiCalendarLine size={17} />}
                  label="Последнее обслуживание"
                >
                  {formatCalendarDate(device.lastMaintenanceDate) || dash}
                </PropRow>
              </Panel>
            </Section>

            {device.notes && (
              <Section>
                <Eyebrow
                  id="notes"
                  action={
                    canManage && (
                      <SectionEditLink to="update#notes" label="Заметки" />
                    )
                  }
                >
                  Заметки
                </Eyebrow>
                <Panel>
                  <p className="my-0 text-sm whitespace-pre-line">
                    {device.notes}
                  </p>
                </Panel>
              </Section>
            )}

            {showMonitoring && (
              <>
                <Eyebrow id="monitoring">Мониторинг</Eyebrow>
                <Panel>
                  <MonitoringPanel
                    device={device}
                    canManage={canManageMikrotik}
                    onSynced={() => revalidator.revalidate()}
                  />
                </Panel>
              </>
            )}

            {hasTickets && (
              <>
                <Eyebrow id="tickets">Заявки</Eyebrow>
                <Panel>
                  <TicketsPanel
                    deviceId={device._id}
                    onEmpty={() => setHasTickets(false)}
                  />
                </Panel>
              </>
            )}

            {(effectivePhotos.length > 0 || canManage) && (
              <>
                <Eyebrow id="photos" count={effectivePhotos.length}>
                  Фотографии
                </Eyebrow>
                <Panel>
                  <PhotoGallery
                    key={device._id}
                    endpoint={`${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/${device._id}/photos`}
                    photos={photos}
                    canManage={canManage}
                    inherited={{
                      photos: modelPhotos,
                      title: [vendor?.name, model?.name]
                        .filter(Boolean)
                        .join(" "),
                    }}
                    onChange={() => revalidator.revalidate()}
                  />
                </Panel>
              </>
            )}

            {/* Окружение — тот же виджет, что у заявки и карточек компании и
                пользователя, в режиме «по устройству»: цепочка расположений и
                соседи по помещению, само устройство отмечено. Внизу страницы:
                сначала — само устройство */}
            <Eyebrow
              id="environment"
              action={
                <Segmented
                  ariaLabel="Вид окружения"
                  options={ENVIRONMENT_VIEW_OPTIONS}
                  value={environmentView}
                  onChange={setEnvironmentView}
                />
              }
            >
              Окружение
            </Eyebrow>
            <Environment
              deviceId={device._id}
              from={title}
              view={environmentView}
              targetLabel="это устройство"
            />

            <div className="mt-6 border-t border-border-soft pt-3.5 text-sm text-faint">
              {device.createdBy && (
                <>
                  Завёл{" "}
                  {[device.createdBy.lastName, device.createdBy.firstName]
                    .filter(Boolean)
                    .join(" ")}
                  {device.createdAt
                    ? ` · ${formatCalendarDate(device.createdAt)}`
                    : ""}
                </>
              )}
              {device.updatedBy && (
                <>
                  {device.createdBy ? "  ·  " : ""}изменил{" "}
                  {[device.updatedBy.lastName, device.updatedBy.firstName]
                    .filter(Boolean)
                    .join(" ")}
                  {device.updatedAt
                    ? ` · ${formatCalendarDate(device.updatedAt)}`
                    : ""}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Открывается кнопкой «QR-код» в hero и кликом по инвентарной метке */}
      <QrDialog
        device={{ ...device, name: title, company: device.companyId }}
        open={qrOpen}
        onOpenChange={setQrOpen}
      />
      <AssignUserDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        device={device}
        onAssigned={() => revalidator.revalidate()}
      />
      <NewComponentDialog
        open={newComponentOpen}
        onOpenChange={setNewComponentOpen}
        host={device}
        onCreated={() => revalidator.revalidate()}
      />
      <AttachComponentDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        device={device}
        onAttached={() => revalidator.revalidate()}
      />
      <DeleteDialog
        item={{ _id: device._id, title }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
      {/* Правка — плоская форма с рейлом: шторка xl (рейл + колонка полей) */}
      <FormOutlet />
    </>
  );
};

export default ViewClientDevice;
