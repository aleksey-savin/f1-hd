import { useContext } from "react";
import { Form, NavLink } from "react-router";

import { RiArrowDownSLine, RiLogoutBoxRLine, RiUserSettingsLine } from "react-icons/ri";

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
import { ThemeContext } from "../store/theme-context";

// Бургер-Sheet навигации: мобильный shell и узкий десктоп (< xl, где пункты
// не влезают в бар). Структура прежнего drawer сохранена: шапка пользователя,
// скруглённые строки навигации (разделы — раскрывающиеся Collapsible), футер
// с сегментом темы, «Мой аккаунт» и «Выйти».
const itemClass = ({ isActive } = {}) =>
  cn(
    "tw:flex tw:w-full tw:items-center tw:gap-3 tw:rounded-xl tw:px-3 tw:py-2.5 tw:text-base tw:font-medium tw:text-foreground tw:no-underline tw:transition-colors tw:hover:bg-accent",
    isActive && "tw:bg-primary/15 tw:text-accent-text tw:hover:bg-primary/15",
  );

const iconClass = "tw:flex-none tw:text-muted-foreground";
const activeIconClass = "tw:flex-none tw:text-accent-text";

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

  const changeTheme = (value) => {
    if (value === theme) return;
    setTheme(value);
    // Легаси-CSS до эндшпиля подхватывает тему только с перезагрузкой
    window.location.reload();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="tw:flex tw:w-5/6 tw:max-w-sm tw:flex-col tw:gap-0 tw:p-0"
      >
        <div className="tw:flex tw:items-center tw:gap-3 tw:border-b tw:border-border-soft tw:p-4 tw:pr-12">
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
              className="tw:grid tw:size-11 tw:flex-none tw:place-items-center tw:rounded-full tw:bg-accent tw:text-base tw:font-semibold tw:text-muted-foreground tw:inset-ring tw:inset-ring-border"
            >
              {initials}
            </span>
          )}
          <div className="tw:min-w-0">
            <SheetTitle className="tw:truncate tw:text-base tw:leading-tight tw:font-semibold">
              {firstName} {lastName}
            </SheetTitle>
            <div className="tw:text-xs tw:text-muted-foreground">
              {roleLabel}
            </div>
          </div>
        </div>

        <nav
          aria-label="Основная навигация"
          className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:p-2.5"
        >
          <div className="tw:px-2 tw:pt-1 tw:pb-1.5 tw:text-xs tw:font-semibold tw:tracking-wider tw:text-faint tw:uppercase">
            Навигация
          </div>
          {items.map((item) =>
            item.groups ? (
              <Collapsible key={item.key}>
                <CollapsibleTrigger
                  className={cn(
                    itemClass(),
                    "tw:group tw:cursor-pointer tw:appearance-none tw:border-0 tw:bg-transparent tw:text-left",
                  )}
                >
                  <item.icon size={18} aria-hidden className={iconClass} />
                  <span className="tw:min-w-0 tw:flex-1">{item.label}</span>
                  <RiArrowDownSLine
                    size={17}
                    aria-hidden
                    className="tw:text-faint tw:transition-transform tw:group-data-[state=open]:rotate-180"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="tw:ps-4">
                  {item.groups.map((group, groupIndex) => (
                    <div
                      key={groupIndex}
                      className={cn(
                        groupIndex > 0 &&
                          "tw:mt-1 tw:border-t tw:border-border-soft tw:pt-1",
                      )}
                    >
                      {group.map((child) => (
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

        <div className="tw:border-t tw:border-border-soft tw:p-3 tw:pb-4">
          <ThemeSegment
            theme={theme}
            onChange={changeTheme}
            showLabels={false}
            className="tw:mb-2 tw:flex"
          />
          <NavLink to="/my-account" onClick={close} className={itemClass}>
            <RiUserSettingsLine size={18} aria-hidden className={iconClass} />
            Мой аккаунт
          </NavLink>
          <Form action="/logout" method="POST">
            <button
              type="submit"
              className={cn(
                itemClass(),
                "tw:cursor-pointer tw:appearance-none tw:border-0 tw:bg-transparent tw:text-left tw:text-destructive tw:hover:bg-destructive/10",
              )}
            >
              <RiLogoutBoxRLine
                size={18}
                aria-hidden
                className="tw:flex-none tw:text-destructive"
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
