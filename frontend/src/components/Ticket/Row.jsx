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
import useOffcanvasStore from "@/store/offcanvas";

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
// край: чекбокс · номер · тема и мета · ответственные · создана · состояние и
// срок · «⋯». Мобайл — три яруса: номер, возраст и состояние / тема / компания,
// инициатор и срок.
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
  const offcanvas = useOffcanvasStore();
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
  const meta = [company?.alias, applicantName].filter(Boolean).join(" · ");

  const hasMenu = canEdit || canDelete;

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
      {/* Жёлоб чекбокса: место занято всегда, иначе строка дёргается по
          наведению, а правый край списка перестаёт быть ровным */}
      {selectable && (
        <span className="flex w-9 flex-none justify-center ps-4 md:ps-5">
          {/* Переключаем по onClick, а не onCheckedChange: нужен shiftKey для
              диапазона, а два обработчика дали бы двойное переключение */}
          <Checkbox
            checked={isSelected}
            aria-label={`Выбрать заявку № ${num}`}
            onClick={(event) => onToggle(ticket._id, { range: event.shiftKey })}
            className={cn(
              "transition-opacity",
              selectionActive || isSelected
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-60 focus-visible:opacity-100",
            )}
          />
        </span>
      )}

      <Link
        to={`/tickets/${num}`}
        onClick={handleOpen}
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-0.5 py-3 pe-2 text-foreground no-underline outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50 md:flex-row md:items-center md:gap-4 md:py-2.5",
          selectable ? "ps-2" : "ps-4 md:ps-5",
        )}
      >
        {/* мобайл: номер, возраст и состояние */}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums md:hidden">
          № {num}
          {routineTask && (
            <RiRepeat2Line
              size={12}
              aria-label="Создана регламентом"
              className="text-faint"
            />
          )}
          <span className="text-faint">· {createdShort(createdAt)}</span>
          <TicketStateText tone={state.tone} className="ms-auto text-xs">
            {state.label}
          </TicketStateText>
        </span>

        {/* десктоп: номер */}
        <span className="hidden w-16 flex-none items-center gap-1 font-medium text-muted-foreground tabular-nums md:flex">
          {num}
          {routineTask && (
            <RiRepeat2Line
              size={13}
              aria-label="Создана регламентом"
              title="Создана регламентом"
              className="text-faint"
            />
          )}
        </span>

        {/* тема и мета — всегда двумя строками */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base leading-tight font-medium">{title}</span>
          <span className="hidden truncate text-sm text-muted-foreground md:block">
            {meta || "—"}
          </span>
        </span>

        {/* десктоп: ответственные */}
        <span className="hidden w-36 flex-none truncate text-sm text-muted-foreground lg:block">
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
          <span className="min-w-0 truncate">{meta || "—"}</span>
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
          легаси-меню «Действия» */}
      <span className="flex w-9 flex-none justify-center pe-2 md:pe-3">
        {hasMenu && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Действия"
                title="Действия"
                className="text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
              >
                <RiMoreLine />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && (
                <DropdownMenuItem asChild>
                  <Link
                    to={`/tickets/${num}/update`}
                    onClick={offcanvas.setShow}
                  >
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
