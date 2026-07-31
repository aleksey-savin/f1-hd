import { useContext, useState } from "react";

import { Link, useFetcher } from "react-router";
import DOMPurify from "dompurify";
import {
  RiBuilding2Line,
  RiCheckboxCircleLine,
  RiComputerLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiHistoryLine,
  RiMoreLine,
  RiPhoneLine,
  RiPriceTag3Line,
  RiTaxiLine,
  RiTeamLine,
  RiToolsLine,
  RiUserLine,
} from "react-icons/ri";

import ClientTime from "@/components/app/ClientTime";
import {
  Eyebrow,
  Panel,
  Section,
  SectionEditLink,
} from "@/components/app/Panel";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { AuthedUserContext } from "../../../store/authed-user-context";
import useInitialPrefsStore from "../../../store/prefs";
import { formatDate } from "../../../util/format-date";
import { openTaxi } from "../../../util/taxi-operators";
import { msToHMS } from "../../../util/time-helpers";
import { getTaxiAction } from "../../Company/company-links";
import WorkStatusText from "../../Company/WorkStatusText";
import { formatMoney } from "../../Report/work-format";
import { cn } from "@/lib/utils";

// Секции карточки заявки. Все они ТОЛЬКО показывают: правка — в форме заявки.
// Вход в неё — карандаш `app/SectionEditLink` в метке секции (проявляется по
// наведению на секцию — её оборачивает `app/Section`), а залитая «Изменить» на
// карточке одна, в шапке. Примитивы метки и панели — из каталога
// `app/Panel`, своих не заводим.

/**
 * Пустая секция — одна строка, а не плакат: пустых секций на карточке заявки
 * обычно несколько сразу (чек-лист, работы), и каждая, занимая
 * четверть экрана иллюстрацией, отодвигает вниз то, ради чего заявку открыли.
 *
 * Кнопок внутри нет: действие секции живёт в её метке, где бы оно ни
 * понадобилось — и когда секция пустая, и когда полная. Иначе «Добавить
 * чек-лист» стоит внутри панели, а «Добавить работу» — над ней, и глазу негде
 * закрепиться.
 */
export const EmptySection = ({ icon: Icon, hint }) => (
  <div className="tw:flex tw:items-center tw:gap-2.5 tw:text-sm tw:text-muted-foreground">
    <Icon size={16} aria-hidden className="tw:flex-none tw:text-faint" />
    <span className="tw:min-w-0 tw:flex-1">{hint}</span>
  </div>
);

/* ─────────────── Описание ─────────────── */

/**
 * Описание вместе с вложениями: файлы — часть описания проблемы, а не второй
 * предмет карточки (разбор — в шапке `View/AttachmentStrip`). Метка остаётся
 * «Описание», счётчик файлов живёт в самой ленте: в метке он считал бы текст
 * вместе с файлами.
 */
export const DescriptionSection = ({ ticket, attachments, uploadAction }) => {
  const [showOriginal, setShowOriginal] = useState(false);
  const clean = (html) => ({ __html: DOMPurify.sanitize(html) });

  return (
    <Section>
      <Eyebrow
        id="ticket-description"
        action={
          <>
            {ticket.htmlDescription && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => setShowOriginal(true)}
              >
                Оригинал письма
              </Button>
            )}
            {uploadAction}
          </>
        }
      >
        Описание
      </Eyebrow>
      <Panel>
        {ticket.description ? (
          // Описание бывает огромным (логи бэкапа на 33 000 знаков) —
          // ограничиваем высоту и скроллим внутри, чтобы не растягивать колонку.
          // Кегль крупнее остальных секций: это единственный текст на карточке,
          // который читают целиком, а не сканируют.
          <div
            className="md-doc tw:max-h-96 tw:overflow-auto tw:text-xl tw:leading-relaxed tw:break-words"
            dangerouslySetInnerHTML={clean(ticket.description)}
          />
        ) : (
          <p className="tw:my-0 tw:text-sm tw:text-muted-foreground">
            Нет описания
          </p>
        )}
        {attachments}
      </Panel>

      {ticket.htmlDescription && (
        <Dialog open={showOriginal} onOpenChange={setShowOriginal}>
          <DialogContent className="tw:sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Оригинал письма</DialogTitle>
            </DialogHeader>
            <div
              className="tw:max-h-[70dvh] tw:overflow-y-auto tw:text-sm"
              dangerouslySetInnerHTML={clean(ticket.htmlDescription)}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowOriginal(false)}>
                Закрыть
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Section>
  );
};

/* ─────────────── Заявка (свойства) ─────────────── */

const PropRow = ({ icon, label, children, action }) => (
  <div className="tw:flex tw:items-start tw:gap-3 tw:border-t tw:border-border-soft tw:py-2.5 tw:first:border-t-0 tw:first:pt-0">
    <span className="tw:grid tw:size-8 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-accent tw:text-muted-foreground">
      {icon}
    </span>
    <span className="tw:w-28 tw:flex-none tw:pt-1.5 tw:text-sm tw:text-muted-foreground">
      {label}
    </span>
    <span className="tw:min-w-0 tw:flex-1 tw:pt-1 tw:text-sm tw:leading-snug">
      {children || <span className="tw:text-faint">—</span>}
    </span>
    {action && <span className="tw:flex-none">{action}</span>}
  </div>
);

const Pill = ({ className, children }) => (
  <span
    className={cn(
      "tw:me-1.5 tw:mb-1.5 tw:inline-flex tw:items-center tw:rounded-full tw:border tw:border-border-soft tw:bg-accent tw:px-2.5 tw:py-0.5 tw:text-sm tw:font-medium",
      className,
    )}
  >
    {children}
  </span>
);

// Переход к связанной сущности: подчёркивание по наведению, а не всегда —
// строк-значений в «Деталях» много, и постоянные подчёркивания превратили бы
// панель в список ссылок
const EntityLink = ({ to, children }) => (
  <Link
    to={to}
    className="tw:font-medium tw:text-foreground tw:no-underline tw:hover:text-accent-text tw:hover:underline"
  >
    {children}
  </Link>
);

export const FactsSection = ({
  ticket,
  company,
  canEdit,
  onShowLogs,
  onEdit,
}) => {
  const { permissions } = useContext(AuthedUserContext);
  const { taxi } = useInitialPrefsStore();
  const applicant = ticket.applicant;
  const computer = applicant?.computer;

  // Два канала ИТ-специалиста: связаться с человеком или поехать на место.
  // Жили в шторке предпросмотра списка; шторку отменили — каналы переехали
  // сюда, к компании и инициатору, а не пропали.
  const taxiAction = ticket.company
    ? getTaxiAction(ticket.company, taxi?.operator)
    : null;

  return (
    <Section>
      <Eyebrow
        id="ticket-facts"
        action={
          canEdit && (
            <SectionEditLink to="update" label="Детали" onClick={onEdit} />
          )
        }
      >
        Детали
      </Eyebrow>
      <Panel>
        <PropRow
          icon={<RiBuilding2Line size={16} />}
          label="Компания"
          action={
            <>
              {taxiAction && (
                // Через openTaxi, а не голой ссылкой: он спрашивает текущее
                // положение и строит маршрут до офиса клиента
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title={taxiAction.title}
                  aria-label="Вызвать такси"
                  className="tw:text-warning tw:hover:text-warning"
                  onClick={() => openTaxi(taxiAction)}
                >
                  <RiTaxiLine />
                </Button>
              )}
              {onShowLogs && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Лог активности компании"
                  onClick={() => onShowLogs()}
                >
                  <RiHistoryLine />
                </Button>
              )}
            </>
          }
        >
          <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1">
            {/* Имя — ссылка на карточку: раньше из заявки нельзя было попасть ни
                к клиенту, ни к людям, и путь лежал через поиск в справочнике */}
            {ticket.company?._id ? (
              <EntityLink to={`/companies/${ticket.company._id}`}>
                {ticket.company.alias}
              </EntityLink>
            ) : (
              (ticket.company?.alias ?? "—")
            )}
            <ClientTime clientTimezone={ticket.clientTimezone} />
            <WorkStatusText
              workSchedule={company?.workSchedule}
              timezone={ticket.clientTimezone?.timezone}
            />
          </span>
        </PropRow>

        <PropRow
          icon={<RiUserLine size={16} />}
          label="Инициатор"
          action={
            <>
              {applicant?.phone && (
                <Button
                  asChild
                  variant="ghost"
                  size="icon-xs"
                  title={`Позвонить: ${applicant.phone}`}
                  aria-label="Позвонить инициатору"
                >
                  <a href={`tel:${applicant.phone}`}>
                    <RiPhoneLine />
                  </a>
                </Button>
              )}
              {onShowLogs &&
                permissions.canManageCompanies &&
                applicant?.activeDirectoryObjectGUID && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title="Лог активности пользователя"
                    onClick={() =>
                      onShowLogs(`${applicant.firstName} ${applicant.lastName}`)
                    }
                  >
                    <RiHistoryLine />
                  </Button>
                )}
            </>
          }
        >
          {applicant?._id ? (
            <EntityLink to={`/users/${applicant._id}`}>
              {`${applicant.lastName ?? ""} ${applicant.firstName ?? ""}`.trim()}
            </EntityLink>
          ) : (
            (applicant
              ? `${applicant.lastName ?? ""} ${applicant.firstName ?? ""}`.trim()
              : ticket.realSender)
          )}
          {applicant?.position && (
            <span className="tw:text-muted-foreground">
              {" · "}
              {applicant.position}
            </span>
          )}
        </PropRow>

        <PropRow icon={<RiTeamLine size={16} />} label="Ответственные">
          {ticket.responsibles?.length
            ? ticket.responsibles.map((user) => (
                <Link
                  key={user._id}
                  to={`/users/${user._id}`}
                  className="tw:no-underline"
                >
                  <Pill className="tw:hover:border-primary tw:hover:text-accent-text">
                    {user.lastName} {user.firstName}
                  </Pill>
                </Link>
              ))
            : null}
        </PropRow>

        <PropRow icon={<RiPriceTag3Line size={16} />} label="Категория">
          {ticket.category?.title}
          {/* Категорию подбирает ИИ в фоне при создании заявки — пока он думает,
              пустая строка выглядела бы как «категории нет» */}
          {!ticket.category?.title &&
            ticket.aiCategory?.status === "pending" && (
              <span className="tw:text-muted-foreground">
                ИИ подбирает категорию…
              </span>
            )}
        </PropRow>

        {computer?.name && (
          <PropRow icon={<RiComputerLine size={16} />} label="Компьютер">
            <span className="tw:font-mono tw:text-sm">{computer.name}</span>
            {computer.activeDirectoryLogin && (
              <span className="tw:text-muted-foreground">
                {" ("}
                {computer.activeDirectoryLogin}
                {")"}
              </span>
            )}
            {computer.lastSeenAt && (
              <span className="tw:block tw:text-xs tw:text-faint">
                вход {formatDate(computer.lastSeenAt)}
              </span>
            )}
          </PropRow>
        )}

        <PropRow icon={<RiHistoryLine size={16} />} label="Создана">
          <span className="tw:text-muted-foreground">
            {formatDate(ticket.createdAt)}
            {ticket.source ? ` · ${ticket.source}` : ""}
          </span>
        </PropRow>
      </Panel>
    </Section>
  );
};

/* ─────────────── Работы ─────────────── */

/**
 * Строка работы. Правка и удаление — в «⋯», как в строке списка: у работы их
 * два-три, и текстовые кнопки в каждой строке съели бы место под саму работу.
 * Удаляет автор работы или администратор — то же правило, что на бэкенде
 * (`controllers/work.js`), иначе кнопка обещает больше, чем разрешено.
 */
const WorkRow = ({ ticket, children, menu }) => (
  <div className="tw:group tw:flex tw:items-center tw:gap-3 tw:border-t tw:border-border-soft tw:py-2.5 tw:text-sm tw:first:border-t-0">
    {children}
    <span className="tw:flex tw:w-7 tw:flex-none tw:justify-end">
      {!ticket.isArchived && menu}
    </span>
  </div>
);

/**
 * Заглушка секции говорит про **это** состояние заявки: «без работ не закрыть»
 * у новой заявки — совет не по адресу, работы к ней ещё нельзя привязать.
 */
const emptyWorksHint = (ticket) => {
  if (ticket.state === "Новая")
    return "Работы можно указать после обработки заявки";
  if (ticket.state === "Не в работе")
    return "Работы можно указать, когда заявку примут в работу";
  if (ticket.isClosed || ticket.state === "Закрыта")
    return "Работы по заявке не указаны";
  return "Работ нет — без них заявку не закрыть";
};

const WorkMenu = ({ items }) => {
  if (!items.length) return null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Действия с работой"
          title="Действия"
          className="tw:text-faint tw:opacity-0 tw:group-hover:opacity-100 tw:focus-visible:opacity-100 tw:data-[state=open]:opacity-100 tw:pointer-coarse:opacity-100"
        >
          <RiMoreLine />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) =>
          item.to ? (
            <DropdownMenuItem key={item.key} asChild>
              <Link to={item.to} onClick={item.onClick}>
                {item.icon} {item.label}
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={item.key}
              variant={item.danger ? "destructive" : undefined}
              onSelect={item.onSelect}
            >
              {item.icon} {item.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const WorksSection = ({
  works = [],
  ticket,
  canAddWork,
  onOpenForm,
}) => {
  const { isAdmin, _id: userId } = useContext(AuthedUserContext);
  const [deleting, setDeleting] = useState(null);

  const finished = works.filter((work) => work.finishedAt);
  const scheduled = works.filter(
    (work) => !work.finishedAt && work.planningToStart,
  );

  const mayManage = (work) =>
    isAdmin || work.createdBy?._id?.toString() === userId?.toString();
  const mayConfirm = (work) =>
    isAdmin || work.executor?._id?.toString() === userId?.toString();

  const editItem = (to) => ({
    key: "update",
    to,
    onClick: onOpenForm,
    icon: <RiEdit2Line />,
    label: "Изменить",
  });
  const deleteItem = (work) => ({
    key: "delete",
    danger: true,
    onSelect: () => setDeleting(work),
    icon: <RiDeleteBinLine />,
    label: "Удалить",
  });

  // «Новая работа», а не «Добавить работу»: по словарю действий «Добавить» —
  // только привязка уже существующего
  const actions = canAddWork && (
    <>
      <Button asChild variant="outline" size="xs">
        <Link to="work/add" onClick={onOpenForm}>
          Новая работа
        </Link>
      </Button>
      <Button asChild variant="outline" size="xs">
        <Link to="work/schedule" onClick={onOpenForm}>
          Запланировать
        </Link>
      </Button>
    </>
  );

  return (
    <Section>
      <Eyebrow
        id="ticket-works"
        count={works.length || undefined}
        action={actions}
      >
        Работы
      </Eyebrow>
      <Panel>
        {works.length === 0 ? (
          <EmptySection icon={RiToolsLine} hint={emptyWorksHint(ticket)} />
        ) : (
          <div className="tw:-my-1">
            {scheduled.map((work) => (
              <WorkRow
                key={work._id}
                ticket={ticket}
                menu={
                  <WorkMenu
                    items={[
                      mayConfirm(work) && {
                        key: "confirm",
                        to: `work/${work._id}/confirm`,
                        onClick: onOpenForm,
                        icon: <RiCheckboxCircleLine />,
                        label: "Подтвердить",
                      },
                      mayManage(work) &&
                        editItem(`work-scheduled/${work._id}/update`),
                      mayManage(work) && deleteItem(work),
                    ].filter(Boolean)}
                  />
                }
              >
                <span className="tw:w-32 tw:flex-none tw:truncate tw:text-muted-foreground">
                  {work.executor?.lastName} {work.executor?.firstName?.[0]}.
                </span>
                <span className="tw:min-w-0 tw:flex-1 tw:truncate">
                  {work.visitRequired ? "Выезд" : "Удалённо"} ·{" "}
                  {formatDate(work.planningToStart)}
                </span>
                <span className="tw:flex-none tw:text-xs tw:text-muted-foreground">
                  запланировано
                </span>
              </WorkRow>
            ))}
            {finished.map((work) => (
              <WorkRow
                key={work._id}
                ticket={ticket}
                menu={
                  <WorkMenu
                    items={[
                      mayManage(work) && editItem(`work/${work._id}/update`),
                      mayManage(work) && deleteItem(work),
                    ].filter(Boolean)}
                  />
                }
              >
                <span className="tw:w-32 tw:flex-none tw:truncate tw:text-muted-foreground">
                  {work.finishedBy?.lastName} {work.finishedBy?.firstName?.[0]}.
                </span>
                <span className="tw:min-w-0 tw:flex-1 tw:truncate">
                  {work.visitRequired ? "Выезд" : "Удалённо"}
                  {work.description ? ` · ${work.description}` : ""}
                </span>
                {/* В списке показываем только исключение: у работы в рамках
                    тарифа поля outOfSchedule нет вовсе. Сумма — по тем же
                    правам, что и в форме (её решает сервер) */}
                {work.outOfSchedule && (
                  <span
                    className="tw:flex-none tw:text-xs tw:text-warning tw:tabular-nums"
                    title="Время вне графика обслуживания"
                  >
                    доп. оплата
                    {work.outOfSchedule.money
                      ? ` ${formatMoney(work.outOfSchedule.money.cost)}`
                      : ""}
                  </span>
                )}
                <span className="tw:flex-none tw:font-semibold tw:tabular-nums">
                  {msToHMS(
                    new Date(work.finishedAt) - new Date(work.startedAt),
                  )}
                </span>
              </WorkRow>
            ))}
          </div>
        )}
      </Panel>

      {/* Диалог — вне «⋯»: radix размонтирует содержимое меню при закрытии */}
      <DeleteWorkDialog
        work={deleting}
        ticketNum={ticket.num}
        onClose={() => setDeleting(null)}
      />
    </Section>
  );
};

const DeleteWorkDialog = ({ work, ticketNum, onClose }) => {
  const fetcher = useFetcher();

  return (
    <AlertDialog
      open={Boolean(work)}
      onOpenChange={(next) => !next && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить работу</AlertDialogTitle>
          <AlertDialogDescription>
            Работа исчезнет из заявки и из отчётов. Это действие нельзя
            отменить.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="tw:mt-4">
          <AlertDialogCancel type="button">Отмена</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={fetcher.state !== "idle"}
            onClick={() => {
              fetcher.submit(
                { intent: "deleteWork", workId: work._id },
                { method: "POST", action: `/tickets/${ticketNum}` },
              );
              onClose();
            }}
          >
            <RiDeleteBinLine /> Удалить
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
