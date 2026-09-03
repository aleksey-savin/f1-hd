import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { isMobile } from "react-device-detect";
import {
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiMapPin2Line,
  RiMoreLine,
  RiTaxiLine,
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
import useInitialPrefs from "@/store/prefs";
import { cn } from "@/lib/utils";

import { plural } from "../../util/plural";
import { getTaxiAction } from "./company-links";
import CompanyLogo from "./CompanyLogo";
import WorkStatusText from "./WorkStatusText";
import CompanyContactSheet from "./ContactSheet";

// Строка справочника клиентов (по согласованному макету): плитка-логотип ·
// название + юрлицо (усекается) со счётчиками (не усекаются) · адресная
// колонка в одну строку (клик — карта, полный адрес в title) · живой график
// работы (цвет — только у точки и «открыто») · гнездо действий постоянной
// ширины: такси при выбранном операторе (Preferences.taxi.operator),
// «⋯» по правам. Кнопки звонка нет — телефоны
// живут в шторке-справке и на карточке. Клик по строке — карточка компании;
// на мобайле тап открывает шторку-справку (адрес, такси, телефоны).
const FRESH_MS = 8000;

const DELETE_MESSAGE =
  "Вы уверены? Все пользователи компании также будут удалены. Это действие нельзя отменить.";

const contactClass =
  "inline-grid size-8 flex-none cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-faint no-underline transition-colors group-hover:text-muted-foreground hover:bg-accent";

// Отключённая компания в списке — тихим форматом (как «график не указан»):
// приглушённая строка, полая точка, слово вместо живого графика. Красный
// статус — только в hero карточки.
const InactiveStatus = () => (
  <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap text-faint">
    <span
      aria-hidden
      className="size-2 flex-none rounded-full bg-transparent inset-ring inset-ring-faint"
    />
    отключена
  </span>
);

const CompanyItem = ({ item }) => {
  const {
    _id,
    alias,
    fullTitle,
    address,
    linkToMap,
    usersCount = 0,
    servicePlansCount = 0,
    workSchedule,
    timezone,
    isActive,
    createdAt,
    updatedAt,
  } = item;

  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const { _id: authedId } = useAuthedUser();
  const can = useCan();
  const { taxi } = useInitialPrefs();
  const canManage = canManageEntity("company", can, item, authedId);

  const detailTo = `/companies/${_id}`;
  const updateTo = `update/${_id}`;

  const taxiAction = getTaxiAction(item, taxi?.operator);

  const inactive = isActive === false;

  const createdAgo = createdAt ? Date.now() - Date.parse(createdAt) : Infinity;
  const updatedAgo = updatedAt ? Date.now() - Date.parse(updatedAt) : Infinity;
  const justCreated = createdAgo < FRESH_MS;
  const justUpdated = !justCreated && updatedAgo < FRESH_MS;

  // Администрирование — счётчиками в мете, не бейджами; нулевые не пишем.
  const counts = [
    usersCount > 0 &&
      `${usersCount} ${plural(usersCount, "пользователь", "пользователя", "пользователей")}`,
    servicePlansCount > 0 &&
      `${servicePlansCount} ${plural(servicePlansCount, "услуга", "услуги", "услуг")}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const stop = (event) => event.stopPropagation();

  // Адресная колонка: одна строка с усечением — все строки одной высоты,
  // колонка читается сверху вниз, как телефонная книга. Полный адрес — в
  // title и на карточке; клик — карта (если есть ссылка); адреса нет —
  // приглушённая заглушка.
  const addressColumn = address ? (
    linkToMap ? (
      <a
        href={linkToMap}
        target="_blank"
        rel="noreferrer"
        onClick={stop}
        title={address}
        className="group/addr hidden w-72 flex-none items-center gap-2 text-sm text-muted-foreground no-underline transition-colors hover:text-foreground md:flex"
      >
        <RiMapPin2Line
          size={15}
          aria-hidden
          className="flex-none text-faint transition-colors group-hover/addr:text-accent-text"
        />
        <span className="min-w-0 flex-1 truncate group-hover/addr:underline">
          {address}
        </span>
      </a>
    ) : (
      <span
        title={address}
        className="hidden w-72 flex-none items-center gap-2 text-sm text-muted-foreground md:flex"
      >
        <RiMapPin2Line size={15} aria-hidden className="flex-none text-faint" />
        <span className="min-w-0 flex-1 truncate">{address}</span>
      </span>
    )
  ) : (
    <span className="hidden w-72 flex-none items-center gap-2 text-sm text-faint md:flex">
      <RiMapPin2Line size={15} aria-hidden className="flex-none opacity-45" />
      Адрес не указан
    </span>
  );

  return (
    <>
      <div
        className={cn(
          "group relative flex cursor-pointer items-center gap-3 px-5 py-3.5 transition-colors md:gap-6",
          "before:absolute before:top-0 before:right-5 before:left-20 before:h-px before:bg-border-soft first:before:hidden",
          "hover:bg-accent/60",
          inactive && "opacity-70",
          justCreated && "row-appear",
          justUpdated && "row-flash",
        )}
        onClick={() => (isMobile ? setContactOpen(true) : navigate(detailTo))}
      >
        <CompanyLogo company={item} sizeClass="size-12" />

        {/* название; десктоп — полное имя + счётчики, мобайл — адрес и график */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-base leading-tight font-medium">
            {alias || "—"}
          </div>
          {/* усекается только юрлицо; счётчики закреплены в конце строки */}
          <div className="hidden min-w-0 gap-1 text-sm md:flex">
            <span className="min-w-0 truncate text-muted-foreground">
              {fullTitle || "—"}
            </span>
            {counts && (
              <span className="flex-none whitespace-nowrap text-faint">
                · {counts}
              </span>
            )}
          </div>
          <div className="truncate text-sm text-muted-foreground md:hidden">
            {address || <span className="text-faint">Адрес не указан</span>}
          </div>
          <div className="mt-0.5 md:hidden">
            {inactive ? (
              <InactiveStatus />
            ) : (
              <WorkStatusText workSchedule={workSchedule} timezone={timezone} />
            )}
          </div>
        </div>

        {addressColumn}

        {/* десктоп: живой график работы (у отключённой — тихий статус) */}
        <div className="hidden w-52 flex-none items-center justify-end lg:flex">
          {inactive ? (
            <InactiveStatus />
          ) : (
            <WorkStatusText workSchedule={workSchedule} timezone={timezone} />
          )}
        </div>

        {/* десктоп: гнездо действий постоянной ширины — ровный правый край
            у всех строк; такси при выбранном операторе, «⋯» по наведению
            и правам */}
        <div
          className="hidden w-17 flex-none items-center justify-end gap-0.5 md:flex"
          onClick={stop}
        >
          {taxiAction && (
            <a
              className={cn(contactClass, "hover:text-warning")}
              href={taxiAction.href}
              target="_blank"
              rel="noreferrer"
              title={taxiAction.title}
              aria-label={`${taxiAction.orderText} — ${alias} · ${taxiAction.label}`}
            >
              <RiTaxiLine size={18} />
            </a>
          )}
          {canManage && (
            <>
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
                item={{ ...item, title: alias }}
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                customDeleteMessage={DELETE_MESSAGE}
              />
            </>
          )}
        </div>

        {/* мобайл: шеврон (тап по строке → шторка-справка) */}
        <RiArrowRightSLine
          size={20}
          aria-hidden
          className="flex-none text-faint md:hidden"
        />
      </div>
      <CompanyContactSheet
        item={item}
        open={contactOpen}
        onOpenChange={setContactOpen}
      />
    </>
  );
};

export default CompanyItem;
