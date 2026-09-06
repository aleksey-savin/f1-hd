import { useState } from "react";

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
import {
  TicketStateText,
  createdShort,
  createdText,
  deadlineText,
  isOverdue,
  ticketTone,
} from "./ticket-state";

// Строка списка заявок. Жёсткие колонки, все строки одной высоты, ровный правый
// край: номер · тема и мета · ответственные · создана · состояние и срок · «⋯».
// Мобайл — три яруса: номер, возраст и состояние / тема / компания, инициатор
// и срок.
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
// Чекбокс выбора живёт без своего жёлоба: он лежит поверх штатного отступа
// строки (20 px, как у любого списка), по наведению проявляется, а номер
// сдвигается на 24 px, освобождая место, — тема и остальные колонки стоят.
// Задержка 200 мс отсекает пролёт курсора: номера не дёргаются, пока человек
// просто ведёт мышь вниз по списку. В режиме выбора сдвиг делается один раз для
// всех строк и держится до выхода. На мобилке наведения нет: чекбокс появляется
// только в режиме (долгий тап), и тогда сдвигается всё содержимое строки, как в
// любом режиме правки. Резервный жёлоб под чекбокс отвергнут: он читался как
// пустой отступ в начале каждой строки.
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
const RoutineMark = ({ size }) => (
  <span title="Создана регламентом">
    <RiRepeat2Line
      size={size}
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
  } = ticket;

  const state = ticketTone(ticket);
  const overdue = isOverdue(ticket);

  const applicantName = applicant
    ? `${applicant.lastName || ""} ${applicant.firstName || ""}`.trim()
    : realSender || "";
  const metaText = [company?.alias, applicantName].filter(Boolean).join(" · ");
  const meta = (iconSize) =>
    routineTask ? (
      <>
        <RoutineMark size={iconSize} />
        {metaText && ` · ${metaText}`}
      </>
    ) : (
      metaText || "—"
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
          aria-label={`Выбрать заявку № ${num}`}
          onClick={(event) => onToggle(ticket._id, { range: event.shiftKey })}
          className={cn(
            "absolute start-4 top-1/2 z-10 -translate-y-1/2 transition-opacity md:start-5",
            revealed
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-85 group-hover:delay-200 focus-visible:opacity-100 focus-visible:delay-0 pointer-coarse:pointer-events-none",
          )}
        />
      )}

      <Link
        to={`/tickets/${num}`}
        onClick={handleOpen}
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-0.5 py-3 pe-2 text-foreground no-underline outline-none transition-[padding] hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50 md:flex-row md:items-center md:gap-4 md:py-2.5 md:ps-5",
          // мобайл в режиме выбора: содержимое уступает место чекбоксу
          revealed ? "ps-10" : "ps-4",
        )}
      >
        {/* мобайл: номер, возраст и состояние */}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums md:hidden">
          № {num}
          <span className="text-faint">· {createdShort(createdAt)}</span>
          <TicketStateText tone={state.tone} className="ms-auto text-xs">
            {state.label}
          </TicketStateText>
        </span>

        {/* десктоп: номер; уступает место чекбоксу сдвигом в своей колонке */}
        <span
          className={cn(
            "hidden w-[4.5rem] flex-none font-medium text-muted-foreground tabular-nums transition-transform md:block",
            selectable &&
              (revealed
                ? "translate-x-6"
                : "group-hover:translate-x-6 group-hover:delay-200 group-has-[[data-slot=checkbox]:focus-visible]:translate-x-6"),
          )}
        >
          {num}
        </span>

        {/* тема и мета — всегда двумя строками */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base leading-tight font-medium">
            {title}
          </span>
          <span className="hidden truncate text-sm text-muted-foreground md:block">
            {meta(14)}
          </span>
        </span>

        {/* десктоп: ответственные — два-три «Фамилия И.» без усечения */}
        <span className="hidden w-56 flex-none truncate text-sm text-muted-foreground lg:block">
          {responsibleNames(responsibles) || "—"}
        </span>

        {/* десктоп: создана */}
        <span
          className="hidden w-28 flex-none text-end text-xs text-faint whitespace-nowrap tabular-nums xl:block"
          title={createdAt ? `создана ${formatDate(createdAt)}` : undefined}
        >
          {createdText(createdAt)}
        </span>

        {/* десктоп: состояние и срок */}
        <span className="hidden w-40 flex-none flex-col items-end md:flex">
          <TicketStateText tone={state.tone}>{state.label}</TicketStateText>
          <span
            className={cn(
              "text-xs whitespace-nowrap tabular-nums",
              overdue ? "text-destructive" : "text-faint",
            )}
          >
            {deadlineText(deadline)}
          </span>
        </span>

        {/* мобайл: компания, инициатор и срок */}
        <span className="flex items-center gap-2 text-xs text-muted-foreground md:hidden">
          <span className="min-w-0 truncate">{meta(12)}</span>
          <span
            className={cn(
              "ms-auto flex-none tabular-nums",
              overdue ? "text-destructive" : "text-faint",
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
          item={{ _id: ticket._id, title: `Заявка № ${num}` }}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}
    </div>
  );
};

export default TicketRow;
