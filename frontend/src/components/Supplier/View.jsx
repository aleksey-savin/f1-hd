import { useEffect, useState } from "react";
import { Link, Outlet, useActionData, useNavigate } from "react-router";
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiFileList2Line,
  RiGlobalLine,
  RiMailLine,
  RiMapPin2Line,
  RiMoreLine,
  RiPhoneLine,
  RiShoppingCart2Line,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteDialog } from "@/components/app/DeleteItem";
import FormSheet from "@/components/app/FormSheet";
import {
  Eyebrow,
  Panel,
  Section,
  SectionEditLink,
} from "@/components/app/Panel";
import PropRow from "@/components/app/PropRow";
import { DeviceStatusText } from "@/components/app/device-status";
import { monogramFor } from "@/components/app/monogram";
import { cn } from "@/lib/utils";

import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import { formatCalendarDate } from "../../util/format-date";
import { plural } from "../../util/plural";
import { useCan } from "@/store/authed-user";

const dash = <span className="text-faint">—</span>;

const money = (value) =>
  value || value === 0 ? `${Number(value).toLocaleString("ru-RU")} ₽` : null;

// Гарантия позиции — фраза с состоянием, как на карточке устройства.
const warranty = (value) => {
  if (!value) return { tone: "off", text: "гарантия не указана" };
  const days = Math.ceil((new Date(value) - new Date()) / 86400000);
  const date = formatCalendarDate(value);
  if (days < 0) return { tone: "off", text: `гарантия истекла ${date}` };
  if (days <= 30)
    return {
      tone: "warn",
      text: `гарантия истекает через ${days} ${plural(days, "день", "дня", "дней")}`,
    };
  return { tone: "ok", text: `гарантия до ${date}` };
};

// Поставка — одна накладная: заголовок с суммой, внутри позиции. Раскрытие по
// клику: обычно нужен сам факт поставки, а состав — по требованию.
const Delivery = ({ delivery, defaultOpen }) => {
  const [open, setOpen] = useState(defaultOpen);
  const count = delivery.positions.length;

  return (
    <div className="border-t border-border-soft py-3 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="flex w-full cursor-pointer appearance-none items-center gap-3.5 border-0 bg-transparent p-0 text-left text-foreground"
      >
        <span
          aria-hidden
          className="grid size-9 flex-none place-items-center rounded-lg bg-accent text-muted-foreground"
        >
          <RiShoppingCart2Line size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {delivery.document || "Без документа"}
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {[
              delivery.purchasedAt
                ? formatCalendarDate(delivery.purchasedAt)
                : null,
              `${count} ${plural(count, "позиция", "позиции", "позиций")}`,
              delivery.company,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <span className="flex-none font-semibold tabular-nums">
          {money(delivery.total) || dash}
        </span>
        <RiArrowRightSLine
          aria-hidden
          className={cn(
            "flex-none text-faint transition-transform",
            open && "rotate-90",
          )}
        />
      </button>

      {open && (
        <div className="mt-2.5 ml-12 border-l border-border-soft pl-3.5">
          {delivery.positions.map((position) => {
            const state = warranty(position.warrantyExpirationDate);
            return (
              <Link
                key={position._id}
                to={`/inventory/client-devices/${position._id}`}
                className="flex items-center gap-2.5 py-1.5 text-sm text-foreground no-underline hover:text-accent-text"
              >
                <span
                  className={cn(
                    "flex-none rounded-md border px-1.5 font-mono text-xs",
                    position.inventoryNumber
                      ? "border-border-soft bg-accent font-semibold"
                      : "border-border text-faint",
                  )}
                >
                  {position.inventoryNumber || "нет №"}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {[position.vendorName, position.name]
                    .filter(Boolean)
                    .join(" ")}
                  {position.isComponent && (
                    <span className="text-faint"> · комплектующее</span>
                  )}
                </span>
                {position.price != null && (
                  <span className="hidden flex-none tabular-nums text-muted-foreground sm:block">
                    {money(position.price)}
                  </span>
                )}
                <span className="hidden w-56 flex-none md:block">
                  <DeviceStatusText tone={state.tone}>
                    {state.text}
                  </DeviceStatusText>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * Карточка поставщика: контакты (нужны, когда наступает гарантийный случай) и
 * поставки, сгруппированные по документу. Плоского списка железа здесь нет
 * намеренно — к поставщику вопрос «что и на сколько мы у него купили», а не
 * «что это за устройство».
 */
const ViewSupplier = ({ supplier = {} }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const can = useCan();
  const { showToast } = useToastStore();
  const actionData = useActionData();
  const canManage = Boolean(can({ supplier: ["manage"] }));
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Тост: удаление отклонено — за поставщиком числятся закупки.
  useEffect(() => {
    if (actionData?.error) showToast("danger", actionData.message);
  }, [actionData, showToast]);

  const deliveries = supplier.deliveries || [];
  const contacts = [
    supplier.phone && {
      icon: <RiPhoneLine size={17} />,
      label: "Телефон",
      value: supplier.phone,
      copy: { value: supplier.phone, label: "Телефон" },
    },
    (supplier.email || supplier.website) && {
      icon: <RiMailLine size={17} />,
      label: "Почта · сайт",
      value: [supplier.email, supplier.website].filter(Boolean).join(" · "),
    },
    supplier.address && {
      icon: <RiMapPin2Line size={17} />,
      label: "Адрес",
      value: supplier.address,
    },
    (supplier.inn || supplier.kpp) && {
      icon: <RiGlobalLine size={17} />,
      label: "ИНН · КПП",
      value: (
        <span className="font-mono">
          {[supplier.inn, supplier.kpp].filter(Boolean).join(" · ")}
        </span>
      ),
    },
    supplier.notes && {
      icon: <RiFileList2Line size={17} />,
      label: "Заметки",
      value: (
        <span className="font-normal whitespace-pre-line">
          {supplier.notes}
        </span>
      ),
    },
  ].filter(Boolean);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Link
        to="/inventory/suppliers"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground"
      >
        <RiArrowLeftSLine /> Поставщики
      </Link>

      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className="grid size-14 flex-none place-items-center rounded-2xl bg-accent text-xl font-semibold text-muted-foreground inset-ring inset-ring-border"
        >
          {monogramFor(supplier.name || "")}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="my-0 text-3xl leading-tight font-semibold tracking-tight">
            {supplier.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <DeviceStatusText
              tone={supplier.isActive ? "ok" : "off"}
              className="text-sm"
            >
              {supplier.isActive ? "Активен" : "Отключён"}
            </DeviceStatusText>
            {supplier.deviceCount > 0 ? (
              <span className="text-sm text-muted-foreground">
                <b className="font-semibold text-foreground tabular-nums">
                  {supplier.deviceCount}
                </b>{" "}
                {plural(
                  supplier.deviceCount,
                  "устройство",
                  "устройства",
                  "устройств",
                )}{" "}
                <span className="text-faint">·</span>{" "}
                <b className="font-semibold text-foreground tabular-nums">
                  {money(supplier.totalSpent)}
                </b>
                {supplier.lastPurchaseAt && (
                  <>
                    {" "}
                    <span className="text-faint">·</span> последняя поставка{" "}
                    {formatCalendarDate(supplier.lastPurchaseAt)}
                  </>
                )}
              </span>
            ) : (
              <span className="text-sm text-faint">закупок нет</span>
            )}
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
              <Link to="update" onClick={offcanvas.setShow}>
                <RiEdit2Line /> Изменить
              </Link>
            </Button>
          </div>
        )}
      </div>

      <Section>
        <Eyebrow
          action={
            canManage && (
              <SectionEditLink
                to="update"
                label="Контакты"
                onClick={offcanvas.setShow}
              />
            )
          }
        >
          Контакты
        </Eyebrow>
        <Panel>
          {contacts.length > 0 ? (
            contacts.map((contact) => (
              <PropRow
                key={contact.label}
                icon={contact.icon}
                label={contact.label}
                copy={contact.copy}
              >
                {contact.value}
              </PropRow>
            ))
          ) : (
            <p className="my-1 text-sm text-muted-foreground">
              Контакты не заполнены. Телефон и почта нужны, когда наступит
              гарантийный случай.
            </p>
          )}
        </Panel>
      </Section>

      <Eyebrow count={deliveries.length || undefined}>Поставки</Eyebrow>
      <Panel>
        {deliveries.length === 0 ? (
          <p className="my-1 text-sm text-muted-foreground">
            Закупок нет. Поставка появится здесь, когда у устройства укажут
            этого поставщика.
          </p>
        ) : (
          deliveries.map((delivery, index) => (
            <Delivery
              key={delivery.document || `no-doc-${index}`}
              delivery={delivery}
              defaultOpen={index === 0}
            />
          ))
        )}
      </Panel>

      <DeleteDialog
        item={{ _id: supplier._id, title: supplier.name }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />

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

export default ViewSupplier;
