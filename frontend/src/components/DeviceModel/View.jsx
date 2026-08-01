import { useContext, useEffect, useState } from "react";
import {
  Link,
  Outlet,
  useActionData,
  useNavigate,
  useRevalidator,
} from "react-router";

import {
  RiAddFill,
  RiArrowLeftSLine,
  RiComputerLine,
  RiCpuLine,
  RiDeleteBinLine,
  RiEdit2Line,
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
import { Eyebrow, Panel } from "@/components/app/Panel";
import PillPanel from "@/components/app/PillPanel";
import FormSheet from "@/components/app/FormSheet";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { cn } from "@/lib/utils";

import PhotoGallery, { photoUrl } from "@/components/app/PhotoGallery";
import { formatShortDate } from "../../util/format-date";
import { plural } from "../../util/plural";
import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import { AuthedUserContext } from "../../store/authed-user-context";

const dash = <span className="text-faint">—</span>;
// createdAt/updatedAt — инстанты: единый формат в бизнес-таймзоне.
const fmtDate = (value) => (value ? formatShortDate(value) : null);
const userName = (u) =>
  u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null;

// Человекочитаемое значение атрибута по его типу.
const formatAttrValue = (meta, value) => {
  if (value === undefined || value === null || value === "") return null;
  if (!meta) return String(value);
  switch (meta.valueType) {
    case "boolean":
      return value === true || value === "true" ? "Да" : "Нет";
    case "select":
      return (
        meta.options?.find((o) => o.value === value)?.label || String(value)
      );
    default:
      return String(value);
  }
};

// Строка «микро-подпись + значение» в панели «Основное».
const Detail = ({ label, children, className }) => (
  <div className={cn("min-w-0", className)}>
    <div className="mb-0.5 text-xs font-semibold tracking-wide text-faint uppercase">
      {label}
    </div>
    <div className="text-[15px] leading-relaxed break-words">
      {children || dash}
    </div>
  </div>
);

// «⋯» действия конфигурации. Диалог удаления рендерится ВНЕ radix-меню
// (меню размонтирует содержимое при закрытии), открывается состоянием.
const ConfigActions = ({ config, label }) => {
  const offcanvas = useOffcanvasStore();
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Действия"
            title="Действия"
            className="flex-none text-faint"
          >
            <RiMoreLine />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to={`update/${config._id}`} onClick={offcanvas.setShow}>
              <RiEdit2Line /> Изменить
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <RiDeleteBinLine /> Удалить
          </DropdownMenuItem>
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
const EmptyConfigs = ({ title, hint, children }) => (
  <Panel>
    <div className="flex flex-col items-center gap-2 px-6 py-9 text-center">
      <RiStackLine size={40} aria-hidden className="mb-1 text-faint" />
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
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const offcanvas = useOffcanvasStore();
  const { showToast } = useToastStore();
  const actionData = useActionData();
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageClientDevices;
  const [deleteOpen, setDeleteOpen] = useState(false);

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
  const compatible = deviceModel.compatibleWithModelIds || [];
  const configCount = configurations.length;

  // Атрибуты типа в заданном порядке — канонический каркас «спецификации».
  const orderedAttributes = [...attributes].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const noTypeAttributes = orderedAttributes.length === 0;

  // Строки одной конфигурации: значения по порядку атрибутов типа + legacy-хвост.
  const buildRows = (config) => {
    const byAttr = new Map(
      (config.values || []).map((v) => [
        typeof v.attributeId === "object" ? v.attributeId._id : v.attributeId,
        v,
      ]),
    );
    const rows = [];
    const seen = new Set();

    orderedAttributes.forEach((a) => {
      const meta = typeof a.attributeId === "object" ? a.attributeId : null;
      const attrId = meta?._id || a.attributeId;
      const entry = byAttr.get(attrId);
      if (!entry) return;
      const text = formatAttrValue(meta, entry.value);
      if (text === null) return;
      seen.add(attrId);
      rows.push({
        id: attrId,
        name: meta?.name || "Атрибут",
        unit: meta?.unit,
        value: text,
      });
    });

    (config.values || []).forEach((v) => {
      const meta = typeof v.attributeId === "object" ? v.attributeId : null;
      const attrId = meta?._id || v.attributeId;
      if (seen.has(attrId)) return;
      const text = formatAttrValue(meta, v.value);
      if (text === null) return;
      rows.push({ id: attrId, name: meta?.name || "Атрибут", value: text });
    });

    return rows;
  };

  const summaryOf = (rows) =>
    rows
      .slice(0, 3)
      .map((r) => (r.unit ? `${r.value} ${r.unit}` : r.value))
      .join(" / ");

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
      {/* Хлебные крошки — возврат к списку (не кнопкой в действиях) */}
      <Link
        to="/inventory/device-models"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground"
      >
        <RiArrowLeftSLine /> Модели устройств
      </Link>

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
          <h1 className="my-0 text-3xl leading-tight font-semibold tracking-tight break-words">
            {title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/* Тип — ссылка на его карточку (навигация вверх по иерархии:
                модель принадлежит типу; так с карточки созданной модели
                можно вернуться к типу) */}
            {typeId ? (
              <Link
                to={`/inventory/device-types/${typeId}`}
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
              {sep} {bold(configCount)}{" "}
              {plural(
                configCount,
                "конфигурация",
                "конфигурации",
                "конфигураций",
              )}
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
              <Link to="update" onClick={offcanvas.setShow}>
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

      {/* Конфигурации */}
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
            <Link to="add" onClick={offcanvas.setShow}>
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
              <Link to={`/inventory/device-types/${typeId}`}>
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
              <Link to="add" onClick={offcanvas.setShow}>
                <RiAddFill /> Новая конфигурация
              </Link>
            </Button>
          )}
        </EmptyConfigs>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2">
          {configurations.map((config, index) => {
            const rows = buildRows(config);
            const label = summaryOf(rows) || `Конфигурация ${index + 1}`;
            return (
              <section
                key={config._id}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="flex items-center justify-between gap-2 border-b border-border-soft px-4 py-2.5">
                  <span className="inline-flex min-w-0 items-center gap-2 text-[15px] font-semibold">
                    <RiCpuLine className="flex-none text-accent-text" />
                    <span className="truncate">{label}</span>
                  </span>
                  {canManage && <ConfigActions config={config} label={label} />}
                </div>
                <div className="px-4 py-1">
                  {rows.length === 0 ? (
                    <div className="py-2 text-sm text-muted-foreground">
                      Без характеристик
                    </div>
                  ) : (
                    rows.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-4 border-b border-border-soft py-2 text-sm last:border-b-0"
                      >
                        <span className="text-muted-foreground">
                          {r.name}
                          {r.unit ? `, ${r.unit}` : ""}
                        </span>
                        <span className="ms-auto text-right font-mono font-semibold tabular-nums">
                          {r.value}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
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
      <FormSheet
        open={offcanvas.isActive}
        onOpenChange={(open) => {
          if (!open) {
            navigate(-1);
            offcanvas.setClose();
          }
        }}
      >
        <Outlet />
      </FormSheet>
    </div>
  );
};

export default ViewDeviceModel;
