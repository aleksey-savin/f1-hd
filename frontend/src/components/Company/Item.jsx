import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { isMobile } from "react-device-detect";
import {
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiMoreLine,
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
import { cn } from "@/lib/utils";

import { plural } from "../../util/plural";
import CompanyLogo from "./CompanyLogo";
import TaxiButton from "./TaxiButton";
import WorkStatusText from "./WorkStatusText";
import CompanyContactSheet from "./ContactSheet";

// Строка справочника клиентов (по согласованному макету): плитка-логотип ·
// название + юрлицо (усекается) со счётчиками (не усекаются) · живой график
// работы (цвет — только у точки и «открыто») · гнездо действий постоянной
// ширины: такси при выбранном операторе (Preferences.taxi.operator; адресов
// несколько — меню адресов под кнопкой, см. Company/TaxiButton), «⋯» по
// правам — оба только по наведению, как любое действие строки (на тач-экране
// видны всегда). Адреса и телефоны в строке не показываются — они живут в
// шторке-справке и на карточке, а у такси — в меню. Клик по строке —
// карточка компании; на мобайле тап открывает шторку-справку.
const FRESH_MS = 8000;

const DELETE_MESSAGE =
  "Вы уверены? Все пользователи компании также будут удалены. Это действие нельзя отменить.";

// Действие строки: в покое невидимо, проявляется по наведению на строку и при
// клавиатурном фокусе; на тач-экране видно всегда (правило гайда, как «⋯»).
// transition-all, как у Button: с transition-colors прозрачность прыгала
// мгновенно, а «⋯» рядом плавно гас — два действия в разнобой
const contactClass =
  "inline-grid size-8 flex-none cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-muted-foreground no-underline opacity-0 transition-all group-hover:opacity-100 hover:bg-accent focus-visible:opacity-100 pointer-coarse:opacity-100";

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
    usersCount = 0,
    servicePlansCount = 0,
    workSchedule,
    timezone,
    isActive,
    createdAt,
    updatedAt,
  } = item;

  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const { _id: authedId } = useAuthedUser();
  const can = useCan();
  const canManage = canManageEntity("company", can, item, authedId);

  const detailTo = `/companies/${_id}`;
  const updateTo = `update/${_id}`;

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

          <div className="mt-0.5 md:hidden">
            {inactive ? (
              <InactiveStatus />
            ) : (
              <WorkStatusText workSchedule={workSchedule} timezone={timezone} />
            )}
          </div>
        </div>

        {/* десктоп: живой график работы (у отключённой — тихий статус) */}
        <div className="hidden w-52 flex-none items-center justify-end lg:flex">
          {inactive ? (
            <InactiveStatus />
          ) : (
            <WorkStatusText workSchedule={workSchedule} timezone={timezone} />
          )}
        </div>

        {/* десктоп: гнездо действий постоянной ширины — ровный правый край
            у всех строк; такси при выбранном операторе (один адрес — сразу
            маршрут, несколько — меню адресов), «⋯» по правам, оба только по
            наведению */}
        <div
          className="hidden w-17 flex-none items-center justify-end gap-0.5 md:flex"
          onClick={stop}
        >
          <TaxiButton
            company={item}
            className={cn(
              contactClass,
              "hover:text-warning data-[state=open]:bg-accent data-[state=open]:text-warning",
            )}
            iconSize={18}
            ariaLabel={`Такси — ${alias}`}
          />
          {canManage && (
            <>
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
