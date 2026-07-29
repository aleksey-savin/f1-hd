import { useContext, useEffect, useState } from "react";
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

import { AuthedUserContext } from "../../store/authed-user-context";
import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import { formatCalendarDate } from "../../util/format-date";
import { plural } from "../../util/plural";

const dash = <span className="tw:text-faint">—</span>;

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
    <div className="tw:border-t tw:border-border-soft tw:py-3 tw:first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-3.5 tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-foreground"
      >
        <span
          aria-hidden
          className="tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-accent tw:text-muted-foreground"
        >
          <RiShoppingCart2Line size={17} />
        </span>
        <span className="tw:min-w-0 tw:flex-1">
          <span className="tw:block tw:truncate tw:font-medium">
            {delivery.document || "Без документа"}
          </span>
          <span className="tw:block tw:truncate tw:text-sm tw:text-muted-foreground">
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
        <span className="tw:flex-none tw:font-semibold tw:tabular-nums">
          {money(delivery.total) || dash}
        </span>
        <RiArrowRightSLine
          aria-hidden
          className={cn(
            "tw:flex-none tw:text-faint tw:transition-transform",
            open && "tw:rotate-90",
          )}
        />
      </button>

      {open && (
        <div className="tw:mt-2.5 tw:ml-12 tw:border-l tw:border-border-soft tw:pl-3.5">
          {delivery.positions.map((position) => {
            const state = warranty(position.warrantyExpirationDate);
            return (
              <Link
                key={position._id}
                to={`/inventory/client-devices/${position._id}`}
                className="tw:flex tw:items-center tw:gap-2.5 tw:py-1.5 tw:text-sm tw:text-foreground tw:no-underline tw:hover:text-accent-text"
              >
                <span
                  className={cn(
                    "tw:flex-none tw:rounded-md tw:border tw:px-1.5 tw:font-mono tw:text-xs",
                    position.inventoryNumber
                      ? "tw:border-border-soft tw:bg-accent tw:font-semibold"
                      : "tw:border-border tw:text-faint",
                  )}
                >
                  {position.inventoryNumber || "нет №"}
                </span>
                <span className="tw:min-w-0 tw:flex-1 tw:truncate">
                  {[position.vendorName, position.name]
                    .filter(Boolean)
                    .join(" ")}
                  {position.isComponent && (
                    <span className="tw:text-faint"> · комплектующее</span>
                  )}
                </span>
                {position.price != null && (
                  <span className="tw:hidden tw:flex-none tw:tabular-nums tw:text-muted-foreground tw:sm:block">
                    {money(position.price)}
                  </span>
                )}
                <span className="tw:hidden tw:w-56 tw:flex-none tw:md:block">
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
  const { permissions } = useContext(AuthedUserContext);
  const { showToast } = useToastStore();
  const actionData = useActionData();
  const canManage = Boolean(permissions.canManageClientDevices);
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
        <span className="tw:font-mono">
          {[supplier.inn, supplier.kpp].filter(Boolean).join(" · ")}
        </span>
      ),
    },
    supplier.notes && {
      icon: <RiFileList2Line size={17} />,
      label: "Заметки",
      value: (
        <span className="tw:font-normal tw:whitespace-pre-line">
          {supplier.notes}
        </span>
      ),
    },
  ].filter(Boolean);

  return (
    <div className="tw:mx-auto tw:w-full tw:max-w-4xl">
      <Link
        to="/inventory/suppliers"
        className="tw:mb-4 tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:font-medium tw:text-muted-foreground tw:no-underline tw:hover:text-foreground"
      >
        <RiArrowLeftSLine /> Поставщики
      </Link>

      <div className="tw:flex tw:flex-wrap tw:items-start tw:gap-4">
        <span
          aria-hidden
          className="tw:grid tw:size-14 tw:flex-none tw:place-items-center tw:rounded-2xl tw:bg-accent tw:text-xl tw:font-semibold tw:text-muted-foreground tw:inset-ring tw:inset-ring-border"
        >
          {monogramFor(supplier.name || "")}
        </span>
        <div className="tw:min-w-0 tw:flex-1">
          <h1 className="tw:my-0 tw:text-3xl tw:leading-tight tw:font-semibold tw:tracking-tight">
            {supplier.name}
          </h1>
          <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-1.5">
            <DeviceStatusText
              tone={supplier.isActive ? "ok" : "off"}
              className="tw:text-sm"
            >
              {supplier.isActive ? "Активен" : "Отключён"}
            </DeviceStatusText>
            {supplier.deviceCount > 0 ? (
              <span className="tw:text-sm tw:text-muted-foreground">
                <b className="tw:font-semibold tw:text-foreground tw:tabular-nums">
                  {supplier.deviceCount}
                </b>{" "}
                {plural(
                  supplier.deviceCount,
                  "устройство",
                  "устройства",
                  "устройств",
                )}{" "}
                <span className="tw:text-faint">·</span>{" "}
                <b className="tw:font-semibold tw:text-foreground tw:tabular-nums">
                  {money(supplier.totalSpent)}
                </b>
                {supplier.lastPurchaseAt && (
                  <>
                    {" "}
                    <span className="tw:text-faint">·</span> последняя поставка{" "}
                    {formatCalendarDate(supplier.lastPurchaseAt)}
                  </>
                )}
              </span>
            ) : (
              <span className="tw:text-sm tw:text-faint">закупок нет</span>
            )}
          </div>
        </div>

        {canManage && (
          <div className="tw:flex tw:flex-none tw:items-center tw:gap-2">
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
            <p className="tw:my-1 tw:text-sm tw:text-muted-foreground">
              Контакты не заполнены. Телефон и почта нужны, когда наступит
              гарантийный случай.
            </p>
          )}
        </Panel>
      </Section>

      <Eyebrow count={deliveries.length || undefined}>Поставки</Eyebrow>
      <Panel>
        {deliveries.length === 0 ? (
          <p className="tw:my-1 tw:text-sm tw:text-muted-foreground">
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
