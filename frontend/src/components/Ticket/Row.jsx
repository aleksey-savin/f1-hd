import { Fragment, useState } from "react";

import { Link } from "react-router";
import {
  RiDeleteBinLine,
  RiEdit2Line,
  RiMoreLine,
  RiRepeat2Line,
} from "react-icons/ri";

import { DeleteDialog } from "@/components/app/DeleteItem";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { formatDate } from "../../util/format-date";
import { formatMailSender, parseMailSender } from "../../util/mail-sender";
import { plural } from "../../util/plural";
import {
  TicketStateText,
  createdAge,
  deadlineText,
  isOverdue,
  ticketTone,
} from "./ticket-state";

// Строка списка заявок (макет «Читаемая строка заявки», 22.09). Жёсткие
// колонки, у каждой одна роль, все строки одной высоты: номер и дата создания ·
// тема и мета · ответственные · состояние и срок · «⋯». Две строки текста
// записи держатся вместе (16/24 и 14/20, зазор 8), воздух — между записями.
// Мобайл — три яруса: тема / компания и инициатор / номер, состояние и срок.
//
// Прежняя строка (60 px, четыре кегля, статус и срок лесенкой вправо, «создана
// сегодня» отдельной колонкой) сливалась в кашу — жалобы нескольких
// сотрудников. Что изменилось: дата создания ушла под номер и показывается,
// только если это не сегодня; компания в мете — основным цветом; ответственные
// — основным, а не приглушённым; состояние с глифом и срок 14 px — одной
// колонкой, выровненной влево; «N новых» — пилюля после темы, а не слово в мете.
//
// Категории в мете нет намеренно: она растягивала колонку и глушила тему —
// главное в строке. Категория осталась фильтром.
//
// Клик ведёт прямо на карточку — как в остальных списках приложения.
// Промежуточная шторка предпросмотра была отвергнута: заглянуть в заявку
// хотелось редко, а лишний щелчок на пути к карточке мешал каждый раз.
// Строка — настоящая ссылка, поэтому Cmd/Ctrl+клик и средний клик открывают её
// в новой вкладке. Чекбокс и «⋯» лежат снаружи ссылки: интерактивное внутри
// ссылки невалидно.
//
// Чекбокс выбора делит слот с точкой непрочитанного: перед номером 28 px, в
// покое там точка (или пусто), по наведению на её месте проявляется чекбокс, в
// режиме выбора он стоит постоянно. Номер и колонки не двигаются ни в одном
// состоянии. Прежняя схема — чекбокс поверх отступа и сдвиг номера на 24 px —
// отвергнута 22.09: чекбокс вставал в 8 px от цифр, а строка дёргалась на
// каждом наведении. Задержка 200 мс отсекает пролёт курсора. На мобилке
// наведения нет: чекбокс появляется только в режиме (долгий тап), и тогда
// содержимое строки сдвигается один раз, как в любом режиме правки.
//
// Регламентная заявка помечена в мете строки — глиф и слово «регламент» перед
// компанией: это вид записи, то есть вторичный факт, и живёт он рядом с
// остальными вторичными фактами. Глиф у номера отвергнут: читался как случайный
// символ, приклеенный к числу; глиф у темы — сдвигал заголовки регламентных
// строк относительно остальных.

// 1 ответственный — полное имя, несколько — «Фамилия И.» через запятую
const responsibleNames = (responsibles) => {
  if (!responsibles?.length) return "";
  if (responsibles.length === 1) {
    const { lastName, firstName } = responsibles[0];
    return `${lastName || ""} ${firstName || ""}`.trim();
  }
  return responsibles
    .map(({ lastName, firstName }) =>
      `${lastName || ""} ${firstName ? `${firstName[0]}.` : ""}`.trim(),
    )
    .join(", ");
};

// Не флекс: иконка стоит в строчном потоке меты и садится на её базовую линию
// (у флекса базовая линия взялась бы от svg — см. TicketStateText)
const RoutineMark = () => (
  <span title="Создана регламентом">
    <RiRepeat2Line
      size={14}
      aria-hidden
      className="me-1 inline-block align-[-0.125em]"
    />
    регламент
  </span>
);

const TicketRow = ({
  ticket,
  selectable,
  selectionActive,
  isSelected,
  onToggle,
  pressProps,
  consumeSuppressedClick,
  canEdit,
  canDelete,
  /** Список сгруппирован по состоянию — статус несёт заголовок группы,
   *  в строке остаётся только срок. */
  showState = true,
}) => {
  const [deleteOpen, setDeleteOpen] = useState(false);

  const {
    num,
    title,
    company,
    applicant,
    realSender,
    responsibles,
    createdAt,
    deadline,
    routineTask,
    unread,
  } = ticket;

  const state = ticketTone(ticket);
  const overdue = isOverdue(ticket);
  // Непрочитанное считает сервер (services/ticketUnread): точка у номера и
  // тема полужирным — у заявки, где что-то случилось с моего последнего
  // визита; «N новых» — чужие комментарии с тех пор. Прочитанная строка не
  // несёт ничего: в списке показываем только исключения
  const unseen = Boolean(unread?.isUnseen);
  const newComments = unread?.newComments ?? 0;
  // Дата создания — под номером и только если это не сегодня: под сортировкой
  // «Сначала новые» колонка «создана сегодня» повторяла одно и то же
  const age = createdAge(createdAt);

  const applicantName = applicant
    ? `${applicant.lastName || ""} ${applicant.firstName || ""}`.trim()
    : formatMailSender(realSender) || realSender || "";
  // У заявки из письма адрес отправителя виден и в списке: неизвестного
  // клиента без подписи иначе не назвать (инициатор — служебная учётка).
  // Список только для сотрудников, поэтому гейта по зрителю здесь нет
  const mailAddress =
    ticket.source === "Почта" && applicant
      ? parseMailSender(realSender)?.address
      : null;
  // Мета — вторичные факты через « · »: вид записи (регламент), компания
  // основным цветом (второй по важности факт строки читается колонкой сверху
  // вниз), инициатор и адрес приглушённо
  const metaParts = [];
  if (routineTask) metaParts.push(<RoutineMark />);
  if (company?.alias) {
    metaParts.push(<span className="text-foreground">{company.alias}</span>);
  }
  if (applicantName) metaParts.push(applicantName);
  if (mailAddress) metaParts.push(mailAddress);
  const meta = metaParts.length
    ? metaParts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && " · "}
          {part}
        </Fragment>
      ))
    : "—";

  const responsibleText = responsibleNames(responsibles);
  const responsibleTitle = (responsibles ?? [])
    .map(({ lastName, firstName }) =>
      `${lastName || ""} ${firstName || ""}`.trim(),
    )
    .join(", ");

  const stateText = (size) => (
    <TicketStateText tone={state.tone} glyph={state.glyph} size={size}>
      {state.label}
    </TicketStateText>
  );

  const hasMenu = canEdit || canDelete;
  // Чекбокс виден без наведения: режим включён (или строка уже выбрана)
  const revealed = selectable && (selectionActive || isSelected);

  const handleOpen = (event) => {
    // Клик, сгенерированный сработавшим долгим тапом, до открытия не доходит
    if (consumeSuppressedClick?.()) {
      event.preventDefault();
      return;
    }
    if (selectionActive) {
      event.preventDefault();
      onToggle(ticket._id, { range: event.shiftKey });
      return;
    }
    // Дальше клик обрабатывает сама ссылка: обычный — переходом на карточку,
    // Cmd/Ctrl+клик и средний — открытием в новой вкладке
  };

  return (
    <div
      className={cn(
        "longpress-target group relative flex items-center transition-colors",
        "before:absolute before:top-0 before:right-5 before:left-5 before:h-px before:bg-border-soft first:before:hidden",
        isSelected ? "bg-primary/10" : "hover:bg-accent/60",
      )}
      {...(pressProps || {})}
    >
      {selectable && (
        // Переключаем по onClick, а не onCheckedChange: нужен shiftKey для
        // диапазона, а два обработчика дали бы двойное переключение.
        // Пока чекбокс скрыт, на таче он не ловит тапы у края строки — вход в
        // режим там долгий тап.
        <Checkbox
          checked={isSelected}
          aria-label={`Выбрать заявку ${num}`}
          onClick={(event) => onToggle(ticket._id, { range: event.shiftKey })}
          className={cn(
            "absolute start-4 top-1/2 z-10 -translate-y-1/2 transition-opacity md:start-5",
            revealed
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-85 group-hover:delay-200 focus-visible:opacity-100 focus-visible:delay-0 pointer-coarse:pointer-events-none",
          )}
        />
      )}

      {/* десктоп: точка непрочитанного в слоте перед номером — по центру того
          места, где проявится чекбокс; уступает ему, гаснув, а не сдвигаясь */}
      {unseen && (
        <span
          aria-hidden
          className={cn(
            "absolute start-6 top-1/2 hidden size-2 -translate-y-1/2 rounded-full bg-primary transition-opacity md:block",
            selectable &&
              (revealed
                ? "opacity-0"
                : "group-hover:opacity-0 group-hover:delay-200 group-has-[[data-slot=checkbox]:focus-visible]:opacity-0"),
          )}
        />
      )}

      <Link
        to={`/tickets/${num}`}
        onClick={handleOpen}
        className={cn(
          "flex min-w-0 flex-1 flex-col py-3.5 pe-2 text-foreground no-underline outline-none transition-[padding] hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50 md:flex-row md:items-start md:gap-6 md:py-4 md:ps-5",
          // мобайл в режиме выбора: содержимое уступает место чекбоксу
          revealed ? "ps-11" : "ps-5",
        )}
      >
        {/* десктоп: номер и дата создания; ps-7 — слот точки и чекбокса */}
        <span className="hidden w-19 flex-none ps-7 md:block">
          <span
            className="block text-sm leading-6 font-medium text-muted-foreground tabular-nums"
            title={createdAt ? `создана ${formatDate(createdAt)}` : undefined}
          >
            {num}
          </span>
          {age && (
            <span className="mt-2 block text-xs leading-5 text-faint tabular-nums">
              {age}
            </span>
          )}
        </span>

        {/* тема и мета. Потолок ширины — чтобы колонки начинались на одном
            месте сразу за метой, а не уезжали к правому краю при короткой теме */}
        <span className="min-w-0 flex-1 md:max-w-[40rem]">
          <span className="flex h-6 items-center gap-2">
            <span
              className={cn(
                "min-w-0 truncate text-base leading-6",
                unseen ? "font-semibold" : "font-medium",
              )}
            >
              {title}
            </span>
            {newComments > 0 && (
              <span className="inline-flex h-5 flex-none items-center rounded-md bg-primary/15 px-1.75 text-xs font-semibold whitespace-nowrap text-accent-text">
                {newComments} {plural(newComments, "новый", "новых", "новых")}
              </span>
            )}
          </span>
          <span className="mt-1.5 block truncate text-sm text-muted-foreground md:mt-2">
            {meta}
          </span>
        </span>

        {/* мобайл: номер, состояние и срок */}
        <span className="mt-2 flex items-center gap-1.5 text-xs leading-5 text-faint tabular-nums md:hidden">
          {/* Точка внутри строчного span, а не первым флекс-ребёнком: у флекса
              базовая линия взялась бы от пустой точки (см. TicketStateText) */}
          <span className="font-medium">
            {unseen && (
              <span
                aria-hidden
                className="me-1.5 inline-block size-2 rounded-full bg-primary align-middle"
              />
            )}
            {num}
          </span>
          {showState && (
            <>
              <span aria-hidden>·</span>
              {stateText("xs")}
            </>
          )}
          <span
            className={cn(
              "ms-auto flex-none",
              overdue && "font-medium text-destructive",
            )}
          >
            {deadlineText(deadline)}
          </span>
        </span>

        {/* десктоп: ответственные — основным цветом, два-три «Фамилия И.» без
            усечения; пусто — словами, а не прочерком */}
        <span
          className={cn(
            "hidden w-56 flex-none truncate text-sm leading-6 lg:block",
            !responsibleText && "text-faint",
          )}
          title={responsibleTitle || undefined}
        >
          {responsibleText || "не назначена"}
        </span>

        {/* десктоп: состояние и срок — одной колонкой, влево. Просрочку несёт
            красный срок, статус при этом не подменяется */}
        <span className="hidden w-44 flex-none md:block">
          {showState && <span className="block h-6 leading-6">{stateText("sm")}</span>}
          <span
            className={cn(
              "block text-sm leading-5 whitespace-nowrap tabular-nums",
              showState && "mt-2",
              overdue ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            {deadlineText(deadline)}
          </span>
        </span>
      </Link>

      {/* «⋯» — идиома строки списка приложения; состав тот же, что был в
          легаси-меню «Действия». Гнездо с воздухом от края и приглушённым, а не
          блёклым глифом: в узком гнезде «⋯» не замечали. В режиме выбора
          гаснет — строка там переключает выбор, а не открывает меню */}
      <span className="flex w-14 flex-none justify-center pe-3 md:pe-4">
        {hasMenu && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Действия"
                title="Действия"
                className={cn(
                  "text-muted-foreground",
                  selectionActive
                    ? "pointer-events-none opacity-0"
                    : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100",
                )}
              >
                <RiMoreLine />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && (
                <DropdownMenuItem asChild>
                  <Link to={`/tickets/update/${num}`}>
                    <RiEdit2Line /> Изменить
                  </Link>
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  <RiDeleteBinLine /> Удалить
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </span>

      {/* Диалог удаления — вне radix-меню: меню размонтирует содержимое при
          закрытии (идиома app/ListRow) */}
      {canDelete && (
        <DeleteDialog
          item={{ _id: ticket._id, title: `Заявка ${num}` }}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}
    </div>
  );
};

export default TicketRow;
