import { useEffect, useMemo, useState } from "react";
import { Link, useRevalidator } from "react-router";
import UserLink from "@/components/app/UserLink";
import { BrowserView } from "react-device-detect";
import {
  RiAddLine,
  RiArrowRightSLine,
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
  Eyebrow,
  Panel,
  Section,
  SectionEditLink,
} from "@/components/app/Panel";
import PropRow from "@/components/app/PropRow";
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
import AssignUserDialog from "./AssignUserDialog";
import AttachComponentDialog from "./AttachComponentDialog";
import MonitoringPanel from "./MonitoringPanel";
import NewComponentDialog from "./NewComponentDialog";
import QrDialog from "./QrDialog";
import TicketsPanel from "./TicketsPanel";
import { useCan } from "@/store/authed-user";

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

// Пара «подпись — значение» в две колонки (характеристики конфигурации).
const SpecRow = ({ label, children }) => (
  <div className="flex items-baseline gap-3 border-t border-border-soft py-2 first:border-t-0 md:[&:nth-child(2)]:border-t-0">
    <span className="w-44 flex-none text-sm text-muted-foreground">
      {label}
    </span>
    <span className="min-w-0 flex-1 font-medium">{children}</span>
  </div>
);

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

  const model = device.deviceModelId;
  const type = model?.deviceTypeId || device.deviceTypeId;
  const vendor = model?.vendorId;
  const isCustom = !model;
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
  const specs = (configuration?.values || []).filter((entry) => entry.value);

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
  // вход в подключение).
  const showMonitoring =
    Boolean(device.mikrotik) || Boolean(vendor?.isMikrotikManagementEnabled);

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

  // Рейл собирается только из реально отрисованных секций.
  const railSections = useMemo(
    () =>
      [
        { id: "placement", label: "Размещение" },
        { id: "environment", label: "Окружение" },
        { id: "identity", label: "Идентификация" },
        specs.length ? { id: "specs", label: "Характеристики" } : null,
        { id: "tech", label: "Сеть и система" },
        components.length || canManage
          ? { id: "components", label: "Состав сборки" }
          : null,
        { id: "purchase", label: "Закупка и гарантия" },
        showMonitoring ? { id: "monitoring", label: "Мониторинг" } : null,
        hasTickets ? { id: "tickets", label: "Заявки" } : null,
        effectivePhotos.length || canManage
          ? { id: "photos", label: "Фотографии" }
          : null,
      ].filter(Boolean),
    [
      specs.length,
      components.length,
      canManage,
      showMonitoring,
      hasTickets,
      effectivePhotos.length,
    ],
  );

  const TypeIcon = deviceIcon(type?.name);
  const heroPhoto = effectivePhotos[0] ? photoUrl(effectivePhotos[0]) : null;

  return (
    <>
      <div className="mx-auto w-full max-w-5xl">
        <Crumbs />

        {/* Hero */}
        <div className="flex flex-wrap items-start gap-4">
          <span
            aria-hidden
            className="grid size-14 flex-none place-items-center overflow-hidden rounded-2xl bg-accent text-2xl text-muted-foreground inset-ring inset-ring-border bg-cover bg-center"
            style={
              heroPhoto ? { backgroundImage: `url(${heroPhoto})` } : undefined
            }
          >
            {!heroPhoto && <TypeIcon />}
          </span>

          <div className="min-w-0 flex-1">
            <h1 className="my-0 text-2xl leading-tight font-semibold tracking-tight">
              {title}
            </h1>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-sm text-muted-foreground">
                {isCustom
                  ? [type?.name, "собственная сборка"]
                      .filter(Boolean)
                      .join(" · ")
                  : [type?.name, vendor?.name].filter(Boolean).join(" · ")}
              </span>
              {/* Метка — тот же вход в QR, что в строке списка */}
              <button
                type="button"
                onClick={() => setQrOpen(true)}
                title="Показать QR-код"
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs font-semibold tracking-wide transition-colors",
                  device.inventoryNumber
                    ? "border-border-soft bg-accent text-foreground hover:border-input"
                    : "bg-transparent font-sans font-normal text-faint",
                )}
                style={
                  device.inventoryNumber
                    ? undefined
                    : { border: "1px dashed var(--border)" }
                }
              >
                {device.inventoryNumber || "нет №"}
                <RiQrCodeLine size={11} aria-hidden className="opacity-55" />
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
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

            {/* Комплектующее: путь наверх — в списке устройств его нет */}
            {parent && (
              <Link
                to={`/inventory/client-devices/${parent._id}`}
                className="mt-2.5 inline-flex items-center gap-2 rounded-lg bg-accent px-2.5 py-1.5 text-sm text-muted-foreground no-underline hover:text-foreground"
              >
                <RiStackLine size={15} aria-hidden />В составе:{" "}
                <span className="font-medium text-accent-text">
                  {[
                    parent.deviceModelId?.name || parent.deviceTypeId?.name,
                    parent.inventoryNumber,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <RiArrowRightSLine size={15} aria-hidden />
              </Link>
            )}
          </div>

          <div className="flex flex-none items-center gap-2">
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
                <Button asChild>
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

            {/* Окружение — тот же виджет, что у заявки и карточек компании и
                пользователя, в режиме «по устройству»: цепочка расположений и
                соседи по помещению, само устройство обведено */}
            <Eyebrow id="environment">Окружение</Eyebrow>
            <Environment deviceId={device._id} from={title} />

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

            {specs.length > 0 && (
              <>
                <Eyebrow id="specs">
                  Характеристики
                  {configuration?.name ? ` · ${configuration.name}` : ""}
                </Eyebrow>
                <Panel>
                  <div className="grid gap-x-8 md:grid-cols-2">
                    {specs.map((entry) => (
                      <SpecRow
                        key={entry.attributeId?._id || entry.attributeId?.code}
                        label={
                          entry.attributeId?.name ||
                          entry.attributeId?.code ||
                          "Свойство"
                        }
                      >
                        {entry.value}
                        {entry.attributeId?.unit
                          ? ` ${entry.attributeId.unit}`
                          : ""}
                      </SpecRow>
                    ))}
                  </div>
                </Panel>
              </>
            )}

            <Section>
              <Eyebrow
                id="tech"
                action={
                  canManage && (
                    <SectionEditLink
                      to="update#tech"
                      label="Сеть и система"
                     
                    />
                  )
                }
              >
                Сеть и система
              </Eyebrow>
              <Panel>
                <PropRow
                  icon={<RiTerminalBoxLine size={17} />}
                  label="Имя в сети"
                >
                  {device.hostname ? (
                    <span className="font-mono">{device.hostname}</span>
                  ) : (
                    dash
                  )}
                </PropRow>
                <PropRow
                  icon={<RiGlobalLine size={17} />}
                  label="IP-адрес"
                  copy={
                    device.ipAddress
                      ? { value: device.ipAddress, label: "IP-адрес" }
                      : undefined
                  }
                >
                  {device.ipAddress ? (
                    <span className="font-mono">{device.ipAddress}</span>
                  ) : (
                    dash
                  )}
                </PropRow>
                <PropRow icon={<RiGlobalLine size={17} />} label="MAC-адрес">
                  {device.macAddress ? (
                    <span className="font-mono">{device.macAddress}</span>
                  ) : (
                    dash
                  )}
                </PropRow>
                <PropRow
                  icon={<RiCpuLine size={17} />}
                  label="Операционная система"
                >
                  {device.operatingSystem || dash}
                </PropRow>
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
                {device.notes && (
                  <PropRow icon={<RiFileList2Line size={17} />} label="Заметки">
                    <span className="font-normal whitespace-pre-line">
                      {device.notes}
                    </span>
                  </PropRow>
                )}
              </Panel>
            </Section>

            {(components.length > 0 || canManage) && (
              <>
                <Eyebrow
                  id="components"
                  count={components.length}
                  action={
                    canManage && (
                      <>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setNewComponentOpen(true)}
                        >
                          <RiAddLine /> Новая
                        </Button>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setAttachOpen(true)}
                        >
                          <RiLinksLine /> Прикрепить
                        </Button>
                      </>
                    )
                  }
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
                    components.map((component) => {
                      const componentType =
                        component.deviceModelId?.deviceTypeId?.name ||
                        component.deviceTypeId?.name;
                      const ComponentIcon = deviceIcon(componentType);
                      const componentWarranty = warrantyState(
                        component.warrantyExpirationDate,
                      );
                      const name =
                        [
                          component.deviceModelId?.vendorId?.name,
                          component.deviceModelId?.name,
                        ]
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
                                  component.serialNumber
                                    ? `SN ${component.serialNumber}`
                                    : null,
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
                              <span className="text-faint">
                                Гарантия не указана
                              </span>
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
                    })
                  )}
                </Panel>
              </>
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
