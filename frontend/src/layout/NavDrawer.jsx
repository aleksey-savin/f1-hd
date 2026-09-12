import { useContext } from "react";
import { Form, NavLink } from "react-router";

import {
  RiArrowDownSLine,
  RiLogoutBoxRLine,
  RiSettings3Line,
  RiUserSettingsLine,
} from "react-icons/ri";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import ThemeSegment from "@/components/app/ThemeSegment";
import { cn } from "@/lib/utils";

import WorkStatusAvatar from "../components/User/WorkStatusAvatar";
import { AuthedUserContext } from "../store/authed-user-context";
import { useCan } from "../store/authed-user";
import { ThemeContext } from "../store/theme-context";

// Бургер-Sheet навигации: мобильный shell и узкий десктоп (< xl, где пункты
// не влезают в бар). Структура прежнего drawer сохранена: шапка пользователя,
// скруглённые строки навигации (разделы — раскрывающиеся Collapsible), футер
// с сегментом темы, «Мой аккаунт» и «Выйти».
const itemClass = ({ isActive } = {}) =>
  cn(
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-base font-medium text-foreground no-underline transition-colors hover:bg-accent",
    isActive && "bg-primary/15 text-accent-text hover:bg-primary/15",
  );

const iconClass = "flex-none text-muted-foreground";
const activeIconClass = "flex-none text-accent-text";

const NavDrawer = ({ open, onOpenChange, items }) => {
  const {
    firstName,
    lastName,
    isAdmin,
    isEndUser,
    profileImagePath,
    workStatus,
    hideWorkStatus,
  } = useContext(AuthedUserContext);
  const can = useCan();
  const { theme, setTheme } = useContext(ThemeContext);

  const workStatusAvailable = !isEndUser && !hideWorkStatus;
  const roleLabel = isAdmin
    ? "Администратор"
    : isEndUser
      ? "Пользователь"
      : "Сотрудник";
  const initials =
    `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.trim() || "?";

  const close = () => onOpenChange(false);

  const changeTheme = (value) => setTheme(value);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="flex w-5/6 max-w-sm flex-col gap-0 p-0"
      >
        <div className="flex items-center gap-3 border-b border-border-soft p-4 pr-12">
          {workStatusAvailable ? (
            <WorkStatusAvatar
              size={44}
              firstName={firstName}
              lastName={lastName}
              profileImagePath={profileImagePath}
              workStatus={workStatus}
            />
          ) : (
            <span
              aria-hidden
              className="grid size-11 flex-none place-items-center rounded-[25%] bg-accent text-base font-semibold text-muted-foreground inset-ring inset-ring-border"
            >
              {initials}
            </span>
          )}
          <div className="min-w-0">
            <SheetTitle className="truncate text-base leading-tight font-semibold">
              {firstName} {lastName}
            </SheetTitle>
            <div className="text-xs text-muted-foreground">{roleLabel}</div>
          </div>
        </div>

        <nav
          aria-label="Основная навигация"
          className="min-h-0 flex-1 overflow-y-auto p-2.5"
        >
          <div className="px-2 pt-1 pb-1.5 text-xs font-semibold tracking-wider text-faint uppercase">
            Навигация
          </div>
          {items.map((item) =>
            item.groups ? (
              <Collapsible key={item.key}>
                <CollapsibleTrigger
                  className={cn(
                    itemClass(),
                    "group cursor-pointer appearance-none border-0 bg-transparent text-left",
                  )}
                >
                  <item.icon size={18} aria-hidden className={iconClass} />
                  <span className="min-w-0 flex-1">{item.label}</span>
                  <RiArrowDownSLine
                    size={17}
                    aria-hidden
                    className="text-faint transition-transform group-data-[state=open]:rotate-180"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="ps-4">
                  {item.groups.map((group, groupIndex) => (
                    <div
                      key={group.label ?? groupIndex}
                      className={cn(
                        groupIndex > 0 &&
                          "mt-1 border-t border-border-soft pt-1",
                      )}
                    >
                      {group.label && (
                        <div className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wider text-faint uppercase">
                          {group.label}
                        </div>
                      )}
                      {group.items.map((child) => (
                        <NavLink
                          key={child.key}
                          to={child.to}
                          onClick={close}
                          className={itemClass}
                        >
                          {({ isActive }) => (
                            <>
                              <child.icon
                                size={17}
                                aria-hidden
                                className={
                                  isActive ? activeIconClass : iconClass
                                }
                              />
                              {child.label}
                            </>
                          )}
                        </NavLink>
                      ))}
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <NavLink
                key={item.key}
                to={item.to}
                onClick={close}
                className={itemClass}
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      size={18}
                      aria-hidden
                      className={isActive ? activeIconClass : iconClass}
                    />
                    {item.label}
                  </>
                )}
              </NavLink>
            ),
          )}
        </nav>

        <div className="border-t border-border-soft p-3 pb-4">
          <ThemeSegment
            theme={theme}
            onChange={changeTheme}
            showLabels={false}
            className="mb-2 flex"
          />
          <NavLink to="/my-account" onClick={close} className={itemClass}>
            <RiUserSettingsLine size={18} aria-hidden className={iconClass} />
            Мой аккаунт
          </NavLink>
          {can({ settings: ["manage"] }) && (
            <NavLink to="/preferences" onClick={close} className={itemClass}>
              <RiSettings3Line size={18} aria-hidden className={iconClass} />
              Настройки системы
            </NavLink>
          )}
          <Form action="/logout" method="POST">
            <button
              type="submit"
              className={cn(
                itemClass(),
                "cursor-pointer appearance-none border-0 bg-transparent text-left text-destructive hover:bg-destructive/10",
              )}
            >
              <RiLogoutBoxRLine
                size={18}
                aria-hidden
                className="flex-none text-destructive"
              />
              Выйти
            </button>
          </Form>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default NavDrawer;
