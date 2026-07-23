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
import { useAuthedUser } from "@/store/authed-user";
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
  "tw:inline-grid tw:size-8 tw:flex-none tw:cursor-pointer tw:place-items-center tw:rounded-lg tw:border-0 tw:bg-transparent tw:text-faint tw:no-underline tw:transition-colors tw:group-hover:text-muted-foreground tw:hover:bg-accent";

// Отключённая компания в списке — тихим форматом (как «график не указан»):
// приглушённая строка, полая точка, слово вместо живого графика. Красный
// статус — только в hero карточки.
const InactiveStatus = () => (
  <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-sm tw:whitespace-nowrap tw:text-faint">
    <span
      aria-hidden
      className="tw:size-2 tw:flex-none tw:rounded-full tw:bg-transparent tw:inset-ring tw:inset-ring-faint"
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
    isActive,
    createdAt,
    updatedAt,
  } = item;

  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const { _id: authedId, permissions } = useAuthedUser();
  const { taxi } = useInitialPrefs();
  const canManage = canManageEntity("company", permissions, item, authedId);

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
        className="tw:group/addr tw:hidden tw:w-72 tw:flex-none tw:items-center tw:gap-2 tw:text-sm tw:text-muted-foreground tw:no-underline tw:transition-colors tw:hover:text-foreground tw:md:flex"
      >
        <RiMapPin2Line
          size={15}
          aria-hidden
          className="tw:flex-none tw:text-faint tw:transition-colors tw:group-hover/addr:text-accent-text"
        />
        <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:group-hover/addr:underline">
          {address}
        </span>
      </a>
    ) : (
      <span
        title={address}
        className="tw:hidden tw:w-72 tw:flex-none tw:items-center tw:gap-2 tw:text-sm tw:text-muted-foreground tw:md:flex"
      >
        <RiMapPin2Line size={15} aria-hidden className="tw:flex-none tw:text-faint" />
        <span className="tw:min-w-0 tw:flex-1 tw:truncate">{address}</span>
      </span>
    )
  ) : (
    <span className="tw:hidden tw:w-72 tw:flex-none tw:items-center tw:gap-2 tw:text-sm tw:text-faint tw:md:flex">
      <RiMapPin2Line size={15} aria-hidden className="tw:flex-none tw:opacity-45" />
      Адрес не указан
    </span>
  );

  return (
    <>
      <div
        className={cn(
          "tw:group tw:relative tw:flex tw:cursor-pointer tw:items-center tw:gap-3 tw:px-5 tw:py-3.5 tw:transition-colors tw:md:gap-6",
          "tw:before:absolute tw:before:top-0 tw:before:right-5 tw:before:left-20 tw:before:h-px tw:before:bg-border-soft tw:first:before:hidden",
          "tw:hover:bg-accent/60",
          inactive && "tw:opacity-70",
          justCreated && "tw:row-appear",
          justUpdated && "tw:row-flash",
        )}
        onClick={() => (isMobile ? setContactOpen(true) : navigate(detailTo))}
      >
        <CompanyLogo company={item} sizeClass="tw:size-13" />

        {/* название; десктоп — полное имя + счётчики, мобайл — адрес и график */}
        <div className="tw:min-w-0 tw:flex-1">
          <div className="tw:truncate tw:text-xl tw:leading-tight tw:font-medium">
            {alias || "—"}
          </div>
          {/* усекается только юрлицо; счётчики закреплены в конце строки */}
          <div className="tw:hidden tw:min-w-0 tw:gap-1 tw:text-sm tw:md:flex">
            <span className="tw:min-w-0 tw:truncate tw:text-muted-foreground">
              {fullTitle || "—"}
            </span>
            {counts && (
              <span className="tw:flex-none tw:whitespace-nowrap tw:text-faint">
                · {counts}
              </span>
            )}
          </div>
          <div className="tw:truncate tw:text-sm tw:text-muted-foreground tw:md:hidden">
            {address || <span className="tw:text-faint">Адрес не указан</span>}
          </div>
          <div className="tw:mt-0.5 tw:md:hidden">
            {inactive ? (
              <InactiveStatus />
            ) : (
              <WorkStatusText workSchedule={workSchedule} />
            )}
          </div>
        </div>

        {addressColumn}

        {/* десктоп: живой график работы (у отключённой — тихий статус) */}
        <div className="tw:hidden tw:w-52 tw:flex-none tw:items-center tw:justify-end tw:lg:flex">
          {inactive ? (
            <InactiveStatus />
          ) : (
            <WorkStatusText workSchedule={workSchedule} />
          )}
        </div>

        {/* десктоп: гнездо действий постоянной ширины — ровный правый край
            у всех строк; такси при выбранном операторе, «⋯» по наведению
            и правам */}
        <div
          className="tw:hidden tw:w-17 tw:flex-none tw:items-center tw:justify-end tw:gap-0.5 tw:md:flex"
          onClick={stop}
        >
          {taxiAction && (
            <a
              className={cn(contactClass, "tw:hover:text-warning")}
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
          className="tw:flex-none tw:text-faint tw:md:hidden"
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
