import { useContext, useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router";
import {
  RiArrowLeftSLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiFileList2Line,
  RiMoreLine,
  RiTimeLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FormSheet from "@/components/app/FormSheet";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { Eyebrow, Panel } from "@/components/app/Panel";
import PillPanel from "@/components/app/PillPanel";

import useOffcanvasStore from "../../store/offcanvas";
import { AuthedUserContext } from "../../store/authed-user-context";
import { formatPrice } from "../../util/format-string";
import { plural } from "../../util/plural";
import { tariffTypeName } from "./tariff-types";

// Пн–Вс в порядке недели; ключи — как в customProvisionSchedule
const WEEK = [
  ["Пн", "Monday"],
  ["Вт", "Tuesday"],
  ["Ср", "Wednesday"],
  ["Чт", "Thursday"],
  ["Пт", "Friday"],
  ["Сб", "Saturday"],
  ["Вс", "Sunday"],
];

const money = (value) => formatPrice(Math.round(Number(value) || 0));

const fmtDate = (value) => new Date(value).toLocaleDateString("ru-RU");

// Имя автора (populate createdBy/updatedBy на getOne) — «Фамилия Имя»
const personName = (person) =>
  person && (person.firstName || person.lastName)
    ? `${person.lastName || ""} ${person.firstName || ""}`.trim()
    : null;

const ViewServicePlan = ({ servicePlan }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageServicePlans;
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Десктоп не сбрасывает window-скролл при навигации (Root сбрасывает лишь
  // мобильный контейнер), а делать это глобально по pathname нельзя — сломает
  // фон при открытии шторок-форм. Карточку всегда открываем от начала, иначе
  // hero прячется под фиксированным баром при переходе из проскроленного списка.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const {
    title,
    type = "",
    hourPackages = [],
    fixedPrice = 0,
    pricePerHour = 0,
    pricePerHourNonWorking = 0,
    packagesNonWorkingCalcMethod = "",
    packagesNonWorkingCoefficient = 1,
    tariffingPeriod = 0,
    companyWorkSchedule,
    customProvisionSchedule,
    ticketCategories = [],
    companies = [],
    createdAt,
    updatedAt,
    updatedBy,
  } = servicePlan;

  const updaterName = personName(updatedBy);
  const metaBits = [
    updatedAt &&
      `Обновлено ${fmtDate(updatedAt)}${updaterName ? `, ${updaterName}` : ""}`,
    createdAt && `создано ${fmtDate(createdAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const companyCount = companies?.length || 0;
  const categoryCount = ticketCategories?.length || 0;

  // Нерабочее время: единая подпись (согласовано) — цена ₽/ч либо коэффициент
  const nonWorking =
    type === "hourPackage" && packagesNonWorkingCalcMethod === "coefficient" ? (
      <>
        Нерабочее время: коэффициент{" "}
        <b className="tw:font-semibold tw:text-foreground tw:tabular-nums">
          ×{packagesNonWorkingCoefficient}
        </b>
      </>
    ) : (
      <>
        Нерабочее время:{" "}
        <b className="tw:font-semibold tw:text-foreground tw:tabular-nums">
          {money(pricePerHourNonWorking)}/ч
        </b>
      </>
    );

  const periodLabel = (
    <div className="tw:text-sm tw:text-muted-foreground">
      Период тарификации{" "}
      <b className="tw:font-semibold tw:text-foreground tw:tabular-nums">
        {tariffingPeriod} мин
      </b>
    </div>
  );

  const nonWorkingRow = (
    // border-dashed в tailwind ставит стиль всем сторонам; без preflight
    // остальные стороны получают дефолтную ширину и рисуется лишний бокс —
    // разделитель задаём только сверху, инлайном
    <div
      className="tw:mt-3 tw:flex tw:items-center tw:gap-2 tw:pt-3 tw:text-sm tw:text-muted-foreground"
      style={{ borderTop: "1px dashed var(--border)" }}
    >
      <RiTimeLine className="tw:text-faint" />
      <span>{nonWorking}</span>
    </div>
  );

  return (
    <div className="tw:mx-auto tw:w-full tw:max-w-4xl">
      {/* Хлебные крошки — возврат к списку (не кнопкой в действиях) */}
      <Link
        to="/finances/service-plans"
        className="tw:mb-4 tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:font-medium tw:text-muted-foreground tw:no-underline tw:hover:text-foreground"
      >
        <RiArrowLeftSLine /> Услуги
      </Link>

      {/* Hero */}
      <div className="tw:flex tw:flex-wrap tw:items-start tw:gap-4">
        <span
          aria-hidden
          className="tw:grid tw:size-14 tw:flex-none tw:place-items-center tw:rounded-2xl tw:bg-accent tw:text-2xl tw:text-muted-foreground tw:inset-ring tw:inset-ring-border"
        >
          <RiFileList2Line />
        </span>
        <div className="tw:min-w-0 tw:flex-1">
          <h1 className="tw:my-0 tw:text-3xl tw:leading-tight tw:font-semibold tw:tracking-tight">
            {title}
          </h1>
          <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1.5">
            <span className="tw:inline-flex tw:items-center tw:gap-2 tw:text-sm tw:font-semibold tw:text-accent-text">
              <span className="tw:size-2 tw:rounded-full tw:bg-primary tw:ring-4 tw:ring-primary/20" />
              {tariffTypeName(type) || "Тарификация"}
            </span>
            <span className="tw:text-sm tw:text-muted-foreground">
              <span className="tw:text-faint">·</span>{" "}
              <b className="tw:font-semibold tw:text-foreground tw:tabular-nums">
                {companyCount}
              </b>{" "}
              {plural(companyCount, "компания", "компании", "компаний")}{" "}
              <span className="tw:text-faint">·</span>{" "}
              <b className="tw:font-semibold tw:text-foreground tw:tabular-nums">
                {categoryCount}
              </b>{" "}
              {plural(categoryCount, "категория", "категории", "категорий")}
            </span>
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

      {/* Тарификация */}
      <Eyebrow>Тарификация</Eyebrow>
      <Panel>
        <div className="tw:flex tw:flex-wrap tw:items-baseline tw:justify-between tw:gap-3">
          <div className="tw:text-sm tw:font-semibold tw:text-muted-foreground">
            {tariffTypeName(type)}
          </div>
          {periodLabel}
        </div>

        {type === "hourPackage" && (
          <div className="tw:mt-3 tw:grid tw:gap-2">
            {hourPackages.map((pkg, index) => (
              <div
                key={index}
                className="tw:flex tw:items-center tw:gap-4 tw:rounded-xl tw:border tw:border-border-soft tw:bg-accent/40 tw:px-4 tw:py-3"
              >
                <span className="tw:min-w-16 tw:text-base tw:font-bold tw:text-accent-text tw:tabular-nums">
                  {pkg.hours} ч
                </span>
                <span className="tw:text-sm tw:text-muted-foreground tw:tabular-nums">
                  {money(pkg.pricePerHour)}/ч
                </span>
                <span className="tw:ml-auto tw:text-base tw:font-bold tw:tabular-nums">
                  <span className="tw:mr-1.5 tw:font-medium tw:text-faint">
                    =
                  </span>
                  {money(pkg.hours * pkg.pricePerHour)}
                </span>
              </div>
            ))}
          </div>
        )}

        {type === "fixedPrice" && (
          <div className="tw:mt-3 tw:text-4xl tw:font-bold tw:tracking-tight tw:tabular-nums">
            {money(fixedPrice)}
          </div>
        )}

        {type === "hourly" && (
          <div className="tw:mt-3 tw:text-4xl tw:font-bold tw:tracking-tight tw:tabular-nums">
            {money(pricePerHour)}
            <span className="tw:ml-1 tw:text-lg tw:font-semibold tw:text-muted-foreground">
              /ч
            </span>
          </div>
        )}

        {nonWorkingRow}
      </Panel>

      {/* График оказания */}
      <Eyebrow>График оказания услуги</Eyebrow>
      <Panel>
        {companyWorkSchedule ? (
          <div className="tw:flex tw:items-center tw:gap-2 tw:text-sm tw:text-muted-foreground">
            <RiTimeLine className="tw:text-faint" />
            Согласно графику работы компании
          </div>
        ) : (
          <div className="tw:grid tw:grid-cols-7 tw:gap-2 tw:max-md:grid-cols-4">
            {WEEK.map(([label, key]) => {
              const day = customProvisionSchedule?.[key];
              const working = day?.isWorking;
              const text = day?.is24hours
                ? "24 ч"
                : working
                  ? `${day.start}–${day.end}`
                  : "—";
              return (
                <div
                  key={key}
                  className={
                    working
                      ? "tw:rounded-lg tw:border tw:border-border-soft tw:bg-accent/40 tw:px-2 tw:py-2 tw:text-center"
                      : "tw:rounded-lg tw:border tw:border-border-soft tw:px-2 tw:py-2 tw:text-center"
                  }
                >
                  <div className="tw:text-[0.65rem] tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
                    {label}
                  </div>
                  <div
                    className={
                      working
                        ? "tw:mt-1 tw:text-sm tw:font-semibold tw:tabular-nums"
                        : "tw:mt-1 tw:text-sm tw:font-medium tw:text-faint"
                    }
                  >
                    {text}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Категории заявок — все, нейтральными пилюлями (согласовано) */}
      <PillPanel
        label="Категории заявок"
        items={ticketCategories}
        getLabel={(category) => category.title}
        emptyText="Не привязана ни к одной категории"
      />

      {/* Компании */}
      <PillPanel
        label="Компании"
        items={companies}
        getLabel={(company) => company.alias}
        emptyText="Не привязана ни к одной компании"
      />

      {metaBits && (
        <div className="tw:mt-5 tw:border-t tw:border-border-soft tw:pt-3.5 tw:text-xs tw:text-faint tw:tabular-nums">
          {metaBits}
        </div>
      )}

      <DeleteDialog
        item={servicePlan}
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

export default ViewServicePlan;
