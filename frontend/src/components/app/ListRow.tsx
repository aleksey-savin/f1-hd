import { useState, type ReactNode } from "react";

import { Link, useNavigate } from "react-router";
import { RiDeleteBinLine, RiEdit2Line, RiMoreLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { canManageEntity } from "@/components/app/entity-permissions";
import { cn } from "@/lib/utils";
import useOffcanvasStore from "@/store/offcanvas";
import { useAuthedUser } from "@/store/authed-user";

// Строка списка из согласованного макета: монограмма-плитка · имя + мета ·
// «⋯»-меню (по наведению; на тач-экране видно всегда). Разделители — тонкая
// линия с отступом под монограмму. Клик по строке открывает правку (если есть
// права), диалог удаления живёт вне radix-меню.
// Свежесозданная строка появляется с fade-in + подсветкой, свежеизменённая —
// только с подсветкой (по createdAt/updatedAt из API; окно — FRESH_MS).
const FRESH_MS = 8000;

type ListRowProps = {
  item: {
    _id: string;
    title?: string;
    alias?: string;
    createdBy?: unknown;
    createdAt?: string;
    updatedAt?: string;
  };
  itemTitle?: string;
  /** URL превью (фото из каталога): заполняет плитку целиком (object-cover)
   *  вместо монограммы. Есть фото — фото, иначе показывается `monogram`. */
  thumbSrc?: string;
  monogram?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  dimmed?: boolean;
  openUpdateOnClick?: boolean;
  /** Переход на страницу сущности по клику (напр. услуга открывается во
   *  View, а не в шторке правки). Доступно всем, кто видит список. */
  detailTo?: string;
  extraActions?: ReactNode;
  customDeleteMessage?: ReactNode;
};

const ListRow = ({
  item,
  itemTitle,
  thumbSrc,
  monogram,
  title,
  meta,
  dimmed = false,
  openUpdateOnClick = true,
  detailTo,
  extraActions,
  customDeleteMessage,
}: ListRowProps) => {
  const offcanvas = useOffcanvasStore();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { _id: userId, permissions } = useAuthedUser();
  const canManage = canManageEntity(itemTitle, permissions, item, userId);

  const updateTo = `update/${item._id}`;

  const createdAgo = item.createdAt
    ? Date.now() - Date.parse(item.createdAt)
    : Infinity;
  const updatedAgo = item.updatedAt
    ? Date.now() - Date.parse(item.updatedAt)
    : Infinity;
  const justCreated = createdAgo < FRESH_MS;
  const justUpdated = !justCreated && updatedAgo < FRESH_MS;

  const openUpdate = () => {
    offcanvas.setShow();
    navigate(updateTo);
  };

  const clickable = detailTo ? true : canManage && openUpdateOnClick;
  const handleRowClick = detailTo ? () => navigate(detailTo) : openUpdate;

  return (
    <div
      className={cn(
        "tw:group tw:relative tw:flex tw:items-center tw:gap-4 tw:px-5 tw:py-4 tw:transition-colors",
        "tw:before:absolute tw:before:top-0 tw:before:right-5 tw:before:left-24 tw:before:h-px tw:before:bg-border-soft tw:first:before:hidden",
        "tw:hover:bg-accent/60",
        clickable && "tw:cursor-pointer",
        justCreated && "tw:row-appear",
        justUpdated && "tw:row-flash",
      )}
      onClick={clickable ? handleRowClick : undefined}
    >
      <span
        aria-hidden
        className={cn(
          "tw:grid tw:size-15 tw:flex-none tw:place-items-center tw:overflow-hidden tw:rounded-xl tw:text-xl tw:font-semibold",
          dimmed
            ? "tw:text-faint"
            : "tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border",
        )}
      >
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt=""
            loading="lazy"
            // listrow-thumb: заполняет плитку (перебивает глобальный
            // img{width/height:auto!important} специфичностью класса)
            className="listrow-thumb"
          />
        ) : (
          monogram
        )}
      </span>
      <div className="tw:min-w-0 tw:flex-1">
        <div
          className={cn(
            "tw:truncate tw:text-2xl tw:leading-snug tw:font-medium",
            dimmed && "tw:text-muted-foreground",
          )}
        >
          {title}
        </div>
        {meta && (
          <div className="tw:truncate tw:text-lg tw:text-muted-foreground tw:tabular-nums">
            {meta}
          </div>
        )}
      </div>
      {canManage && (
        <div
          className="tw:ml-auto tw:flex tw:flex-none tw:items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
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
              {extraActions}
              <DropdownMenuItem asChild>
                <Link to={updateTo} onClick={offcanvas.setShow}>
                  <RiEdit2Line /> Изменить
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <RiDeleteBinLine /> Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DeleteDialog
            item={item}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            customDeleteMessage={customDeleteMessage}
          />
        </div>
      )}
    </div>
  );
};

export default ListRow;
