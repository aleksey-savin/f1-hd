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
import { useAuthedUser, useCan } from "@/store/authed-user";

// Строка списка из согласованного макета: [плитка ·] имя + мета · «⋯»-меню
// (по наведению; на тач-экране видно всегда). Плитка слева стоит только там,
// где она различает строки: превью из каталога (`thumbSrc`, с кольцом) или
// глиф вида в смешанном списке (`glyph`, без кольца). У однородного
// справочника плитки нет — монограмма из букв повторяла название рядом и
// читалась как шум. Разделители — тонкая линия от отступа панели (с плиткой —
// от её правого края). Клик по строке открывает правку (если есть права),
// диалог удаления живёт вне radix-меню.
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
  /** URL превью (фото из каталога): заполняет плитку целиком (object-cover),
   *  кольцо держит край. Есть фото — фото, иначе показывается `glyph`. */
  thumbSrc?: string;
  /** Глиф вида записи (`<RiPrinterLine size={22} />`) — только для смешанных
   *  списков, где вид различает строки. Без `thumbSrc` и `glyph` плитки нет. */
  glyph?: ReactNode;
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
  /** Колонка данных перед `trailing` — второй факт строки, которому не место в
   *  мете (типы устройств у атрибута). Начинается на одном месте у всех строк:
   *  имя с метой получают потолок ширины, а колонка забирает остаток. Клик не
   *  перехватывает — строка остаётся кликабельной целиком, в отличие от
   *  `trailing`, где живут свои действия. Видимость на узком экране задаёт
   *  вызывающий: места на колонку там нет. */
  column?: ReactNode;
};

const ListRow = ({
  item,
  itemTitle,
  thumbSrc,
  glyph,
  title,
  meta,
  dimmed = false,
  openUpdateOnClick = true,
  detailTo,
  extraActions,
  customDeleteMessage,
  trailing,
  column,
}: ListRowProps) => {
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

  const openUpdate = () => navigate(updateTo);

  const clickable = detailTo ? true : canManage && openUpdateOnClick;
  const tiled = Boolean(thumbSrc || glyph);
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
        "before:absolute before:top-0 before:right-5 before:h-px before:bg-border-soft first:before:hidden",
        tiled ? "before:left-21" : "before:left-5",
        "hover:bg-accent/60",
        clickable && "cursor-pointer",
        justCreated && "row-appear",
        justUpdated && "row-flash",
      )}
      onClick={clickable ? handleRowClick : undefined}
    >
      {tiled && (
        <span
          aria-hidden
          className={cn(
            "grid size-12 flex-none place-items-center overflow-hidden rounded-xl",
            thumbSrc
              ? "bg-accent inset-ring inset-ring-border"
              : dimmed
                ? "text-faint"
                : "bg-accent text-muted-foreground",
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
            glyph
          )}
        </span>
      )}
      {/* С колонкой основной блок получает потолок: без него он растёт на всю
          строку и отгоняет колонку к правому краю — между метой и вторым
          фактом встаёт пустота во всю ширину панели, и строка читается как
          две несвязанные половины. Потолок берут только имя и мета; свободное
          место после них достаётся самой колонке. */}
      <div className={cn("min-w-0 flex-1", column && "md:max-w-lg")}>
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
      {column}
      {(trailing || canManage) && (
        <div className="ml-auto flex flex-none items-center gap-2">
          {trailing && (
            <span onClick={(e) => e.stopPropagation()}>{trailing}</span>
          )}
          {/* Гнездо «⋯» — как у строки заявки: постоянная ширина, воздух от
              края и приглушённый, а не блёклый глиф — вплотную к рамке его
              не замечали */}
          {canManage && (
            <div
              className="flex w-14 flex-none items-center justify-center pe-4"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Действия"
                    title="Действия"
                    className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
                  >
                    <RiMoreLine />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {extraActions}
                  <DropdownMenuItem asChild>
                    <Link to={updateTo}>
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
