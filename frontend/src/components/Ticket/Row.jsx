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
        "longpress-target tw:group tw:relative tw:flex tw:items-center tw:transition-colors",
        "tw:before:absolute tw:before:top-0 tw:before:right-5 tw:before:left-5 tw:before:h-px tw:before:bg-border-soft tw:first:before:hidden",
        isSelected ? "tw:bg-primary/10" : "tw:hover:bg-accent/60",
      )}
      {...(pressProps || {})}
    >
      {/* Жёлоб чекбокса: место занято всегда, иначе строка дёргается по
          наведению, а правый край списка перестаёт быть ровным */}
      {selectable && (
        <span className="tw:flex tw:w-9 tw:flex-none tw:justify-center tw:ps-4 tw:md:ps-5">
          {/* Переключаем по onClick, а не onCheckedChange: нужен shiftKey для
              диапазона, а два обработчика дали бы двойное переключение */}
          <Checkbox
            checked={isSelected}
            aria-label={`Выбрать заявку № ${num}`}
            onClick={(event) => onToggle(ticket._id, { range: event.shiftKey })}
            className={cn(
              "tw:transition-opacity",
              selectionActive || isSelected
                ? "tw:opacity-100"
                : "tw:opacity-0 tw:group-hover:opacity-60 tw:focus-visible:opacity-100",
            )}
          />
        </span>
      )}

      <Link
        to={`/tickets/${num}`}
        onClick={handleOpen}
        className={cn(
          "tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:gap-0.5 tw:py-3 tw:pe-2 tw:text-foreground tw:no-underline tw:outline-none tw:hover:text-foreground tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50 tw:md:flex-row tw:md:items-center tw:md:gap-4 tw:md:py-2.5",
          selectable ? "tw:ps-2" : "tw:ps-4 tw:md:ps-5",
        )}
      >
        {/* мобайл: номер, возраст и состояние */}
        <span className="tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-muted-foreground tw:tabular-nums tw:md:hidden">
          № {num}
          {routineTask && (
            <RiRepeat2Line
              size={12}
              aria-label="Создана регламентом"
              className="tw:text-faint"
            />
          )}
          <span className="tw:text-faint">· {createdShort(createdAt)}</span>
          <TicketStateText tone={state.tone} className="tw:ms-auto tw:text-xs">
            {state.label}
          </TicketStateText>
        </span>

        {/* десктоп: номер */}
        <span className="tw:hidden tw:w-16 tw:flex-none tw:items-center tw:gap-1 tw:font-medium tw:text-muted-foreground tw:tabular-nums tw:md:flex">
          {num}
          {routineTask && (
            <RiRepeat2Line
              size={13}
              aria-label="Создана регламентом"
              title="Создана регламентом"
              className="tw:text-faint"
            />
          )}
        </span>

        {/* тема и мета — всегда двумя строками */}
        <span className="tw:min-w-0 tw:flex-1">
          <span className="tw:block tw:truncate tw:font-medium">{title}</span>
          <span className="tw:hidden tw:truncate tw:text-sm tw:text-muted-foreground tw:md:block">
            {meta || "—"}
          </span>
        </span>

        {/* десктоп: ответственные */}
        <span className="tw:hidden tw:w-36 tw:flex-none tw:truncate tw:text-sm tw:text-muted-foreground tw:lg:block">
          {responsibleNames(responsibles) || "—"}
        </span>

        {/* десктоп: создана */}
        <span
          className="tw:hidden tw:w-28 tw:flex-none tw:text-end tw:text-xs tw:text-faint tw:whitespace-nowrap tw:tabular-nums tw:xl:block"
          title={createdAt ? `создана ${formatDate(createdAt)}` : undefined}
        >
          {createdText(createdAt)}
        </span>

        {/* десктоп: состояние и срок */}
        <span className="tw:hidden tw:w-40 tw:flex-none tw:flex-col tw:items-end tw:md:flex">
          <TicketStateText tone={state.tone}>{state.label}</TicketStateText>
          <span
            className={cn(
              "tw:text-xs tw:whitespace-nowrap tw:tabular-nums",
              overdue ? "tw:text-destructive" : "tw:text-faint",
            )}
          >
            {deadlineText(deadline)}
          </span>
        </span>

        {/* мобайл: компания, инициатор и срок */}
        <span className="tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-muted-foreground tw:md:hidden">
          <span className="tw:min-w-0 tw:truncate">{meta || "—"}</span>
          <span
            className={cn(
              "tw:ms-auto tw:flex-none tw:tabular-nums",
              overdue ? "tw:text-destructive" : "tw:text-faint",
            )}
          >
            {deadlineText(deadline)}
          </span>
        </span>
      </Link>

      {/* «⋯» — идиома строки списка приложения; состав тот же, что был в
          легаси-меню «Действия» */}
      <span className="tw:flex tw:w-9 tw:flex-none tw:justify-center tw:pe-2 tw:md:pe-3">
        {hasMenu && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Действия"
                title="Действия"
                className="tw:text-faint tw:opacity-0 tw:group-hover:opacity-100 tw:focus-visible:opacity-100 tw:data-[state=open]:opacity-100 tw:pointer-coarse:opacity-100"
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
