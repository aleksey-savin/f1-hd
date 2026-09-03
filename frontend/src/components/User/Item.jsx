import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { isMobile } from "react-device-detect";
import {
  RiPhoneLine,
  RiMailLine,
  RiMoreLine,
  RiEdit2Line,
  RiDeleteBinLine,
  RiTimeLine,
  RiArrowRightSLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { canManageEntity } from "@/components/app/entity-permissions";
import { useAuthedUser, useCan } from "@/store/authed-user";
import useOffcanvasStore from "@/store/offcanvas";
import { cn } from "@/lib/utils";

import { relativeDay } from "../../util/relative-time";
import { getPresence } from "./presence";
import UserAvatar from "./UserAvatar";
import PresenceText from "./PresenceText";
import UserContactSheet from "./ContactSheet";

// Строка адресной книги: круглый аватар с кольцом-присутствием · имя ·
// должность/принадлежность · контекстный правый столбец (у сотрудника —
// присутствие, у клиента — последняя активность) · действия связи (десктоп) ·
// «⋯» по правам. Клик по строке ведёт на карточку профиля. Специализированный
// вариант app/ListRow: людям нужен круг+присутствие+связь, чего у общей строки
// справочника нет.
const FRESH_MS = 8000;

const contactClass =
  "inline-grid size-8 flex-none cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-faint no-underline transition-colors group-hover:text-muted-foreground hover:bg-accent";

const UserItem = ({ item }) => {
  const {
    _id,
    firstName,
    lastName,
    company = {},
    position,
    subdivisionName,
    email,
    phone,
    isEndUser,
    banned,
    lastActivityAt,
    createdAt,
    updatedAt,
  } = item;

  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const { _id: authedId } = useAuthedUser();
  const can = useCan();
  const canManage = canManageEntity("user", can, item, authedId);

  const fullName = `${lastName} ${firstName}`.trim();
  const detailTo = `/users/${_id}`;
  const updateTo = `update/${_id}`;

  // Присутствие есть только у активного сотрудника; иначе правый столбец —
  // последняя активность (общий расчёт — ./presence).
  const presence = getPresence(item);

  const createdAgo = createdAt ? Date.now() - Date.parse(createdAt) : Infinity;
  const updatedAgo = updatedAt ? Date.now() - Date.parse(updatedAt) : Infinity;
  const justCreated = createdAgo < FRESH_MS;
  const justUpdated = !justCreated && updatedAgo < FRESH_MS;

  // Мета: клиент — компания; сотрудник — подразделение (свою компанию не
  // дублируем — она и так контекст экрана).
  const affiliation = isEndUser ? company?.alias : subdivisionName;
  const lastSeen = relativeDay(lastActivityAt);

  const stop = (event) => event.stopPropagation();

  // Правый столбец (переиспользуем для десктопной колонки и мобильной строки)
  const rightContent = presence.visible ? (
    <PresenceText presence={presence} className="text-sm font-medium" />
  ) : lastSeen ? (
    <span className="inline-flex items-center gap-1.5 text-sm text-faint tabular-nums">
      <RiTimeLine size={14} aria-hidden />
      {lastSeen}
    </span>
  ) : null;

  return (
    <>
      <div
        className={cn(
          "group relative flex cursor-pointer items-center gap-4 px-5 py-3.5 transition-colors",
          "before:absolute before:top-0 before:right-5 before:left-20 before:h-px before:bg-border-soft first:before:hidden",
          "hover:bg-accent/60",
          justCreated && "row-appear",
          justUpdated && "row-flash",
          // приглушаем и отключённых, и людей отключённых компаний
          (banned || item.company?.isActive === false) && "opacity-70",
        )}
        onClick={() => (isMobile ? setContactOpen(true) : navigate(detailTo))}
      >
        <UserAvatar
          user={item}
          sizeClass="size-12"
          ringColor={presence.ringColor}
        />

        {/* имя + должность/принадлежность; на мобайле — ещё строка присутствия */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-base leading-tight font-medium">
            {fullName || "—"}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            {position || "Должность не указана"}
            {affiliation && (
              <span className="text-faint"> · {affiliation}</span>
            )}
          </div>
          {rightContent && <div className="mt-1 md:hidden">{rightContent}</div>}
        </div>

        {/* десктоп: правый столбец присутствия/активности */}
        <div className="hidden w-40 flex-none items-center justify-end text-right md:flex">
          {rightContent}
        </div>

        {/* десктоп: действия связи (только заполненные каналы) */}
        <div className="hidden flex-none items-center gap-0.5 md:flex">
          {phone && (
            <a
              className={cn(contactClass, "hover:text-primary")}
              href={`tel:${phone}`}
              title={`Позвонить · ${phone}`}
              aria-label={`Позвонить ${fullName}`}
              onClick={stop}
            >
              <RiPhoneLine size={18} />
            </a>
          )}
          {email && (
            <a
              className={cn(contactClass, "hover:text-accent-text")}
              href={`mailto:${email}`}
              title={`Написать · ${email}`}
              aria-label={`Написать ${fullName}`}
              onClick={stop}
            >
              <RiMailLine size={18} />
            </a>
          )}
        </div>

        {/* десктоп: «⋯» под правами */}
        {canManage && (
          <div className="hidden flex-none items-center md:flex" onClick={stop}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Действия"
                  title="Действия"
                  className="text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                >
                  <RiMoreLine />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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
              item={{ ...item, title: fullName }}
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
            />
          </div>
        )}

        {/* мобайл: шеврон (тап по строке → карточка профиля) */}
        <RiArrowRightSLine
          size={20}
          aria-hidden
          className="flex-none text-faint md:hidden"
        />
      </div>
      <UserContactSheet
        item={item}
        open={contactOpen}
        onOpenChange={setContactOpen}
      />
    </>
  );
};

export default UserItem;
