import { useState, type MouseEvent, type ReactNode } from "react";

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
import { useAuthedUser, useCan } from "@/store/authed-user";

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
  /** Постоянный контент справа перед «⋯» (напр. статус доступа). */
  trailing?: ReactNode;
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
  trailing,
}: ListRowProps) => {
  const offcanvas = useOffcanvasStore();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { _id: userId } = useAuthedUser();

  const can = useCan();
  const canManage = canManageEntity(itemTitle, can, item, userId);

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
  // Диалоги и меню рендерятся в портал на <body>, но React-события всплывают по
  // дереву КОМПОНЕНТОВ, а не по DOM: без этой проверки клик внутри модала
  // считался бы кликом по строке и уводил бы на карточку.
  const handleRowClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return;
    if (detailTo) return navigate(detailTo);
    openUpdate();
  };

  return (
    <div
      className={cn(
        "group relative flex items-center gap-4 px-5 py-3 transition-colors",
        "before:absolute before:top-0 before:right-5 before:left-21 before:h-px before:bg-border-soft first:before:hidden",
        "hover:bg-accent/60",
        clickable && "cursor-pointer",
        justCreated && "row-appear",
        justUpdated && "row-flash",
      )}
      onClick={clickable ? handleRowClick : undefined}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-12 flex-none place-items-center overflow-hidden rounded-xl text-lg font-semibold",
          dimmed
            ? "text-faint"
            : "bg-accent text-muted-foreground inset-ring inset-ring-border",
        )}
      >
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt=""
            loading="lazy"
            // size-full перебивает preflight-правило `img { height: auto }`:
            // утилиты лежат в слое выше base
            className="size-full object-cover"
          />
        ) : (
          monogram
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-base leading-snug font-medium",
            dimmed && "text-muted-foreground",
          )}
        >
          {title}
        </div>
        {meta && (
          <div className="truncate text-sm text-muted-foreground tabular-nums">
            {meta}
          </div>
        )}
      </div>
      {(trailing || canManage) && (
        <div className="ml-auto flex flex-none items-center gap-2">
          {trailing && (
            <span onClick={(e) => e.stopPropagation()}>{trailing}</span>
          )}
          {canManage && (
            <div
              className="flex flex-none items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu>
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
      )}
    </div>
  );
};

export default ListRow;
