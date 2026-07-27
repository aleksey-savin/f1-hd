import { useContext, useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router";
import { BrowserView } from "react-device-detect";
import {
  RiArrowLeftSLine,
  RiBuilding2Line,
  RiCheckLine,
  RiCloseLine,
  RiDashboardLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiGroupLine,
  RiHardDrive2Line,
  RiLock2Line,
  RiLoginCircleLine,
  RiMailLine,
  RiMoneyDollarCircleLine,
  RiMoreLine,
  RiPhoneLine,
  RiPriceTag3Line,
  RiRemoteControlLine,
  RiSettings4Line,
  RiShieldCheckLine,
  RiShieldLine,
  RiTelegramLine,
  RiTicket2Line,
  RiTimeLine,
  RiUserFollowLine,
  RiUserUnfollowLine,
  RiVipCrownLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FormSheet from "@/components/app/FormSheet";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { Eyebrow, Panel, SubLabel } from "@/components/app/Panel";
import PillPanel from "@/components/app/PillPanel";
import AnchorRail from "@/components/app/AnchorRail";
import PropRow from "@/components/app/PropRow";
import TechSection from "@/components/app/TechSection";
import WorkScheduleSection from "@/components/User/WorkScheduleSection";
import { cn } from "@/lib/utils";

import { AuthedUserContext } from "../../store/authed-user-context";
import useOffcanvasStore from "../../store/offcanvas";
import useInitialPrefs from "../../store/prefs";
import { getPresence } from "./presence";
import PresenceText from "./PresenceText";
import { DASHBOARD_MODULE, PERMISSION_MODULES } from "./permissions-catalog";
import { relativeDay } from "../../util/relative-time";
import { formatPrice } from "../../util/format-string";

import CardAvatar from "./CardAvatar";
import ResetPasswordDialog from "./ResetPasswordDialog";
import ToggleActiveDialog from "./ToggleActiveDialog";
import LinkAdDialog from "./LinkAdDialog";

const fmtDate = (value) =>
  value ? new Date(value).toLocaleDateString("ru-RU") : null;
const fmtDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

const ticketState = (state) =>
  state === "Новая" || state === "Не в работе"
    ? "tw:text-warning"
    : state === "В работе"
      ? "tw:text-info"
      : "tw:text-faint";
const ticketDot = (state) =>
  state === "Новая" || state === "Не в работе"
    ? "tw:bg-warning"
    : state === "В работе"
      ? "tw:bg-info"
      : "tw:bg-faint";

const StatusText = ({ on, onText = "Подключён", offText = "Не подключён" }) => (
  <span
    className={cn(
      "tw:inline-flex tw:items-center tw:gap-1.5 tw:text-sm tw:font-semibold",
      on ? "tw:text-accent-text" : "tw:text-faint",
    )}
  >
    <span className={cn("tw:size-2 tw:rounded-full", on ? "tw:bg-primary" : "tw:bg-faint")} />
    {on ? onText : offText}
  </span>
);

const Pill = ({ children }) => (
  <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-full tw:border tw:border-border tw:bg-accent tw:px-2.5 tw:py-1 tw:text-sm tw:font-medium tw:text-muted-foreground">
    {children}
  </span>
);

// Способность (выданная — бирюзовая галочка, отсутствующая — приглушённый крест)
const Cap = ({ on, children }) => (
  <div
    className={cn(
      "tw:flex tw:items-center tw:gap-2 tw:py-0.5 tw:text-sm",
      on ? "tw:text-foreground" : "tw:text-faint",
    )}
  >
    {on ? (
      <RiCheckLine className="tw:size-4 tw:flex-none tw:text-primary" />
    ) : (
      <RiCloseLine className="tw:size-4 tw:flex-none tw:text-faint" />
    )}
    {children}
  </div>
);

const ViewUser = ({ user, tickets }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const authedUser = useContext(AuthedUserContext);
  const canManageUsers = authedUser.permissions?.canManageUsers;
  const canManageCompanies = authedUser.permissions?.canManageCompanies;
  const { modules: appModules } = useInitialPrefs();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [toggleOpen, setToggleOpen] = useState(false);
  const [adOpen, setAdOpen] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const {
    firstName,
    lastName,
    email,
    phone,
    position,
    role,
    company,
    subdivision,
    categories = [],
    responsibleForCompanies = [],
    isEndUser,
    isServiceAccount,
    isCloudTelephony,
    isAdmin,
    isActive,
    telegramBot,
    getScreen,
    activeDirectoryObjectGUID,
    finances,
    permissions = {},
    dashboard = {},
    notify,
    lastLogin,
    lastActivityAt,
    createdAt,
  } = user;

  const fullName = `${lastName || ""} ${firstName || ""}`.trim() || "—";
  const ticketList = Array.isArray(tickets) ? tickets : tickets?.tickets || [];

  const presence = getPresence(user);

  const accountType = isEndUser
    ? "Клиент"
    : isServiceAccount
      ? "Сервисный аккаунт"
      : isCloudTelephony
        ? "Телефония"
        : "Сотрудник";

  const managerName = subdivision?.manager
    ? `${subdivision.manager.lastName || ""} ${subdivision.manager.firstName || ""}`.trim()
    : null;

  // Финансы. Раздел не про клиентов (зарплатных полей у них нет) — на карточке
  // клиента его не рисуем вовсе. Видят: администратор — на любой карточке
  // сотрудника; сотрудник (не клиент) — свою собственную. Обладатель
  // canSeeGlobalFinancialReport чужие финансы больше не видит — права ещё
  // будем перерабатывать; сервер (getOne) пока отдаёт ему finances в ответе.
  const isSelf = String(authedUser._id) === String(user._id);
  const canSeeFinances =
    !isEndUser &&
    finances &&
    (authedUser.isAdmin || (isSelf && !authedUser.isEndUser));

  const adLinked = Boolean(activeDirectoryObjectGUID);

  // Модули прав берём из общего каталога (им же управляет форма) — один список
  // на показ и на редактирование. master — «рубильник» модуля.
  const MODULE_ICONS = {
    tickets: <RiTicket2Line />,
    portal: <RiSettings4Line />,
    knowledge: <RiPriceTag3Line />,
    time: <RiTimeLine />,
    inventory: <RiHardDrive2Line />,
    finances: <RiMoneyDollarCircleLine />,
    dashboard: <RiDashboardLine />,
  };
  const modules = [...PERMISSION_MODULES, DASHBOARD_MODULE].map((module) => {
    const values = module.key === "dashboard" ? dashboard : permissions;
    return {
      label: module.label,
      icon: MODULE_ICONS[module.key],
      master: module.master ? Boolean(values[module.master]) : undefined,
      caps: module.caps.map((cap) => ({
        on: Boolean(values[cap.key]),
        label: cap.label,
      })),
    };
  });

  const notifyRows = notify
    ? [
        { label: "Новая заявка", tg: notify.byTelegram?.newTicket, em: notify.byEmail?.newTicket },
        { label: "Статус ответственного", tg: notify.byTelegram?.respStateUpdate, em: notify.byEmail?.respStateUpdate },
        { label: "Изменение статуса заявки", tg: notify.byTelegram?.ticketStateUpdate, em: notify.byEmail?.ticketStateUpdate },
        { label: "Изменение срока", tg: notify.byTelegram?.ticketDeadlineUpdate, em: notify.byEmail?.ticketDeadlineUpdate },
        { label: "Новые комментарии", tg: notify.byTelegram?.ticketNewComment, em: notify.byEmail?.ticketNewComment },
        { label: "Запланированные работы", tg: notify.byTelegram?.scheduledWorks, em: notify.byEmail?.scheduledWorks },
      ]
    : [];
  const tgConnected = Boolean(telegramBot?.isActive);

  const showPermissions = canManageUsers && !isEndUser;
  const showNotify = canManageUsers && Boolean(notify);

  // Техника (список + окружение) — при активном модуле инвентаря и праве на
  // него; служебным аккаунтам рабочее место не положено.
  const showTech =
    !isServiceAccount &&
    !isCloudTelephony &&
    Boolean(appModules?.inventory?.isActive) &&
    Boolean(authedUser.permissions?.canUseInventoryModule);

  // График работы — только у сотрудников: у клиентов и служебных аккаунтов
  // нет ни нормы часов, ни отсутствий
  const showSchedule = !isEndUser && !isServiceAccount && !isCloudTelephony;

  // Рейл ведёт только по реально отрисованным секциям
  const railSections = [
    { id: "contacts", label: "Контакты" },
    { id: "org", label: "Организация" },
    ...(showSchedule ? [{ id: "schedule", label: "График работы" }] : []),
    ...(showTech ? [{ id: "tech", label: "Техника" }] : []),
    { id: "tickets", label: "Заявки" },
    ...(categories.length > 0 ? [{ id: "categories", label: "Категории" }] : []),
    ...(responsibleForCompanies.length > 0
      ? [{ id: "responsible", label: "Ответственность" }]
      : []),
    ...(canSeeFinances ? [{ id: "finances", label: "Финансы" }] : []),
    ...(showPermissions ? [{ id: "permissions", label: "Права и доступ" }] : []),
    ...(showNotify ? [{ id: "notifications", label: "Уведомления" }] : []),
  ];

  return (
    // max-w-5xl: рейл 192px + зазор 28px + колонка секций ≈ 804px
    <div className="tw:mx-auto tw:w-full tw:max-w-5xl">
      <Link
        to="/users"
        className="tw:mb-4 tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:font-medium tw:text-muted-foreground tw:no-underline tw:hover:text-foreground"
      >
        <RiArrowLeftSLine /> Пользователи
      </Link>

      {/* HERO */}
      <div className="tw:flex tw:flex-wrap tw:items-start tw:gap-x-5 tw:gap-y-4">
        <CardAvatar user={user} ringColor={presence.ringColor} canEdit={canManageUsers} />
        <div className="tw:min-w-0 tw:flex-1">
          <h1 className="tw:my-0 tw:text-3xl tw:leading-tight tw:font-semibold tw:tracking-tight tw:break-words">
            {fullName}
          </h1>
          {position && (
            <div className="tw:mt-1 tw:text-base tw:text-muted-foreground">{position}</div>
          )}
          <div className="tw:mt-2.5 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1.5 tw:text-sm">
            {presence.visible && (
              <PresenceText presence={presence} className="tw:font-semibold" />
            )}
            <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-muted-foreground">
              <RiVipCrownLine className="tw:size-4 tw:text-faint" />
              {accountType}
              {isAdmin && <span className="tw:text-accent-text">· Администратор</span>}
            </span>
            {company?.alias && (
              <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-muted-foreground">
                <RiBuilding2Line className="tw:size-4 tw:text-faint" />
                <Link
                  to={`/companies/${company._id}`}
                  className="tw:text-accent-text tw:no-underline tw:hover:underline"
                >
                  {company.alias}
                </Link>
                {subdivision?.name && <span className="tw:text-faint">· {subdivision.name}</span>}
              </span>
            )}
            {!isActive && (
              <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:font-semibold tw:text-destructive">
                <span className="tw:size-2 tw:rounded-full tw:bg-destructive" />
                Отключён
              </span>
            )}
          </div>
        </div>
        {canManageUsers && (
          /* На мобильном имя не делит строку с кнопками (flex-basis имени — 0,
             перенос сам не случается, и длинное имя уезжает под кнопки):
             блок действий занимает свою строку во всю ширину, с sm — как был */
          <div className="tw:flex tw:w-full tw:items-center tw:gap-2 tw:sm:w-auto tw:sm:flex-none">
            <Button asChild className="tw:flex-1 tw:sm:flex-none">
              <Link to="update" onClick={offcanvas.setShow}>
                <RiEdit2Line /> Изменить
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Действия" title="Действия">
                  <RiMoreLine />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!isServiceAccount && (
                  <DropdownMenuItem onSelect={() => setResetOpen(true)}>
                    <RiLock2Line /> Сбросить пароль
                  </DropdownMenuItem>
                )}
                {canManageCompanies && company && (
                  <DropdownMenuItem onSelect={() => setAdOpen(true)}>
                    {adLinked ? <RiShieldLine /> : <RiShieldCheckLine />}
                    {adLinked ? "Отвязать от AD" : "Связать с AD"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setToggleOpen(true)}>
                  {isActive ? <RiUserUnfollowLine /> : <RiUserFollowLine />}
                  {isActive ? "Отключить" : "Включить"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
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
          {/* mt-6 — под встроенный отступ первой метки секции (Eyebrow),
              иначе рейл висит выше заголовка «Контакты и доступ» */}
          <AnchorRail
            sections={railSections}
            ariaLabel="Разделы карточки"
            className="tw:mt-6"
          />
        </BrowserView>
        <div className="tw:min-w-0 tw:flex-1">

      {/* Контакты и доступ */}
      <Eyebrow id="contacts">Контакты и доступ</Eyebrow>
      <Panel>
        <PropRow
          icon={<RiMailLine size={17} />}
          label="Почта"
          copy={email ? { value: email, label: "Почта" } : undefined}
        >
          {email ? (
            <a href={`mailto:${email}`} className="tw:text-accent-text tw:no-underline tw:hover:underline">
              {email}
            </a>
          ) : (
            <span className="tw:font-normal tw:text-faint">—</span>
          )}
        </PropRow>
        <PropRow
          icon={<RiPhoneLine size={17} />}
          label="Телефон"
          copy={phone ? { value: phone, label: "Телефон" } : undefined}
        >
          {phone ? (
            <a href={`tel:${phone}`} className="tw:text-accent-text tw:no-underline tw:tabular-nums tw:hover:underline">
              {phone}
            </a>
          ) : (
            <span className="tw:font-normal tw:text-faint">—</span>
          )}
        </PropRow>
        <PropRow icon={<RiTelegramLine size={17} />} label="Telegram-бот">
          <StatusText on={tgConnected} />
        </PropRow>
        <PropRow icon={<RiShieldCheckLine size={17} />} label="Active Directory">
          <StatusText on={adLinked} onText="Связан" offText="Не связан" />
        </PropRow>
        <PropRow icon={<RiRemoteControlLine size={17} />} label="PRO32 Connect">
          <StatusText
            on={Boolean(getScreen?.hasApi)}
            onText="Подключён"
            offText="Не подключён"
          />
        </PropRow>
      </Panel>

      {/* Организация + Активность */}
      <div
        id="org"
        className="tw:mt-6 tw:grid tw:gap-4 tw:scroll-mt-28 tw:md:grid-cols-2"
      >
        <div>
          <SubLabel>Организация</SubLabel>
          <Panel>
            <PropRow icon={<RiBuilding2Line size={17} />} label="Компания">
              {company?.alias ? (
                <Link to={`/companies/${company._id}`} className="tw:text-accent-text tw:no-underline tw:hover:underline">
                  {company.alias}
                </Link>
              ) : (
                <span className="tw:font-normal tw:text-faint">—</span>
              )}
            </PropRow>
            <PropRow icon={<RiGroupLine size={17} />} label="Подразделение">
              {subdivision?.name ? (
                <span>
                  {subdivision.name}
                  {managerName && (
                    <span className="tw:font-normal tw:text-faint">
                      {" · рук. "}
                      <Link
                        to={`/users/${subdivision.manager._id}`}
                        className="tw:text-accent-text tw:no-underline tw:hover:underline"
                      >
                        {managerName}
                      </Link>
                    </span>
                  )}
                </span>
              ) : (
                <span className="tw:font-normal tw:text-faint">—</span>
              )}
            </PropRow>
            {role && (
              <PropRow icon={<RiPriceTag3Line size={17} />} label="Роль">
                {role}
              </PropRow>
            )}
          </Panel>
        </div>
        <div>
          <SubLabel>Активность</SubLabel>
          <Panel>
            <PropRow icon={<RiLoginCircleLine size={17} />} label="Последний вход">
              {lastLogin ? (
                <span className="tw:tabular-nums">{fmtDateTime(lastLogin)}</span>
              ) : (
                <span className="tw:font-normal tw:text-faint">никогда</span>
              )}
            </PropRow>
            <PropRow icon={<RiTicket2Line size={17} />} label="Последняя заявка">
              {relativeDay(lastActivityAt) ? (
                <span className="tw:tabular-nums">{relativeDay(lastActivityAt)}</span>
              ) : (
                <span className="tw:font-normal tw:text-faint">нет обращений</span>
              )}
            </PropRow>
            <PropRow icon={<RiTimeLine size={17} />} label="В системе с">
              <span className="tw:tabular-nums">{fmtDate(createdAt) || "—"}</span>
            </PropRow>
          </Panel>
        </div>
      </div>

      {/* Техника: список с фасетами + окружение (общая шторка устройства) */}
      {showSchedule && (
        <WorkScheduleSection id="schedule" userId={user._id} />
      )}

      {showTech && <TechSection id="tech" userId={user._id} subject="user" />}

      {/* Недавние заявки */}
      <Eyebrow id="tickets" count={ticketList.length}>
        Недавние заявки
      </Eyebrow>
      <Panel>
        {ticketList.length > 0 ? (
          <>
            <div className="tw:flex tw:flex-col">
              {ticketList.slice(0, 8).map((ticket) => (
                <Link
                  key={ticket._id}
                  to={`/tickets/${ticket.num}`}
                  className="tw:flex tw:items-center tw:gap-3 tw:border-t tw:border-border-soft tw:py-2.5 tw:text-foreground tw:no-underline tw:first:border-t-0 tw:hover:bg-accent/40"
                >
                  <span className="tw:w-16 tw:flex-none tw:text-sm tw:font-semibold tw:text-accent-text tw:tabular-nums">
                    №{ticket.num}
                  </span>
                  <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-sm">{ticket.title}</span>
                  <span className="tw:flex-none tw:text-xs tw:text-faint tw:tabular-nums">
                    {fmtDate(ticket.createdAt)}
                  </span>
                  <span
                    className={cn(
                      "tw:inline-flex tw:flex-none tw:items-center tw:gap-1.5 tw:text-xs tw:font-semibold",
                      ticketState(ticket.state),
                    )}
                  >
                    <span className={cn("tw:size-1.5 tw:rounded-full", ticketDot(ticket.state))} />
                    {ticket.state}
                  </span>
                </Link>
              ))}
            </div>
            {ticketList.length > 8 && (
              <Link
                to={`/tickets?applicant=${user._id}`}
                className="tw:mt-3 tw:inline-block tw:text-sm tw:font-semibold tw:text-accent-text tw:no-underline tw:hover:underline"
              >
                Все заявки ({ticketList.length}) →
              </Link>
            )}
          </>
        ) : (
          <div className="tw:py-2 tw:text-sm tw:text-muted-foreground">Заявок пока нет.</div>
        )}
      </Panel>

      {/* Категории и ответственность — общий app/PillPanel: нейтральные пилюли
          в свёрнутом «облаке» с «Показать все (N)» при переполнении */}
      {categories.length > 0 && (
        <PillPanel
          id="categories"
          label="Категории заявок"
          items={[...categories].sort((a, b) =>
            (a.title || "").localeCompare(b.title || ""),
          )}
        />
      )}
      {responsibleForCompanies.length > 0 && (
        <PillPanel
          id="responsible"
          label="Ответственный за компании"
          items={responsibleForCompanies}
          getKey={(item, index) => String(item.id ?? item._id ?? index)}
        />
      )}

      {/* Финансы (по правам) */}
      {canSeeFinances && (
        <>
          <Eyebrow id="finances">Финансы</Eyebrow>
          <Panel>
            <PropRow icon={<RiMoneyDollarCircleLine size={17} />} label="Оклад">
              {finances.salary != null ? (
                `${formatPrice(finances.salary)}/мес`
              ) : (
                <span className="tw:font-normal tw:text-faint">не задан</span>
              )}
            </PropRow>
            <PropRow icon={<RiTimeLine size={17} />} label="Ставка переработок">
              {finances.overtimeHourlyRate != null ? (
                `${formatPrice(finances.overtimeHourlyRate)}/час`
              ) : (
                <span className="tw:font-normal tw:text-faint">не задана</span>
              )}
            </PropRow>
          </Panel>
        </>
      )}

      {/* Права и доступ (для управляющих пользователями) */}
      {showPermissions && (
        <>
          <Eyebrow id="permissions">Права и доступ</Eyebrow>
          <Panel>
            <div className="tw:mb-4 tw:flex tw:flex-wrap tw:gap-2">
              <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-full tw:bg-primary/15 tw:px-2.5 tw:py-1 tw:text-sm tw:font-semibold tw:text-accent-text">
                <RiVipCrownLine className="tw:size-3.5" />
                {isAdmin ? "Администратор" : accountType}
              </span>
              {isAdmin && <Pill>{accountType}</Pill>}
            </div>
            <div className="tw:grid tw:gap-x-6 tw:gap-y-4 tw:sm:grid-cols-2">
              {modules.map((module) => {
                const disabled = module.master === false;
                // Показываем только выданные способности — «что человек может»;
                // полный список с отказами живёт в форме правки.
                const granted = module.caps.filter((cap) => cap.on);
                return (
                  <div key={module.label} className={cn(disabled && "tw:opacity-50")}>
                    <div className="tw:mb-2 tw:flex tw:items-center tw:gap-2 tw:text-sm tw:font-semibold">
                      <span className="tw:text-muted-foreground tw:[&_svg]:size-4">{module.icon}</span>
                      {module.label}
                      {module.master !== undefined && (
                        <span
                          className={cn(
                            "tw:ml-auto tw:text-xs tw:font-bold tw:tracking-wide tw:uppercase",
                            module.master ? "tw:text-accent-text" : "tw:text-faint",
                          )}
                        >
                          {module.master ? "Включён" : "Отключён"}
                        </span>
                      )}
                    </div>
                    {disabled ? (
                      <Cap on={false}>Модуль недоступен</Cap>
                    ) : granted.length > 0 ? (
                      granted.map((cap) => (
                        <Cap key={cap.label} on>
                          {cap.label}
                        </Cap>
                      ))
                    ) : (
                      <div className="tw:py-0.5 tw:text-sm tw:text-faint">
                        Нет выданных прав
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        </>
      )}

      {/* Уведомления (для управляющих пользователями) */}
      {showNotify && (
        <>
          <Eyebrow id="notifications">Уведомления</Eyebrow>
          <Panel>
            <div className="tw:overflow-x-auto">
              <table className="tw:w-full tw:text-sm">
                <thead>
                  <tr className="tw:text-xs tw:font-bold tw:tracking-wide tw:text-faint tw:uppercase">
                    <th className="tw:py-2 tw:text-left tw:font-bold">Событие</th>
                    <th className="tw:px-3 tw:py-2 tw:font-bold">
                      <span className="tw:inline-flex tw:items-center tw:gap-1.5">
                        <RiTelegramLine className="tw:size-4 tw:text-muted-foreground" /> Telegram
                      </span>
                    </th>
                    <th className="tw:px-3 tw:py-2 tw:font-bold">
                      <span className="tw:inline-flex tw:items-center tw:gap-1.5">
                        <RiMailLine className="tw:size-4 tw:text-muted-foreground" /> Email
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {notifyRows.map((row) => (
                    <tr key={row.label} className="tw:border-t tw:border-border-soft">
                      <td className="tw:py-2 tw:font-medium">{row.label}</td>
                      <td className="tw:px-3 tw:py-2 tw:text-center">
                        {row.tg && tgConnected ? (
                          <RiCheckLine className="tw:mx-auto tw:size-4.5 tw:text-primary" />
                        ) : (
                          <RiCloseLine className="tw:mx-auto tw:size-4.5 tw:text-faint" />
                        )}
                      </td>
                      <td className="tw:px-3 tw:py-2 tw:text-center">
                        {row.em ? (
                          <RiCheckLine className="tw:mx-auto tw:size-4.5 tw:text-primary" />
                        ) : (
                          <RiCloseLine className="tw:mx-auto tw:size-4.5 tw:text-faint" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!tgConnected && (
              <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-faint">
                Telegram-бот не подключён — сообщения в Telegram не отправляются.
              </p>
            )}
          </Panel>
        </>
      )}

        </div>
      </div>

      {/* Диалоги */}
      <DeleteDialog item={{ ...user, title: fullName }} open={deleteOpen} onOpenChange={setDeleteOpen} />
      {!isServiceAccount && (
        <ResetPasswordDialog user={user} open={resetOpen} onOpenChange={setResetOpen} />
      )}
      <ToggleActiveDialog user={user} open={toggleOpen} onOpenChange={setToggleOpen} />
      {canManageCompanies && company && (
        <LinkAdDialog user={user} open={adOpen} onOpenChange={setAdOpen} />
      )}

      <FormSheet
        open={offcanvas.isActive}
        wide
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

export default ViewUser;
