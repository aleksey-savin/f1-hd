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
import { useAuthedUser } from "@/store/authed-user";
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
  "tw:inline-grid tw:size-8 tw:flex-none tw:cursor-pointer tw:place-items-center tw:rounded-lg tw:border-0 tw:bg-transparent tw:text-faint tw:no-underline tw:transition-colors tw:group-hover:text-muted-foreground tw:hover:bg-accent";

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
    isActive,
    lastActivityAt,
    createdAt,
    updatedAt,
  } = item;

  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const { _id: authedId, permissions } = useAuthedUser();
  const canManage = canManageEntity("user", permissions, item, authedId);

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
    <PresenceText presence={presence} className="tw:text-sm tw:font-medium" />
  ) : lastSeen ? (
    <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-sm tw:text-faint tw:tabular-nums">
      <RiTimeLine size={14} aria-hidden />
      {lastSeen}
    </span>
  ) : null;

  return (
    <>
    <div
      className={cn(
        "tw:group tw:relative tw:flex tw:cursor-pointer tw:items-center tw:gap-4 tw:px-5 tw:py-3.5 tw:transition-colors",
        "tw:before:absolute tw:before:top-0 tw:before:right-5 tw:before:left-20 tw:before:h-px tw:before:bg-border-soft tw:first:before:hidden",
        "tw:hover:bg-accent/60",
        justCreated && "tw:row-appear",
        justUpdated && "tw:row-flash",
        // приглушаем и отключённых, и людей отключённых компаний
        (!isActive || item.company?.isActive === false) && "tw:opacity-70",
      )}
      onClick={() =>
        isMobile ? setContactOpen(true) : navigate(detailTo)
      }
    >
      <UserAvatar user={item} sizeClass="tw:size-13" ringColor={presence.ringColor} />

      {/* имя + должность/принадлежность; на мобайле — ещё строка присутствия */}
      <div className="tw:min-w-0 tw:flex-1">
        <div className="tw:truncate tw:text-xl tw:leading-tight tw:font-medium">
          {fullName || "—"}
        </div>
        <div className="tw:truncate tw:text-sm tw:text-muted-foreground">
          {position || "Должность не указана"}
          {affiliation && <span className="tw:text-faint"> · {affiliation}</span>}
        </div>
        {rightContent && (
          <div className="tw:mt-1 tw:md:hidden">{rightContent}</div>
        )}
      </div>

      {/* десктоп: правый столбец присутствия/активности */}
      <div className="tw:hidden tw:w-40 tw:flex-none tw:items-center tw:justify-end tw:text-right tw:md:flex">
        {rightContent}
      </div>

      {/* десктоп: действия связи (только заполненные каналы) */}
      <div className="tw:hidden tw:flex-none tw:items-center tw:gap-0.5 tw:md:flex">
        {phone && (
          <a
            className={cn(contactClass, "tw:hover:text-primary")}
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
            className={cn(contactClass, "tw:hover:text-accent-text")}
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
        <div
          className="tw:hidden tw:flex-none tw:items-center tw:md:flex"
          onClick={stop}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Действия"
                title="Действия"
                className="tw:text-faint tw:opacity-0 tw:group-hover:opacity-100 tw:focus-visible:opacity-100 tw:data-[state=open]:opacity-100"
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
        className="tw:flex-none tw:text-faint tw:md:hidden"
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
