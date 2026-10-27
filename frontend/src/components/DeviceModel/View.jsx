import { useEffect, useState } from "react";
import { Link, useActionData, useRevalidator } from "react-router";

import {
  RiAddFill,
  RiComputerLine,
  RiCpuLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiListUnordered,
  RiMoreLine,
  RiStackLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Crumbs, { useCrumbFrom } from "@/components/app/Crumbs";
import { Eyebrow, Panel } from "@/components/app/Panel";
import PillPanel from "@/components/app/PillPanel";
import FormOutlet from "@/components/app/FormOutlet";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { cn } from "@/lib/utils";

import PhotoGallery, { photoUrl } from "@/components/app/PhotoGallery";
import SpecSheet from "@/components/app/SpecSheet";
import { buildSpecGroups, specSummary } from "@/components/app/spec-sheet";
import { formatShortDate } from "../../util/format-date";
import { plural } from "../../util/plural";
import useToastStore from "../../store/toast-store";
import { useCan } from "@/store/authed-user";

const dash = <span className="text-faint">—</span>;
// createdAt/updatedAt — инстанты: единый формат в бизнес-таймзоне.
const fmtDate = (value) => (value ? formatShortDate(value) : null);
const userName = (u) =>
  u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null;

// Строка «микро-подпись + значение» в панели «Основное».
const Detail = ({ label, children, className }) => (
  <div className={cn("min-w-0", className)}>
    <div className="mb-0.5 text-xs font-semibold tracking-wide text-faint uppercase">
      {label}
    </div>
    <div className="text-sm leading-relaxed break-words">
      {children || dash}
    </div>
  </div>
);

// «⋯» действия конфигурации. Диалог удаления рендерится ВНЕ radix-меню
// (меню размонтирует содержимое при закрытии), открывается состоянием.
const ConfigActions = ({ config, label, canDelete = true }) => {
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Действия"
            title="Действия"
            className="flex-none text-faint"
          >
            <RiMoreLine />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to={`update/${config._id}`}>
              <RiEdit2Line /> Изменить
            </Link>
          </DropdownMenuItem>
          {/* Последнюю конфигурацию не удаляют — сервер откажет */}
          {canDelete && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDeleteOpen(true)}
            >
              <RiDeleteBinLine /> Удалить
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteDialog
        item={{ _id: config._id, title: label }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
};

// Пустое состояние секции «Конфигурации» — не пустота: иконка, заголовок,
// объяснение, главное действие (гайд).
const EmptyConfigs = ({ title, hint, children, icon: Icon = RiStackLine }) => (
  <Panel>
    <div className="flex flex-col items-center gap-2 px-6 py-9 text-center">
      <Icon size={40} aria-hidden className="mb-1 text-faint" />
      <div className="text-base font-semibold">{title}</div>
      <p className="my-0 max-w-md text-sm text-muted-foreground">{hint}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  </Panel>
);

const ViewDeviceModel = ({
  deviceModel = {},
  configurations = [],
  attributes = [],
}) => {
  const revalidator = useRevalidator();
  const { showToast } = useToastStore();
  const actionData = useActionData();
  const can = useCan();
  const canManage = can({ inventoryCatalog: ["manage"] });
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Выбранная чипом конфигурация; удалённая (после revalidate) → первая.
  const [selectedId, setSelectedId] = useState(null);

  // Карточку всегда открываем от начала: иначе hero прячется под фиксированным
  // баром при переходе из проскроленного списка (Root сбрасывает лишь мобильный
  // контейнер). Ср. ServicePlan/View.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Тосты: после удаления конфигурации (action вернул { deleted }); ошибка
  // удаления модели «в использовании» (action вернул { error, message }).
  useEffect(() => {
    if (actionData?.deleted) showToast("success", "Конфигурация удалена");
    if (actionData?.error) showToast("danger", actionData.message);
  }, [actionData, showToast]);

  const photos = deviceModel.photos || [];
  const vendorName = deviceModel.vendorId?.name;
  const vendorId = deviceModel.vendorId?._id;
  const typeName = deviceModel.deviceTypeId?.name;
  const typeId = deviceModel.deviceTypeId?._id;
  const title =
    [vendorName, deviceModel.name].filter(Boolean).join(" ") || "Без названия";
  // Как модель назовётся в крошке типа или вендора
  const fromState = useCrumbFrom(title);
  const compatible = deviceModel.compatibleWithModelIds || [];
  const configCount = configurations.length;
  const devicesCount = deviceModel.devicesCount || 0;
  // Режим одной конфигурации: её характеристики — свойства модели, правятся
  // формой модели (макет «Модель без конфигураций»). Две и больше без флага
  // (модель старше миграции) — тоже варианты: иначе вторые не видно
  const multiConfig = !!deviceModel.multiConfig || configCount > 1;
  const firstConfig =
    [...configurations].sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    )[0] || null;
  const modelGroups = firstConfig
    ? buildSpecGroups(attributes, firstConfig.values || [])
    : [];

  // Связки типа (с группами) — каркас «спецификации» конфигураций.
  const noTypeAttributes = attributes.length === 0;
  // Подпись конфигурации — в чипе и в шапке панели одна и та же.
  const labelOf = (config, index) =>
    specSummary(attributes, config.values || []) || `Конфигурация ${index + 1}`;
  const selectedIndex = Math.max(
    0,
    configurations.findIndex((c) => c._id === selectedId),
  );
  const selected = configurations[selectedIndex];
  const selectedLabel = selected ? labelOf(selected, selectedIndex) : "";
  const selectedGroups = selected
    ? buildSpecGroups(attributes, selected.values || [])
    : [];

  const updaterName = userName(deviceModel.updatedBy);
  const metaBits = [
    deviceModel.updatedAt &&
      `Обновлено ${fmtDate(deviceModel.updatedAt)}${updaterName ? `, ${updaterName}` : ""}`,
    deviceModel.createdAt && `создано ${fmtDate(deviceModel.createdAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  // Счётчики статус-строки — жирные tabular, разделитель — приглушённая точка.
  const bold = (n) => <b className="font-semibold text-foreground">{n}</b>;
  const sep = <span className="text-faint">·</span>;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Crumbs />

      {/* Hero */}
      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className="grid size-14 flex-none place-items-center overflow-hidden rounded-2xl bg-accent text-2xl text-muted-foreground inset-ring inset-ring-border"
        >
          {photos[0] ? (
            <img
              src={photoUrl(photos[0])}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <RiComputerLine />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="my-0 text-2xl leading-tight font-semibold tracking-tight break-words">
            {title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/* Тип — ссылка на его карточку (навигация вверх по иерархии:
                модель принадлежит типу; так с карточки созданной модели
                можно вернуться к типу) */}
            {typeId ? (
              <Link
                to={`/inventory/device-types/${typeId}`}
                state={fromState}
                title="Открыть тип устройства"
                className="inline-flex items-center gap-2 text-sm font-semibold text-accent-text no-underline hover:underline"
              >
                <span className="size-2 rounded-full bg-primary ring-4 ring-primary/20" />
                {typeName || "Тип не указан"}
              </Link>
            ) : (
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-accent-text">
                <span className="size-2 rounded-full bg-primary ring-4 ring-primary/20" />
                Тип не указан
              </span>
            )}
            <span className="text-sm text-muted-foreground tabular-nums">
              {multiConfig && (
                <>
                  {sep} {bold(configCount)}{" "}
                  {plural(
                    configCount,
                    "конфигурация",
                    "конфигурации",
                    "конфигураций",
                  )}{" "}
                </>
              )}
              {sep} {bold(devicesCount)}{" "}
              {plural(devicesCount, "устройство", "устройства", "устройств")}
              {photos.length > 0 && (
                <>
                  {" "}
                  {sep} {bold(photos.length)} фото
                </>
              )}
              {compatible.length > 0 && (
                <>
                  {" "}
                  {sep} совместимо с {bold(compatible.length)}
                </>
              )}
            </span>
          </div>
        </div>
        {canManage && (
          <div className="flex flex-none items-center gap-2">
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
              {/* Правка — вложенный маршрут карточки: остаёмся на ней */}
              <Link to="update">
                <RiEdit2Line /> Изменить
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Основное. Производитель и тип — ссылки на их карточки (навигация
          вверх по иерархии: модель принадлежит вендору и типу) */}
      <Eyebrow>Основное</Eyebrow>
      <Panel>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Detail label="Производитель">
            {vendorId ? (
              <Link
                to={`/inventory/vendors/${vendorId}`}
                state={fromState}
                className="font-medium text-accent-text no-underline hover:underline"
              >
                {vendorName}
              </Link>
            ) : (
              vendorName
            )}
          </Detail>
          <Detail label="Тип устройства">
            {typeId ? (
              <Link
                to={`/inventory/device-types/${typeId}`}
                state={fromState}
                className="font-medium text-accent-text no-underline hover:underline"
              >
                {typeName}
              </Link>
            ) : (
              typeName
            )}
          </Detail>
        </div>
        <Detail label="Примечания" className="mt-4">
          {deviceModel.notes}
        </Detail>
      </Panel>

      {/* Совместимость — только когда заданы совместимые модели (расходники) */}
      {compatible.length > 0 && (
        <PillPanel
          label="Совместимо с моделями"
          items={compatible}
          getLabel={(model) => model.name || "Без названия"}
        />
      )}

      {/* Фотографии */}
      {(canManage || photos.length > 0) && (
        <>
          <Eyebrow count={photos.length || undefined}>Фотографии</Eyebrow>
          <Panel>
            {canManage && (
              <p className="mt-0 mb-3.5 text-sm text-muted-foreground">
                Каталожные снимки модели. Их показывают все устройства этой
                модели, у которых нет собственных фотографий.
              </p>
            )}
            <PhotoGallery
              key={deviceModel._id}
              endpoint={`${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models/${deviceModel._id}/photos`}
              photos={photos}
              canManage={canManage}
              onChange={() => revalidator.revalidate()}
            />
          </Panel>
        </>
      )}

      {/* Характеристики — режим одной конфигурации */}
      {!multiConfig && (
        <>
          <Eyebrow
            action={
              canManage &&
              !noTypeAttributes &&
              modelGroups.length > 0 && (
                <Button asChild variant="outline" size="xs">
                  <Link to="update#specs">
                    <RiEdit2Line /> Изменить
                  </Link>
                </Button>
              )
            }
          >
            Характеристики
          </Eyebrow>
          {noTypeAttributes ? (
            <EmptyConfigs
              title="У типа устройства нет характеристик"
              hint="Сначала добавьте атрибуты к типу устройства."
            >
              {canManage && typeId && (
                <Button asChild variant="outline">
                  <Link
                    to={`/inventory/device-types/${typeId}`}
                    state={fromState}
                  >
                    Открыть тип устройства
                  </Link>
                </Button>
              )}
            </EmptyConfigs>
          ) : modelGroups.length === 0 ? (
            <EmptyConfigs
              icon={RiListUnordered}
              title="Характеристики не заполнены"
              hint="Их увидят все устройства этой модели. Из них же собирается сводка ПК своей сборки."
            >
              {canManage && (
                <Button asChild size="sm">
                  <Link to="update#specs">
                    <RiEdit2Line /> Заполнить
                  </Link>
                </Button>
              )}
            </EmptyConfigs>
          ) : (
            <Panel>
              <SpecSheet groups={modelGroups} />
            </Panel>
          )}
        </>
      )}

      {/* Конфигурации — режим нескольких */}
      {multiConfig && (
        <>
          <div className="mt-6 mb-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-faint uppercase">
              Конфигурации
              {configCount > 0 && (
                <span className="font-semibold tracking-normal tabular-nums">
                  · {configCount}
                </span>
              )}
            </div>
            {canManage && !noTypeAttributes && (
              <Button asChild size="sm">
                <Link to="add">
                  <RiAddFill /> Новая конфигурация
                </Link>
              </Button>
            )}
          </div>

          {noTypeAttributes ? (
            <EmptyConfigs
              title="У типа устройства нет характеристик"
              hint="Сначала добавьте атрибуты к типу устройства, затем создавайте конфигурации."
            >
              {canManage && typeId && (
                <Button asChild variant="outline">
                  {/* Атрибуты добавляются с карточки типа — туда и ведём */}
                  <Link
                    to={`/inventory/device-types/${typeId}`}
                    state={fromState}
                  >
                    Открыть тип устройства
                  </Link>
                </Button>
              )}
            </EmptyConfigs>
          ) : configCount === 0 ? (
            <EmptyConfigs
              title="Конфигураций пока нет"
              hint="Добавьте первую — например «16 ГБ / 512 ГБ»."
            >
              {canManage && (
                <Button asChild>
                  <Link to="add">
                    <RiAddFill /> Новая конфигурация
                  </Link>
                </Button>
              )}
            </EmptyConfigs>
          ) : (
            <>
              {/* Переключатель конфигураций: чипы, первая выбрана; при одной —
              без чипов */}
              {configCount > 1 && (
                <div
                  role="group"
                  aria-label="Конфигурации"
                  className="mb-2.5 flex flex-wrap gap-1.5"
                >
                  {configurations.map((config, index) => {
                    const pressed = index === selectedIndex;
                    return (
                      <button
                        key={config._id}
                        type="button"
                        aria-pressed={pressed}
                        onClick={() => setSelectedId(config._id)}
                        className={cn(
                          "inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.25 text-sm font-medium text-muted-foreground tabular-nums transition-colors outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50",
                          pressed &&
                            "border-primary text-foreground inset-ring inset-ring-primary",
                        )}
                      >
                        <span className="truncate">
                          {labelOf(config, index)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <Panel>
                {/* Шапка выбранной конфигурации — до краёв панели */}
                <div className="-mx-4 -mt-4 mb-4 flex items-center gap-2.5 border-b border-border-soft px-4 py-3 md:-mx-5 md:-mt-5 md:mb-5">
                  <RiCpuLine
                    aria-hidden
                    className="size-4 flex-none text-accent-text"
                  />
                  <div className="min-w-0 flex-1 text-sm font-semibold break-words tabular-nums">
                    {selectedLabel}
                  </div>
                  {canManage && (
                    <ConfigActions
                      key={selected._id}
                      config={selected}
                      label={selectedLabel}
                      canDelete={configCount > 1}
                    />
                  )}
                </div>
                {selectedGroups.length === 0 ? (
                  <p className="my-0 text-sm text-muted-foreground">
                    Без характеристик
                  </p>
                ) : (
                  <SpecSheet groups={selectedGroups} />
                )}
              </Panel>
            </>
          )}
        </>
      )}

      {/* Мета-подвал: создано/обновлено (бывшая панель «Служебное») */}
      {metaBits && (
        <div className="mt-6 border-t border-border-soft pt-3.5 text-xs text-faint tabular-nums">
          {metaBits}
        </div>
      )}

      {/* Удаление модели (из «⋯» героя) — вне radix-меню, по состоянию */}
      <DeleteDialog
        item={{ _id: deviceModel._id, title }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        customDeleteMessage="Модель и её конфигурации будут удалены. Модель, привязанную к устройствам, удалить не дадут."
      />

      {/* Формы конфигураций (add / update) — нижняя шторка прямо на карточке */}
      <FormOutlet />
    </div>
  );
};

export default ViewDeviceModel;
