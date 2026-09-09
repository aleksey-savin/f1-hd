import { useEffect, useState } from "react";
import { Link, useActionData } from "react-router";
import { BrowserView } from "react-device-detect";
import {
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
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Crumbs from "@/components/app/Crumbs";
import { DeleteDialog } from "@/components/app/DeleteItem";
import FormOutlet from "@/components/app/FormOutlet";
import {
  Eyebrow,
  Panel,
  Section,
  SectionEditLink,
} from "@/components/app/Panel";
import AnchorRail, { scrollToSection } from "@/components/app/AnchorRail";
import PropRow from "@/components/app/PropRow";
import TechSection from "@/components/app/TechSection";
import { useCan } from "@/store/authed-user";
import useInitialPrefs from "@/store/prefs";
import useToastStore from "@/store/toast-store";

import { plural } from "../../util/plural";
import { formatShortDate } from "../../util/format-date";
import { getWorkingStatus } from "../../util/get-working-status";
import { getCompanyAddresses } from "./company-links";
import TaxiButton from "./TaxiButton";
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
// подвал «Обновлено …». Правка — вложенный маршрут update в шторке (app/FormOutlet),
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

const dash = <span className="font-normal text-faint">—</span>;

const Pill = ({ children }) => (
  <span className="inline-flex items-center rounded-full border border-border-soft bg-accent px-2.5 py-0.5 text-sm font-medium">
    {children}
  </span>
);

const ViewCompany = ({
  company = {},
  servicePlans = [],
  servicePlansList = [],
  stats = null,
}) => {
  const can = useCan();
  const { modules } = useInitialPrefs();
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

  // Карточку всегда открываем от начала: Root сбрасывает только мобильный
  // контейнер, а window-скролл при навигации сохраняется (см. карточку услуги).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const canManage = can({ company: ["manage"] });
  const showFinances =
    modules?.finances?.isActive && can({ servicePlan: ["read"] });
  const showTech = modules?.inventory?.isActive && can({ device: ["read"] });
  const isActive = company.isActive !== false;

  const employeesCount = company.employees?.length || 0;
  const subdivisionsCount = countTree(company.subdivisions);
  const noSchedule = Boolean(getWorkingStatus(company.workSchedule).unknown);
  // Адреса подразделений живут в «Структуре» (шторка узла); в реквизитах —
  // свой адрес компании и счётчик-ссылка туда, а в меню такси — все сразу
  const extraAddresses = getCompanyAddresses(company).filter(
    (entry) => entry.source === "subdivision",
  ).length;

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
    <div className="mx-auto w-full max-w-5xl">
      <Crumbs />

      {/* HERO */}
      <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
        <HeroLogo company={company} canEdit={canManage} />
        <div className="min-w-0 flex-1">
          <h1 className="my-0 text-2xl leading-tight font-semibold tracking-tight break-words">
            {company.alias || "—"}
          </h1>
          {/* Юрлицо в hero не дублируем — полное наименование есть в
              «Реквизитах» (согласовано при живом прогоне) */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            {isActive ? (
              <WorkStatusText
                workSchedule={company.workSchedule}
                timezone={company.timezone}
                halo
                className="font-semibold"
              />
            ) : (
              /* Живой график у отключённой — шум; статус как у пользователя */
              <span className="inline-flex items-center gap-1.5 font-semibold text-destructive">
                <span className="size-2 rounded-full bg-destructive" />
                Отключена
              </span>
            )}
            <span className="text-muted-foreground tabular-nums">
              <span className="text-faint">·</span>{" "}
              <b className="font-semibold text-foreground">{employeesCount}</b>{" "}
              {plural(employeesCount, "сотрудник", "сотрудника", "сотрудников")}
              {showFinances && (
                <>
                  {" "}
                  <span className="text-faint">·</span>{" "}
                  <b className="font-semibold text-foreground">
                    {servicePlans.length}
                  </b>{" "}
                  {plural(servicePlans.length, "услуга", "услуги", "услуг")}
                </>
              )}
              {subdivisionsCount > 0 && (
                <>
                  {" "}
                  <span className="text-faint">·</span>{" "}
                  <b className="font-semibold text-foreground">
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
          <div className="flex w-full items-center gap-2 sm:w-auto sm:flex-none">
            <Button asChild className="flex-1 sm:flex-none">
              <Link to="update">
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
      <div className="flex items-start gap-7">
        <BrowserView className="contents">
          <AnchorRail
            sections={railSections}
            ariaLabel="Разделы карточки"
            className="mt-6"
          />
        </BrowserView>
        <div className="min-w-0 flex-1">
          <ActivityTiles
            stats={stats}
            company={company}
            id="company-activity"
          />

          {/* Реквизиты */}
          <Section>
            <Eyebrow
              id="company-requisites"
              action={
                canManage ? (
                  <SectionEditLink to="update#basic" label="Реквизиты" />
                ) : undefined
              }
            >
              Реквизиты
            </Eyebrow>
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
                  <span className="tabular-nums">
                    {company.phones.map((phone, index) => (
                      <span key={phone}>
                        {index > 0 && <span className="text-faint"> · </span>}
                        <a
                          href={`tel:${phone}`}
                          className="text-accent-text no-underline hover:underline"
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
                label={extraAddresses > 0 ? "Адреса" : "Адрес"}
                action={<TaxiButton company={company} />}
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
                      className="text-accent-text no-underline hover:underline"
                    >
                      {company.address}
                    </a>
                  ) : (
                    company.address
                  )
                ) : (
                  dash
                )}
                {extraAddresses > 0 && (
                  <span className="font-normal text-faint">
                    {" · "}
                    <a
                      href="#company-structure"
                      title="Адреса подразделений — в разделе «Структура»"
                      onClick={(event) => {
                        event.preventDefault();
                        scrollToSection(null, "company-structure");
                      }}
                      className="text-inherit no-underline hover:text-foreground hover:underline"
                    >
                      {company.address
                        ? `ещё ${extraAddresses} в структуре`
                        : `${extraAddresses} ${plural(extraAddresses, "адрес", "адреса", "адресов")} в структуре`}
                    </a>
                  </span>
                )}
              </PropRow>
              {canManage && (
                <PropRow icon={<RiAtLine size={17} />} label="Почтовые домены">
                  {company.emailDomains?.length ? (
                    <span className="flex flex-wrap gap-1.5 pt-0.5">
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
          </Section>

          <ScheduleSection
            workSchedule={company.workSchedule}
            hasSchedule={!noSchedule}
            timezone={company.timezone}
            canManage={canManage}
            id="company-schedule"
          />

          <SubdivisionsSection
            company={company}
            canManage={canManage}
            id="company-structure"
          />

          {/* Техника: список с фасетами + окружение (общая шторка устройства) */}
          {showTech && (
            <TechSection
              id="company-tech"
              companyId={company._id}
              from={company.alias}
            />
          )}

          <EmployeesSection company={company} id="company-people" />

          {showFinances && (
            <ServicePlansSection
              company={company}
              plans={servicePlans}
              servicePlansList={servicePlansList}
              canManage={can({ servicePlan: ["manage"] })}
              id="company-plans"
            />
          )}

          <ResponsiblesSection
            company={company}
            canManage={canManage}
            id="company-responsibles"
          />

          {canManage && <ApiKeysSection company={company} id="company-keys" />}

          {metaBits && (
            <div className="mt-5 border-t border-border-soft pt-3.5 text-xs text-faint tabular-nums">
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
      <FormOutlet />

      {canManage && (
        <CompanyLogsOffcanvas
          show={logsOpen}
          onHide={() => setLogsOpen(false)}
          companyId={company._id}
          company={company}
          can={can}
          initialSearchQuery=""
        />
      )}
    </div>
  );
};

export default ViewCompany;
