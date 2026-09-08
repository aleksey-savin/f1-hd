import { useContext, useEffect, useState } from "react";
import { Link, useRevalidator } from "react-router";
import { BrowserView } from "react-device-detect";
import {
  RiBuilding2Line,
  RiCheckLine,
  RiCloseLine,
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
  RiSpyLine,
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
import Crumbs, { useCrumbFrom } from "@/components/app/Crumbs";
import FormOutlet from "@/components/app/FormOutlet";
import { DeleteDialog } from "@/components/app/DeleteItem";
import {
  Eyebrow,
  Panel,
  Section,
  SectionEditLink,
  SubLabel,
} from "@/components/app/Panel";
import PillPanel from "@/components/app/PillPanel";
import AnchorRail from "@/components/app/AnchorRail";
import PropRow from "@/components/app/PropRow";
import TechSection from "@/components/app/TechSection";
import WorkScheduleSection from "@/components/User/WorkScheduleSection";
import ClientTime from "@/components/app/ClientTime";
import { cn } from "@/lib/utils";

import { AuthedUserContext } from "../../store/authed-user-context";
import useInitialPrefs from "../../store/prefs";
import { getPresence } from "./presence";
import PresenceText from "./PresenceText";
import SessionList from "./SessionList";
import ImpersonateDialog from "./ImpersonateDialog";
import { TwoFactorReset } from "./TwoFactorRow";
import { relativeDay } from "../../util/relative-time";
import { formatDate, formatShortDate } from "../../util/format-date";
import { formatPrice } from "../../util/format-string";

import CardAvatar from "./CardAvatar";
import ResetPasswordDialog from "./ResetPasswordDialog";
import ToggleActiveDialog from "./ToggleActiveDialog";
import LinkAdDialog from "./LinkAdDialog";
import { useCan, usePermissionCatalogue } from "@/store/authed-user";

const ticketState = (state) =>
  state === "Новая" || state === "Не в работе"
    ? "text-warning"
    : state === "В работе"
      ? "text-info"
      : "text-faint";
const ticketDot = (state) =>
  state === "Новая" || state === "Не в работе"
    ? "bg-warning"
    : state === "В работе"
      ? "bg-info"
      : "bg-faint";

const StatusText = ({ on, onText = "Подключён", offText = "Не подключён" }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 text-sm font-semibold",
      on ? "text-accent-text" : "text-faint",
    )}
  >
    <span
      className={cn("size-2 rounded-full", on ? "bg-primary" : "bg-faint")}
    />
    {on ? onText : offText}
  </span>
);

const Pill = ({ children }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent px-2.5 py-1 text-sm font-medium text-muted-foreground">
    {children}
  </span>
);

// Способность (выданная — бирюзовая галочка, отсутствующая — приглушённый крест)
const Cap = ({ on, children }) => (
  <div
    className={cn(
      "flex items-center gap-2 py-0.5 text-sm",
      on ? "text-foreground" : "text-faint",
    )}
  >
    {on ? (
      <RiCheckLine className="size-4 flex-none text-primary" />
    ) : (
      <RiCloseLine className="size-4 flex-none text-faint" />
    )}
    {children}
  </div>
);

const ViewUser = ({ user, tickets }) => {
  // Сброс фактора меняет карточку — перечитываем загрузчик, иначе строка
  // осталась бы «Включён» до перезагрузки страницы.
  const revalidator = useRevalidator();
  const authedUser = useContext(AuthedUserContext);
  const can = useCan();
  const catalogue = usePermissionCatalogue();
  const canManageUsers = can({ user: ["manage"] });
  // Правка финансов — та же форма пользователя, но секция под своим правом
  // (как в UserForm): без него карандаш вёл бы в форму, где секции нет
  const canEditFinances =
    canManageUsers && Boolean(can({ report: ["employees"] }));
  // Пароли, сеансы и второй фактор — это ДОСТУП, а не карточка человека:
  // право своё, и кнопки показываем по нему, иначе сервер отобьёт нажатие.
  const canManageUserAccess = can({ user: ["manageAccess"] });
  const canManageCompanies = can({ company: ["manage"] });
  // Вход под пользователем — своё право, а не следствие управления людьми.
  const canImpersonate = can({ user: ["impersonate"] });
  const { modules: appModules } = useInitialPrefs();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [toggleOpen, setToggleOpen] = useState(false);
  const [adOpen, setAdOpen] = useState(false);
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [tfResetOpen, setTfResetOpen] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const {
    firstName,
    lastName,
    email,
    phone,
    position,
    company,
    subdivision,
    clientTimezone,
    categories = [],
    responsibleForCompanies = [],
    isEndUser,
    isServiceAccount,
    isCloudTelephony,
    isAdmin,
    banned,
    twoFactorEnabled,
    banReason,
    banExpires,
    telegramBot,
    getScreen,
    activeDirectoryObjectGUID,
    finances,
    statements = {},
    roles = [],
    notify,
    lastLogin,
    invitedAt,
    lastActivityAt,
    createdAt,
  } = user;

  const fullName = `${lastName || ""} ${firstName || ""}`.trim() || "—";
  // Как человек назовётся в крошке компании или заявки, куда ведут ссылки
  const fromState = useCrumbFrom(fullName);
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

  // Разделы прав — из общего каталога с сервера. Показываем только ВЫДАННОЕ:
  // «что человек может»; полный список с отказами живёт в форме роли.
  const GROUP_ICONS = {
    tickets: <RiTicket2Line />,
    ticketCatalogs: <RiSettings4Line />,
    knowledge: <RiPriceTag3Line />,
    work: <RiTimeLine />,
    reports: <RiMoneyDollarCircleLine />,
    inventory: <RiHardDrive2Line />,
  };
  const hasAction = (id) => {
    const [resource, action] = id.split(".");
    return Boolean(statements?.[resource]?.includes(action));
  };
  const permissionGroups = catalogue
    .map((group) => ({
      label: group.label,
      icon: GROUP_ICONS[group.key],
      caps: group.actions.filter((action) => hasAction(action.id)),
    }))
    .filter((group) => group.caps.length);

  const notifyRows = notify
    ? [
        {
          label: "Новая заявка",
          tg: notify.byTelegram?.newTicket,
          em: notify.byEmail?.newTicket,
        },
        // Ответственным по заявке бывает только сотрудник — клиенту строка
        // ни о чём
        ...(isEndUser
          ? []
          : [
              {
                label: "Статус ответственного",
                tg: notify.byTelegram?.respStateUpdate,
                em: notify.byEmail?.respStateUpdate,
              },
            ]),
        {
          label: "Изменение статуса заявки",
          tg: notify.byTelegram?.ticketStateUpdate,
          em: notify.byEmail?.ticketStateUpdate,
        },
        {
          label: "Изменения срока выполнения",
          tg: notify.byTelegram?.ticketDeadlineUpdate,
          em: notify.byEmail?.ticketDeadlineUpdate,
        },
        {
          label: "Новые комментарии",
          tg: notify.byTelegram?.ticketNewComment,
          em: notify.byEmail?.ticketNewComment,
        },
        {
          label: "Запланированные работы",
          tg: notify.byTelegram?.scheduledWorks,
          em: notify.byEmail?.scheduledWorks,
        },
      ]
    : [];
  const tgConnected = Boolean(telegramBot?.isActive);

  // Клиенту каталог модулей не применим, но одно право у него штатное —
  // «все заявки своей компании»; секцию показываем и ему
  const showPermissions = canManageUsers && !isServiceAccount;
  const showNotify = canManageUsers && Boolean(notify);

  // Техника (список + окружение) — при активном модуле инвентаря и праве на
  // него; служебным аккаунтам рабочее место не положено.
  const showTech =
    !isServiceAccount &&
    !isCloudTelephony &&
    Boolean(appModules?.inventory?.isActive) &&
    Boolean(can({ device: ["read"] }));

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
    ...(categories.length > 0
      ? [{ id: "categories", label: "Категории" }]
      : []),
    ...(responsibleForCompanies.length > 0
      ? [{ id: "responsible", label: "Ответственность" }]
      : []),
    ...(canSeeFinances ? [{ id: "finances", label: "Финансы" }] : []),
    ...(showPermissions
      ? [{ id: "permissions", label: "Права и доступ" }]
      : []),
    ...(showNotify ? [{ id: "notifications", label: "Уведомления" }] : []),
  ];

  return (
    // max-w-5xl: рейл 192px + зазор 28px + колонка секций ≈ 804px
    <div className="mx-auto w-full max-w-5xl">
      <Crumbs />

      {/* HERO */}
      <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
        <CardAvatar
          user={user}
          ringColor={presence.ringColor}
          canEdit={canManageUsers}
        />
        <div className="min-w-0 flex-1">
          <h1 className="my-0 text-2xl leading-tight font-semibold tracking-tight break-words">
            {fullName}
          </h1>
          {position && (
            <div className="mt-1 text-base text-muted-foreground">
              {position}
            </div>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            {presence.visible && (
              <PresenceText presence={presence} className="font-semibold" />
            )}
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <RiVipCrownLine className="size-4 text-faint" />
              {accountType}
              {isAdmin && (
                <span className="text-accent-text">· Администратор</span>
              )}
            </span>
            {company?.alias && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <RiBuilding2Line className="size-4 text-faint" />
                <Link
                  to={`/companies/${company._id}`}
                      state={fromState}
                  className="text-accent-text no-underline hover:underline"
                >
                  {company.alias}
                </Link>
                {subdivision?.name && (
                  <span className="text-faint">· {subdivision.name}</span>
                )}
              </span>
            )}
            {banned && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-destructive">
                <span className="size-2 rounded-full bg-destructive" />
                Отключён
                {/* Причина и срок читаются в той же строке, что и сам факт:
                    отдельная плашка ниже требовала бы её искать, а вопрос
                    «за что и до каких пор» возникает сразу за «отключён». */}
                {(banReason || banExpires) && (
                  <span className="font-normal text-muted-foreground">
                    ·{" "}
                    {[
                      banReason,
                      banExpires ? `до ${formatDate(banExpires)}` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
        {canManageUsers && (
          /* На мобильном имя не делит строку с кнопками (flex-basis имени — 0,
             перенос сам не случается, и длинное имя уезжает под кнопки):
             блок действий занимает свою строку во всю ширину, с sm — как был */
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
                {!isServiceAccount && canManageUserAccess && (
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
                {/* Под администратором и под служебной учёткой войти нельзя —
                    пункт не показываем вовсе: погашенный он только просил бы
                    объяснений. Отключённая учётка сеанса тоже не даёт. */}
                {canImpersonate &&
                  !isServiceAccount &&
                  !isAdmin &&
                  !banned &&
                  !isSelf && (
                    <DropdownMenuItem
                      onSelect={() => setImpersonateOpen(true)}
                    >
                      <RiSpyLine /> Войти под пользователем
                    </DropdownMenuItem>
                  )}
                <DropdownMenuItem onSelect={() => setToggleOpen(true)}>
                  {banned ? <RiUserFollowLine /> : <RiUserUnfollowLine />}
                  {banned ? "Включить" : "Отключить"}
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
          {/* mt-6 — под встроенный отступ первой метки секции (Eyebrow),
              иначе рейл висит выше заголовка «Контакты и доступ» */}
          <AnchorRail
            sections={railSections}
            ariaLabel="Разделы карточки"
            className="mt-6"
          />
        </BrowserView>
        <div className="min-w-0 flex-1">
          {/* Контакты и доступ */}
          <Eyebrow id="contacts">Контакты и доступ</Eyebrow>
          <Panel>
            <PropRow
              icon={<RiMailLine size={17} />}
              label="Почта"
              copy={email ? { value: email, label: "Почта" } : undefined}
            >
              {email ? (
                <a
                  href={`mailto:${email}`}
                  className="text-accent-text no-underline hover:underline"
                >
                  {email}
                </a>
              ) : (
                <span className="font-normal text-faint">—</span>
              )}
            </PropRow>
            <PropRow
              icon={<RiPhoneLine size={17} />}
              label="Телефон"
              copy={phone ? { value: phone, label: "Телефон" } : undefined}
            >
              {phone ? (
                <a
                  href={`tel:${phone}`}
                  className="text-accent-text no-underline tabular-nums hover:underline"
                >
                  {phone}
                </a>
              ) : (
                <span className="font-normal text-faint">—</span>
              )}
            </PropRow>
            <PropRow icon={<RiTelegramLine size={17} />} label="Telegram-бот">
              <StatusText on={tgConnected} />
            </PropRow>
            <PropRow
              icon={<RiShieldCheckLine size={17} />}
              label="Active Directory"
            >
              <StatusText on={adLinked} onText="Связан" offText="Не связан" />
            </PropRow>
            {/* Ключ PRO32 Connect есть только у сотрудников — он подключает
                к машине клиента того, кто нажал кнопку в заявке */}
            {!isEndUser && !isServiceAccount && (
              <PropRow
                icon={<RiRemoteControlLine size={17} />}
                label="PRO32 Connect"
              >
                <StatusText
                  on={Boolean(getScreen?.hasApi)}
                  onText="Подключён"
                  offText="Не подключён"
                />
              </PropRow>
            )}
          </Panel>

          {/* Организация + Активность */}
          <div id="org" className="mt-6 grid gap-4 scroll-mt-28 md:grid-cols-2">
            <div>
              <SubLabel>Организация</SubLabel>
              <Panel>
                <PropRow icon={<RiBuilding2Line size={17} />} label="Компания">
                  {company?.alias ? (
                    <Link
                      to={`/companies/${company._id}`}
                      state={fromState}
                      className="text-accent-text no-underline hover:underline"
                    >
                      {company.alias}
                    </Link>
                  ) : (
                    <span className="font-normal text-faint">—</span>
                  )}
                </PropRow>
                <PropRow icon={<RiGroupLine size={17} />} label="Подразделение">
                  {subdivision?.name ? (
                    <span>
                      {subdivision.name}
                      {managerName && (
                        <span className="font-normal text-faint">
                          {" · рук. "}
                          <Link
                            to={`/users/${subdivision.manager._id}`}
                      state={fromState}
                            className="text-accent-text no-underline hover:underline"
                          >
                            {managerName}
                          </Link>
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="font-normal text-faint">—</span>
                  )}
                </PropRow>
                {/* Эффективный пояс: где человек находится сейчас — чтобы не
                звонить заявителю в его ночь. Показываем всегда, в том числе
                унаследованный от подразделения или компании */}
                {clientTimezone?.timezone && (
                  <PropRow icon={<RiTimeLine size={17} />} label="Часовой пояс">
                    <span className="inline-flex flex-wrap items-center gap-x-2">
                      <ClientTime clientTimezone={clientTimezone} always />
                      {clientTimezone.source !== "user" && (
                        <span className="font-normal text-faint">
                          {clientTimezone.source === "subdivision"
                            ? `как у «${clientTimezone.sourceName}»`
                            : clientTimezone.source === "company"
                              ? "как у компании"
                              : "как в организации"}
                        </span>
                      )}
                    </span>
                  </PropRow>
                )}
              </Panel>
            </div>
            <div>
              <SubLabel>Активность</SubLabel>
              <Panel>
                <PropRow
                  icon={<RiLoginCircleLine size={17} />}
                  label="Последний вход"
                >
                  {lastLogin ? (
                    <span className="tabular-nums">
                      {formatDate(lastLogin)}
                    </span>
                  ) : invitedAt ? (
                    /* «Никогда» не отвечает на вопрос, который тут возникает:
                       дошло ли приглашение. Из 98 заведённых за год учёток 76
                       не входили ни разу, и узнать об этом было неоткуда. */
                    <span className="font-normal text-warning">
                      ни разу · приглашён{" "}
                      <span className="tabular-nums">
                        {relativeDay(invitedAt) || formatDate(invitedAt)}
                      </span>
                    </span>
                  ) : (
                    <span className="font-normal text-faint">никогда</span>
                  )}
                </PropRow>
                <PropRow
                  icon={<RiTicket2Line size={17} />}
                  label="Последняя заявка"
                >
                  {relativeDay(lastActivityAt) ? (
                    <span className="tabular-nums">
                      {relativeDay(lastActivityAt)}
                    </span>
                  ) : (
                    <span className="font-normal text-faint">
                      нет обращений
                    </span>
                  )}
                </PropRow>
                <PropRow icon={<RiTimeLine size={17} />} label="В системе с">
                  <span className="tabular-nums">
                    {formatShortDate(createdAt) || "—"}
                  </span>
                </PropRow>
              </Panel>
            </div>
          </div>

          {/* Техника: список с фасетами + окружение (общая шторка устройства) */}
          {showSchedule && (
            /* version — отметка последней правки пользователя: форма сохранила
           график, роутер ревалидировал loader, секция перечитала данные */
            <WorkScheduleSection
              id="schedule"
              userId={user._id}
              version={user.updatedAt}
            />
          )}

          {showTech && (
            <TechSection
              id="tech"
              userId={user._id}
              subject="user"
              from={fullName}
            />
          )}

          {/* Недавние заявки */}
          <Eyebrow id="tickets" count={ticketList.length}>
            Недавние заявки
          </Eyebrow>
          <Panel>
            {ticketList.length > 0 ? (
              <>
                <div className="flex flex-col">
                  {ticketList.slice(0, 8).map((ticket) => (
                    <Link
                      key={ticket._id}
                      to={`/tickets/${ticket.num}`}
                      state={fromState}
                      className="flex items-center gap-3 border-t border-border-soft py-2.5 text-foreground no-underline first:border-t-0 hover:bg-accent/40"
                    >
                      <span className="w-16 flex-none text-sm font-semibold text-accent-text tabular-nums">
                        №{ticket.num}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {ticket.title}
                      </span>
                      <span className="flex-none text-xs text-faint tabular-nums">
                        {formatShortDate(ticket.createdAt)}
                      </span>
                      <span
                        className={cn(
                          "inline-flex flex-none items-center gap-1.5 text-xs font-semibold",
                          ticketState(ticket.state),
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            ticketDot(ticket.state),
                          )}
                        />
                        {ticket.state}
                      </span>
                    </Link>
                  ))}
                </div>
                {ticketList.length > 8 && (
                  <Link
                    to={`/tickets?applicant=${user._id}`}
                    className="mt-3 inline-block text-sm font-semibold text-accent-text no-underline hover:underline"
                  >
                    Все заявки ({ticketList.length}) →
                  </Link>
                )}
              </>
            ) : (
              <div className="py-2 text-sm text-muted-foreground">
                Заявок пока нет.
              </div>
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
            <Section>
              <Eyebrow
                id="finances"
                action={
                  canEditFinances ? (
                    <SectionEditLink to="update#finances" label="Финансы" />
                  ) : undefined
                }
              >
                Финансы
              </Eyebrow>
              <Panel>
                <PropRow
                  icon={<RiMoneyDollarCircleLine size={17} />}
                  label="Оклад"
                >
                  {finances.salary != null ? (
                    `${formatPrice(finances.salary)}/мес`
                  ) : (
                    <span className="font-normal text-faint">не задан</span>
                  )}
                </PropRow>
                <PropRow
                  icon={<RiTimeLine size={17} />}
                  label="Ставка переработок"
                >
                  {finances.overtimeHourlyRate != null ? (
                    `${formatPrice(finances.overtimeHourlyRate)}/час`
                  ) : (
                    <span className="font-normal text-faint">не задана</span>
                  )}
                </PropRow>
              </Panel>
            </Section>
          )}

          {/* Права и доступ (для управляющих пользователями) */}
          {showPermissions && (
            <>
              <Eyebrow id="permissions">Права и доступ</Eyebrow>
              {/* Две панели одной секции — с зазором, иначе сливаются в одну */}
              <div className="flex flex-col gap-4">
                <Panel>
                  {/* Тип аккаунта здесь не повторяем — он в шапке карточки
                      (вместе с «· Администратор»): с чипом типа и ролью
                      «Клиент» слово стояло на карточке трижды. Панель отвечает
                      на один вопрос — какие роли и что они дают. Откуда права:
                      список ниже — следствие ролей, и без них он читается как
                      набор, взявшийся ниоткуда. */}
                  <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Роли:</span>
                    {roles.length ? (
                      roles.map((role) => <Pill key={role.key}>{role.title}</Pill>)
                    ) : (
                      <span className="text-faint">не назначены</span>
                    )}
                  </div>
                  {permissionGroups.length === 0 ? (
                    <div className="py-0.5 text-sm text-faint">
                      Нет выданных прав
                    </div>
                  ) : (
                    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                      {permissionGroups.map((group) => (
                        <div key={group.label}>
                          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                            <span className="text-muted-foreground [&_svg]:size-4">
                              {group.icon}
                            </span>
                            {group.label}
                          </div>
                          {group.caps.map((cap) => (
                            <Cap key={cap.id} on>
                              {cap.label}
                            </Cap>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>

                {/* Где эта учётная запись открыта прямо сейчас. Отдельной
                    панелью, а не внутри прав: права отвечают «что можно»,
                    сеансы — «откуда заходят», и объединять их незачем. */}
                <Panel>
                  <div className="mb-4 flex flex-wrap items-center gap-2.5">
                    <span className="text-sm font-medium">
                      Вход по коду из приложения
                    </span>
                    <span
                      className={
                        twoFactorEnabled
                          ? "rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-accent-text"
                          : "rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-muted-foreground"
                      }
                    >
                      {twoFactorEnabled ? "Включён" : "Выключен"}
                    </span>
                    {twoFactorEnabled && canManageUserAccess && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto"
                        onClick={() => setTfResetOpen(true)}
                      >
                        Сбросить
                      </Button>
                    )}
                  </div>
                  {/* Завершать чужие сеансы может тот же, кто распоряжается
                      доступом; остальным список показываем только на чтение. */}
                  <SessionList
                    userId={user._id}
                    canRevoke={canManageUserAccess}
                  />
                </Panel>
              </div>
            </>
          )}

          {/* Уведомления (для управляющих пользователями) */}
          {showNotify && (
            <Section>
              <Eyebrow
                id="notifications"
                action={
                  <SectionEditLink
                    to="update#notifications"
                    label="Уведомления"
                  />
                }
              >
                Уведомления
              </Eyebrow>
              <Panel>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs font-bold tracking-wide text-faint uppercase">
                        <th className="py-2 text-left font-bold">Событие</th>
                        <th className="px-3 py-2 font-bold">
                          <span className="inline-flex items-center gap-1.5">
                            <RiTelegramLine className="size-4 text-muted-foreground" />{" "}
                            Telegram
                          </span>
                        </th>
                        <th className="px-3 py-2 font-bold">
                          <span className="inline-flex items-center gap-1.5">
                            <RiMailLine className="size-4 text-muted-foreground" />{" "}
                            Email
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {notifyRows.map((row) => (
                        <tr
                          key={row.label}
                          className="border-t border-border-soft"
                        >
                          <td className="py-2 font-medium">{row.label}</td>
                          <td className="px-3 py-2 text-center">
                            {row.tg && tgConnected ? (
                              <RiCheckLine className="mx-auto size-4.5 text-primary" />
                            ) : (
                              <RiCloseLine className="mx-auto size-4.5 text-faint" />
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {row.em ? (
                              <RiCheckLine className="mx-auto size-4.5 text-primary" />
                            ) : (
                              <RiCloseLine className="mx-auto size-4.5 text-faint" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!tgConnected && (
                  <p className="mt-3 mb-0 text-xs text-faint">
                    Telegram-бот не подключён — сообщения в Telegram не
                    отправляются.
                  </p>
                )}
              </Panel>
            </Section>
          )}
        </div>
      </div>

      {/* Диалоги */}
      <DeleteDialog
        item={{ ...user, title: fullName }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
      {!isServiceAccount && (
        <ResetPasswordDialog
          user={user}
          open={resetOpen}
          onOpenChange={setResetOpen}
        />
      )}
      <ToggleActiveDialog
        user={user}
        open={toggleOpen}
        onOpenChange={setToggleOpen}
      />
      {canManageCompanies && company && (
        <LinkAdDialog user={user} open={adOpen} onOpenChange={setAdOpen} />
      )}
      <TwoFactorReset
        user={user}
        open={tfResetOpen}
        onOpenChange={setTfResetOpen}
        onDone={() => revalidator.revalidate()}
      />
      {canImpersonate && (
        <ImpersonateDialog
          user={user}
          open={impersonateOpen}
          onOpenChange={setImpersonateOpen}
        />
      )}

      <FormOutlet />
    </div>
  );
};

export default ViewUser;
