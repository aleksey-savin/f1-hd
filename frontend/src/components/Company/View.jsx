import { useEffect, useState } from "react";
import {
  Link,
  Outlet,
  useActionData,
  useLocation,
  useNavigate,
} from "react-router";
import { BrowserView } from "react-device-detect";
import {
  RiArrowLeftSLine,
  RiAtLine,
  RiBuilding2Line,
  RiCheckboxCircleLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiForbid2Line,
  RiHistoryLine,
  RiMapPin2Line,
  RiMoreLine,
  RiPhoneLine,
  RiTaxiLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteDialog } from "@/components/app/DeleteItem";
import FormSheet from "@/components/app/FormSheet";
import { Eyebrow, Panel } from "@/components/app/Panel";
import AnchorRail from "@/components/app/AnchorRail";
import PropRow from "@/components/app/PropRow";
import TechSection from "@/components/app/TechSection";
import { useAuthedUser } from "@/store/authed-user";
import useInitialPrefs from "@/store/prefs";
import useOffcanvasStore from "@/store/offcanvas";
import useToastStore from "@/store/toast-store";

import { plural } from "../../util/plural";
import { formatShortDate } from "../../util/format-date";
import { getWorkingStatus } from "../../util/get-working-status";
import { openTaxi } from "../../util/taxi-operators";
import { getTaxiAction } from "./company-links";
import WorkStatusText from "./WorkStatusText";
import ToggleActiveDialog from "./ToggleActiveDialog";
import CompanyLogsOffcanvas from "../CompanyLogs/Offcanvas";

import HeroLogo from "./View/HeroLogo";
import ActivityTiles from "./View/ActivityTiles";
import ScheduleSection from "./View/ScheduleSection";
import SubdivisionsSection from "./View/SubdivisionsSection";
import EmployeesSection from "./View/EmployeesSection";
import ServicePlansSection from "./View/ServicePlansSection";
import ResponsiblesSection from "./View/ResponsiblesSection";
import ApiKeysSection from "./View/ApiKeysSection";

// Карточка компании: hero (логотип · название · живой статус графика ·
// счётчики охвата) → секции одним скроллом с липким рейлом-якорем (десктоп) →
// подвал «Обновлено …». Правка — вложенный маршрут update в FormSheet,
// «Лог активности» — в «⋯»-меню.
const DELETE_MESSAGE =
  "Вы уверены? Все пользователи компании также будут удалены. Это действие нельзя отменить.";

const personName = (person) =>
  person && (person.firstName || person.lastName)
    ? `${person.lastName || ""} ${person.firstName || ""}`.trim()
    : null;

const countTree = (nodes) =>
  (nodes || []).reduce(
    (sum, node) => sum + 1 + countTree(node.subdivisions),
    0,
  );

const dash = <span className="tw:font-normal tw:text-faint">—</span>;

const Pill = ({ children }) => (
  <span className="tw:inline-flex tw:items-center tw:rounded-full tw:border tw:border-border-soft tw:bg-accent tw:px-2.5 tw:py-0.5 tw:text-sm tw:font-medium">
    {children}
  </span>
);

const ViewCompany = ({
  company = {},
  servicePlans = [],
  servicePlansList = [],
  stats = null,
}) => {
  const { permissions } = useAuthedUser();
  const { modules, taxi } = useInitialPrefs();
  const offcanvas = useOffcanvasStore();
  const navigate = useNavigate();
  const location = useLocation();
  const actionData = useActionData();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toggleOpen, setToggleOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  // 409-гард toggle'а (компания по умолчанию для входящих заявок) — тостом
  useEffect(() => {
    if (actionData?.error && actionData.message) {
      useToastStore.getState().showToast("danger", actionData.message);
    }
  }, [actionData]);

  // Оба вложенных маршрута живут в FormSheet: мастер «Новой услуги» — wide
  // (сводка справа), правка компании — обычная колонка
  const isPlanWizard = location.pathname.endsWith("/service-plans/add");

  // Карточку всегда открываем от начала: Root сбрасывает только мобильный
  // контейнер, а window-скролл при навигации сохраняется (см. карточку услуги).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const canManage = permissions.canManageCompanies;
  const showFinances =
    modules?.finances?.isActive && permissions.canUseFinancesModule;
  const showTech =
    modules?.inventory?.isActive && permissions.canUseInventoryModule;
  const isActive = company.isActive !== false;

  const employeesCount = company.employees?.length || 0;
  const subdivisionsCount = countTree(company.subdivisions);
  const noSchedule = Boolean(getWorkingStatus(company.workSchedule).unknown);
  const taxiAction = getTaxiAction(company, taxi?.operator);

  const updaterName = personName(company.updatedBy);
  const metaBits = [
    company.updatedAt &&
      `Обновлено ${formatShortDate(company.updatedAt)}${updaterName ? `, ${updaterName}` : ""}`,
    company.createdAt && `создано ${formatShortDate(company.createdAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  // Рейл ведёт только по реально отрисованным секциям
  const railSections = [
    ...(stats ? [{ id: "company-activity", label: "Активность" }] : []),
    { id: "company-requisites", label: "Реквизиты" },
    { id: "company-schedule", label: "График работы" },
    { id: "company-structure", label: "Структура" },
    ...(showTech ? [{ id: "company-tech", label: "Техника" }] : []),
    { id: "company-people", label: "Сотрудники" },
    ...(showFinances ? [{ id: "company-plans", label: "Услуги" }] : []),
    { id: "company-responsibles", label: "Ответственные" },
    ...(canManage ? [{ id: "company-keys", label: "API-ключи" }] : []),
  ];

  return (
    <div className="tw:mx-auto tw:w-full tw:max-w-5xl">
      <Link
        to="/companies"
        className="tw:mb-4 tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:font-medium tw:text-muted-foreground tw:no-underline tw:hover:text-foreground"
      >
        <RiArrowLeftSLine /> Компании
      </Link>

      {/* HERO */}
      <div className="tw:flex tw:flex-wrap tw:items-start tw:gap-x-5 tw:gap-y-4">
        <HeroLogo company={company} canEdit={canManage} />
        <div className="tw:min-w-0 tw:flex-1">
          <h1 className="tw:my-0 tw:text-3xl tw:leading-tight tw:font-semibold tw:tracking-tight tw:break-words">
            {company.alias || "—"}
          </h1>
          {/* Юрлицо в hero не дублируем — полное наименование есть в
              «Реквизитах» (согласовано при живом прогоне) */}
          <div className="tw:mt-2.5 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1.5 tw:text-sm">
            {isActive ? (
              <WorkStatusText
                workSchedule={company.workSchedule}
                timezone={company.timezone}
                halo
                className="tw:font-semibold"
              />
            ) : (
              /* Живой график у отключённой — шум; статус как у пользователя */
              <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:font-semibold tw:text-destructive">
                <span className="tw:size-2 tw:rounded-full tw:bg-destructive" />
                Отключена
              </span>
            )}
            <span className="tw:text-muted-foreground tw:tabular-nums">
              <span className="tw:text-faint">·</span>{" "}
              <b className="tw:font-semibold tw:text-foreground">
                {employeesCount}
              </b>{" "}
              {plural(employeesCount, "сотрудник", "сотрудника", "сотрудников")}
              {showFinances && (
                <>
                  {" "}
                  <span className="tw:text-faint">·</span>{" "}
                  <b className="tw:font-semibold tw:text-foreground">
                    {servicePlans.length}
                  </b>{" "}
                  {plural(servicePlans.length, "услуга", "услуги", "услуг")}
                </>
              )}
              {subdivisionsCount > 0 && (
                <>
                  {" "}
                  <span className="tw:text-faint">·</span>{" "}
                  <b className="tw:font-semibold tw:text-foreground">
                    {subdivisionsCount}
                  </b>{" "}
                  {plural(
                    subdivisionsCount,
                    "подразделение",
                    "подразделения",
                    "подразделений",
                  )}
                </>
              )}
            </span>
          </div>
        </div>
        {canManage && (
          /* На мобильном блок действий занимает свою строку во всю ширину */
          <div className="tw:flex tw:w-full tw:items-center tw:gap-2 tw:sm:w-auto tw:sm:flex-none">
            <Button asChild className="tw:flex-1 tw:sm:flex-none">
              <Link to="update" onClick={offcanvas.setShow}>
                <RiEdit2Line /> Изменить
              </Link>
            </Button>
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
                <DropdownMenuItem onSelect={() => setLogsOpen(true)}>
                  <RiHistoryLine /> Лог активности
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setToggleOpen(true)}>
                  {isActive ? <RiForbid2Line /> : <RiCheckboxCircleLine />}
                  {isActive ? "Отключить" : "Включить"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  <RiDeleteBinLine /> Удалить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Разделы одним скроллом; слева — липкий рейл-якорь (только десктоп:
          на мобайле window не скроллится, рейл не рендерится) */}
      <div className="tw:flex tw:items-start tw:gap-7">
        <BrowserView className="tw:contents">
          <AnchorRail
            sections={railSections}
            ariaLabel="Разделы карточки"
            className="tw:mt-6"
          />
        </BrowserView>
        <div className="tw:min-w-0 tw:flex-1">
          <ActivityTiles
            stats={stats}
            company={company}
            id="company-activity"
          />

          {/* Реквизиты */}
          <Eyebrow id="company-requisites">Реквизиты</Eyebrow>
          <Panel>
            <PropRow
              icon={<RiBuilding2Line size={17} />}
              label="Полное наименование"
              copy={
                company.fullTitle
                  ? { value: company.fullTitle, label: "Реквизит" }
                  : undefined
              }
            >
              {company.fullTitle || dash}
            </PropRow>
            <PropRow icon={<RiPhoneLine size={17} />} label="Телефоны">
              {company.phones?.length ? (
                <span className="tw:tabular-nums">
                  {company.phones.map((phone, index) => (
                    <span key={phone}>
                      {index > 0 && <span className="tw:text-faint"> · </span>}
                      <a
                        href={`tel:${phone}`}
                        className="tw:text-accent-text tw:no-underline tw:hover:underline"
                      >
                        {phone}
                      </a>
                    </span>
                  ))}
                </span>
              ) : (
                dash
              )}
            </PropRow>
            <PropRow
              icon={<RiMapPin2Line size={17} />}
              label="Адрес"
              action={
                taxiAction && (
                  // Через openTaxi, а не голой ссылкой: он спрашивает текущее
                  // положение и кладёт его в маршрут начальной точкой
                  <button
                    type="button"
                    onClick={() => openTaxi(taxiAction)}
                    title={taxiAction.title}
                    aria-label={`${taxiAction.orderText} · ${taxiAction.label}`}
                    className="tw:grid tw:size-8 tw:flex-none tw:cursor-pointer tw:appearance-none tw:place-items-center tw:rounded-lg tw:border-0 tw:bg-transparent tw:text-faint tw:transition-colors tw:hover:bg-accent tw:hover:text-warning"
                  >
                    <RiTaxiLine size={16} />
                  </button>
                )
              }
              copy={
                company.address
                  ? { value: company.address, label: "Адрес" }
                  : undefined
              }
            >
              {company.address ? (
                company.linkToMap ? (
                  <a
                    href={company.linkToMap}
                    target="_blank"
                    rel="noreferrer"
                    title="Открыть на карте"
                    className="tw:text-accent-text tw:no-underline tw:hover:underline"
                  >
                    {company.address}
                  </a>
                ) : (
                  company.address
                )
              ) : (
                dash
              )}
            </PropRow>
            {canManage && (
              <PropRow icon={<RiAtLine size={17} />} label="Почтовые домены">
                {company.emailDomains?.length ? (
                  <span className="tw:flex tw:flex-wrap tw:gap-1.5 tw:pt-0.5">
                    {company.emailDomains.map((domain) => (
                      <Pill key={domain}>{domain}</Pill>
                    ))}
                  </span>
                ) : (
                  dash
                )}
              </PropRow>
            )}
          </Panel>

          <ScheduleSection
            workSchedule={company.workSchedule}
            hasSchedule={!noSchedule}
            timezone={company.timezone}
            id="company-schedule"
          />

          <SubdivisionsSection
            company={company}
            canManage={canManage}
            id="company-structure"
          />

          {/* Техника: список с фасетами + окружение (общая шторка устройства) */}
          {showTech && (
            <TechSection id="company-tech" companyId={company._id} />
          )}

          <EmployeesSection company={company} id="company-people" />

          {showFinances && (
            <ServicePlansSection
              company={company}
              plans={servicePlans}
              servicePlansList={servicePlansList}
              canManage={permissions.canManageServicePlans}
              id="company-plans"
            />
          )}

          <ResponsiblesSection company={company} id="company-responsibles" />

          {canManage && <ApiKeysSection company={company} id="company-keys" />}

          {metaBits && (
            <div className="tw:mt-5 tw:border-t tw:border-border-soft tw:pt-3.5 tw:text-xs tw:text-faint tw:tabular-nums">
              {metaBits}
            </div>
          )}
        </div>
      </div>

      <DeleteDialog
        item={{ ...company, title: company.alias }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        customDeleteMessage={DELETE_MESSAGE}
      />

      <ToggleActiveDialog
        company={company}
        open={toggleOpen}
        onOpenChange={setToggleOpen}
      />

      {/* Правка компании и мастер «Новой услуги» — вложенные маршруты в шторке */}
      <FormSheet
        open={offcanvas.isActive}
        size={isPlanWizard ? "lg" : "md"}
        onOpenChange={(open) => {
          if (!open) {
            navigate(-1);
            offcanvas.setClose();
          }
        }}
      >
        <Outlet />
      </FormSheet>

      {canManage && (
        <CompanyLogsOffcanvas
          show={logsOpen}
          onHide={() => setLogsOpen(false)}
          companyId={company._id}
          company={company}
          permissions={permissions}
          initialSearchQuery=""
        />
      )}
    </div>
  );
};

export default ViewCompany;
