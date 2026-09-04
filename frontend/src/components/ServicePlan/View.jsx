import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router";
import {
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
import Crumbs from "@/components/app/Crumbs";
import FormSheet from "@/components/app/FormSheet";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { Eyebrow, Panel } from "@/components/app/Panel";
import PillPanel from "@/components/app/PillPanel";

import useOffcanvasStore from "../../store/offcanvas";
import { formatShortDate } from "../../util/format-date";
import { formatPrice } from "../../util/format-string";
import { plural } from "../../util/plural";
import { tariffTypeName } from "./tariff-types";
import { useCan } from "@/store/authed-user";

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

// Имя автора (populate createdBy/updatedBy на getOne) — «Фамилия Имя»
const personName = (person) =>
  person && (person.firstName || person.lastName)
    ? `${person.lastName || ""} ${person.firstName || ""}`.trim()
    : null;

const ViewServicePlan = ({ servicePlan }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const can = useCan();
  const canManage = can({ servicePlan: ["manage"] });
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
      `Обновлено ${formatShortDate(updatedAt)}${updaterName ? `, ${updaterName}` : ""}`,
    createdAt && `создано ${formatShortDate(createdAt)}`,
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
        <b className="font-semibold text-foreground tabular-nums">
          ×{packagesNonWorkingCoefficient}
        </b>
      </>
    ) : (
      <>
        Нерабочее время:{" "}
        <b className="font-semibold text-foreground tabular-nums">
          {money(pricePerHourNonWorking)}/ч
        </b>
      </>
    );

  const periodLabel = (
    <div className="text-sm text-muted-foreground">
      Период тарификации{" "}
      <b className="font-semibold text-foreground tabular-nums">
        {tariffingPeriod} мин
      </b>
    </div>
  );

  const nonWorkingRow = (
    // border-dashed в tailwind ставит стиль всем сторонам; без preflight
    // остальные стороны получают дефолтную ширину и рисуется лишний бокс —
    // разделитель задаём только сверху, инлайном
    <div
      className="mt-3 flex items-center gap-2 pt-3 text-sm text-muted-foreground"
      style={{ borderTop: "1px dashed var(--border)" }}
    >
      <RiTimeLine className="text-faint" />
      <span>{nonWorking}</span>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Crumbs />

      {/* Hero */}
      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className="grid size-14 flex-none place-items-center rounded-2xl bg-accent text-2xl text-muted-foreground inset-ring inset-ring-border"
        >
          <RiFileList2Line />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="my-0 text-2xl leading-tight font-semibold tracking-tight">
            {title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-accent-text">
              <span className="size-2 rounded-full bg-primary ring-4 ring-primary/20" />
              {tariffTypeName(type) || "Тарификация"}
            </span>
            <span className="text-sm text-muted-foreground">
              <span className="text-faint">·</span>{" "}
              <b className="font-semibold text-foreground tabular-nums">
                {companyCount}
              </b>{" "}
              {plural(companyCount, "компания", "компании", "компаний")}{" "}
              <span className="text-faint">·</span>{" "}
              <b className="font-semibold text-foreground tabular-nums">
                {categoryCount}
              </b>{" "}
              {plural(categoryCount, "категория", "категории", "категорий")}
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
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="text-sm font-semibold text-muted-foreground">
            {tariffTypeName(type)}
          </div>
          {periodLabel}
        </div>

        {type === "hourPackage" && (
          <div className="mt-3 grid gap-2">
            {hourPackages.map((pkg, index) => (
              <div
                key={index}
                className="flex items-center gap-4 rounded-xl border border-border-soft bg-accent/40 px-4 py-3"
              >
                <span className="min-w-16 text-base font-bold text-accent-text tabular-nums">
                  {pkg.hours} ч
                </span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {money(pkg.pricePerHour)}/ч
                </span>
                <span className="ml-auto text-base font-bold tabular-nums">
                  <span className="mr-1.5 font-medium text-faint">=</span>
                  {money(pkg.hours * pkg.pricePerHour)}
                </span>
              </div>
            ))}
          </div>
        )}

        {type === "fixedPrice" && (
          <div className="mt-3 text-4xl font-bold tracking-tight tabular-nums">
            {money(fixedPrice)}
          </div>
        )}

        {type === "hourly" && (
          <div className="mt-3 text-4xl font-bold tracking-tight tabular-nums">
            {money(pricePerHour)}
            <span className="ml-1 text-lg font-semibold text-muted-foreground">
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RiTimeLine className="text-faint" />
            Согласно графику работы компании
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-2 max-md:grid-cols-4">
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
                      ? "rounded-lg border border-border-soft bg-accent/40 px-2 py-2 text-center"
                      : "rounded-lg border border-border-soft px-2 py-2 text-center"
                  }
                >
                  <div className="text-xs font-bold tracking-wider text-faint uppercase">
                    {label}
                  </div>
                  <div
                    className={
                      working
                        ? "mt-1 text-sm font-semibold tabular-nums"
                        : "mt-1 text-sm font-medium text-faint"
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
        <div className="mt-5 border-t border-border-soft pt-3.5 text-xs text-faint tabular-nums">
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
        size="lg"
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
