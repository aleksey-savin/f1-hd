import { useContext, useMemo, useState } from "react";
import { Form, NavLink } from "react-router";

import {
  RiArrowDownSLine,
  RiLogoutBoxRLine,
  RiMenuLine,
  RiUserSettingsLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { THEME_OPTIONS } from "@/components/app/ThemeSegment";
import { cn } from "@/lib/utils";

import WorkStatusAvatar from "../components/User/WorkStatusAvatar";
import WorkStatusSwitcher from "../components/User/WorkStatusSwitcher";
import { AuthedUserContext } from "../store/authed-user-context";
import { ThemeContext } from "../store/theme-context";
import useInitialPrefs from "../store/prefs";
import { getLocalStorageData } from "../util/auth";
import NavDrawer from "./NavDrawer";
import { buildMenu } from "./Navigation/menu";

// Навбар оболочки (Фаза 2 миграции): панель поверхности с тонкой нижней
// границей в обеих темах. Бренд — лого компании из настроек (contacts.logo),
// без него — текст «HelpDesk». Пункты и разделы — из конфига
// Navigation/menu.js; на < xl меню сворачивается в бургер-Sheet (NavDrawer,
// общий с мобильным шеллом). Меню пользователя — Popover (не DropdownMenu:
// внутри инпут заметки статуса, radix-меню ломает его typeahead'ом).

// Классы пункта бара; активный — корпусный цвет + полужирный, иконка бирюзой
const navItemClass = (isActive = false) =>
  cn(
    "tw:inline-flex tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2 tw:rounded-lg tw:border-0 tw:bg-transparent tw:px-2.5 tw:py-1.5 tw:text-sm tw:font-medium tw:whitespace-nowrap tw:text-muted-foreground tw:no-underline tw:transition-colors tw:outline-none",
    "tw:hover:bg-accent tw:hover:text-foreground tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
    isActive && "tw:font-semibold tw:text-foreground",
  );

const Brand = ({ size = "default" }) => {
  const { contacts } = useInitialPrefs();

  return (
    <NavLink
      to="/"
      aria-label="HelpDesk — на главную"
      className="tw:inline-flex tw:flex-none tw:items-center tw:no-underline"
    >
      {contacts?.logo ? (
        // width:auto задаёт глобальный img-автоскейл, max-height — инлайном
        // (глобальное правило ограничивает только width/height, не max-height)
        <img
          src={`${import.meta.env.VITE_API_ADDRESS}/uploads/${contacts.logo}`}
          alt="Логотип компании"
          style={{ maxHeight: size === "sm" ? "28px" : "32px" }}
        />
      ) : (
        <span
          className={cn(
            "tw:font-bold tw:tracking-tight tw:text-foreground",
            size === "sm" ? "tw:text-base" : "tw:text-lg",
          )}
        >
          Help<span className="tw:text-primary">Desk</span>
        </span>
      )}
    </NavLink>
  );
};

// Дропдаун раздела бара: группы пунктов с разделителями
const SectionDropdown = ({ item }) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={navItemClass()}>
          <item.icon size={16} aria-hidden className="tw:opacity-85" />
          {item.label}
          <RiArrowDownSLine size={14} aria-hidden className="tw:opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="tw:min-w-56">
        {item.groups.map((group, groupIndex) => (
          <div key={groupIndex}>
            {groupIndex > 0 && <DropdownMenuSeparator />}
            {group.map((child) => (
              <DropdownMenuItem key={child.key} asChild>
                <NavLink to={child.to} className="tw:no-underline">
                  <child.icon size={16} aria-hidden />
                  {child.label}
                </NavLink>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const ThemeDropdown = () => {
  const { theme, setTheme } = useContext(ThemeContext);
  const current =
    THEME_OPTIONS.find((option) => option.value === theme) ?? THEME_OPTIONS[2];

  const changeTheme = (value) => {
    if (value === theme) return;
    setTheme(value);
    // Легаси-CSS до эндшпиля подхватывает тему только с перезагрузкой
    window.location.reload();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Тема оформления: ${current.label}`}
          title="Тема оформления"
        >
          <current.Icon size={17} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={changeTheme}>
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon size={16} aria-hidden className="tw:me-1" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// Меню пользователя: статусы присутствия + «Мой аккаунт» + «Выйти»
const UserMenu = ({ trigger, align = "end" }) => {
  const [open, setOpen] = useState(false);
  const { isEndUser, hideWorkStatus } = useContext(AuthedUserContext);
  const workStatusAvailable = !isEndUser && !hideWorkStatus;

  const menuItemClass =
    "tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2.5 tw:rounded-md tw:border-0 tw:bg-transparent tw:px-2.5 tw:py-1.5 tw:text-left tw:text-sm tw:text-foreground tw:no-underline tw:outline-none tw:hover:bg-accent tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="tw:w-64 tw:p-1.5">
        {workStatusAvailable && (
          <>
            <WorkStatusSwitcher />
            <div className="tw:mx-2 tw:my-1.5 tw:h-px tw:bg-border-soft" />
          </>
        )}
        <NavLink
          to="/my-account"
          onClick={() => setOpen(false)}
          className={menuItemClass}
        >
          <RiUserSettingsLine
            size={16}
            aria-hidden
            className="tw:text-muted-foreground"
          />
          Мой аккаунт
        </NavLink>
        <div className="tw:mx-2 tw:my-1.5 tw:h-px tw:bg-border-soft" />
        <Form action="/logout" method="POST">
          <button
            type="submit"
            className={cn(
              menuItemClass,
              "tw:text-destructive tw:hover:bg-destructive/10",
            )}
          >
            <RiLogoutBoxRLine size={16} aria-hidden />
            Выйти
          </button>
        </Form>
      </PopoverContent>
    </Popover>
  );
};

const NavigationBar = ({ embedded = false }) => {
  const { token } = getLocalStorageData();
  const isLoggedIn = !!token;

  const authedUser = useContext(AuthedUserContext);
  const { modules } = useInitialPrefs();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const {
    firstName,
    lastName,
    isAdmin,
    isEndUser,
    profileImagePath,
    workStatus,
    hideWorkStatus,
    dashboard,
    permissions,
  } = authedUser;

  const workStatusAvailable = !isEndUser && !hideWorkStatus;
  const initials =
    `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.trim() || "?";

  const menuItems = useMemo(
    () =>
      isLoggedIn
        ? buildMenu({
            isEndUser,
            isAdmin,
            permissions,
            modules,
            dashboardActive: !!dashboard?.isActive,
          })
        : [],
    [isLoggedIn, isEndUser, isAdmin, permissions, modules, dashboard],
  );

  const userTrigger = (
    <button
      type="button"
      aria-label="Меню пользователя"
      className="tw:inline-flex tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2 tw:rounded-full tw:border-0 tw:bg-transparent tw:py-1 tw:ps-1 tw:pe-2 tw:text-sm tw:font-medium tw:whitespace-nowrap tw:text-foreground tw:outline-none tw:hover:bg-accent tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50"
    >
      {workStatusAvailable ? (
        <WorkStatusAvatar
          size={30}
          firstName={firstName}
          lastName={lastName}
          profileImagePath={profileImagePath}
          workStatus={workStatus}
        />
      ) : (
        <span
          aria-hidden
          className="tw:grid tw:size-7.5 tw:flex-none tw:place-items-center tw:rounded-full tw:bg-accent tw:text-xs tw:font-semibold tw:text-muted-foreground tw:inset-ring tw:inset-ring-border"
        >
          {initials}
        </span>
      )}
      <span className="tw:max-lg:hidden">
        {firstName} {lastName}
      </span>
      <RiArrowDownSLine size={14} aria-hidden className="tw:opacity-60" />
    </button>
  );

  // --- Мобильный shell: статичный флекс-ребёнок, а не fixed (см. гайд) ---
  if (embedded) {
    return (
      <header className="mobile-shell__header tw:flex tw:items-center tw:gap-1.5 tw:bg-card tw:px-2.5">
        {isLoggedIn && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Меню"
            onClick={() => setDrawerOpen(true)}
          >
            <RiMenuLine size={19} />
          </Button>
        )}
        <Brand size="sm" />
        {isLoggedIn && workStatusAvailable && (
          <div className="tw:ms-auto">
            <UserMenu
              trigger={
                <button
                  type="button"
                  aria-label="Мой статус и аккаунт"
                  className="tw:inline-grid tw:cursor-pointer tw:appearance-none tw:place-items-center tw:rounded-full tw:border-0 tw:bg-transparent tw:p-0.5 tw:outline-none tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50"
                >
                  <WorkStatusAvatar
                    size={32}
                    firstName={firstName}
                    lastName={lastName}
                    profileImagePath={profileImagePath}
                    workStatus={workStatus}
                  />
                </button>
              }
            />
          </div>
        )}
        {isLoggedIn && (
          <NavDrawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            items={menuItems}
          />
        )}
      </header>
    );
  }

  // --- Десктоп: фиксированный бар ---
  // z-index — легаси-шкала: 1030 (как bootstrap fixed-top), выше рейла
  // статусов (1020), ниже модалок (1045+). Класс app-topbar — для
  // компенсации radix-скролл-лока (см. index.css).
  return (
    <header
      className="app-topbar tw:fixed tw:inset-x-0 tw:top-0 tw:border-b tw:border-border tw:bg-card"
      style={{ zIndex: 1030 }}
    >
      <div
        className="tw:mx-auto tw:flex tw:h-14 tw:items-center tw:gap-1.5 tw:px-6"
        style={{ maxWidth: "1920px" }}
      >
        {isLoggedIn && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Меню"
            className="tw:xl:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            <RiMenuLine size={19} />
          </Button>
        )}
        <div className="tw:me-3">
          <Brand />
        </div>

        {isLoggedIn && (
          <nav
            aria-label="Основная навигация"
            className="tw:flex tw:min-w-0 tw:items-center tw:gap-0.5 tw:max-xl:hidden"
          >
            {menuItems.map((item) =>
              item.groups ? (
                <SectionDropdown key={item.key} item={item} />
              ) : (
                <NavLink
                  key={item.key}
                  to={item.to}
                  className={({ isActive }) => navItemClass(isActive)}
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        size={16}
                        aria-hidden
                        className={cn(
                          "tw:opacity-85",
                          isActive && "tw:text-accent-text tw:opacity-100",
                        )}
                      />
                      {item.shortLabel ?? item.label}
                    </>
                  )}
                </NavLink>
              ),
            )}
          </nav>
        )}

        {isLoggedIn && (
          <div className="tw:ms-auto tw:flex tw:flex-none tw:items-center tw:gap-1">
            <ThemeDropdown />
            <UserMenu trigger={userTrigger} />
          </div>
        )}
      </div>
      {isLoggedIn && (
        <NavDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          items={menuItems}
        />
      )}
    </header>
  );
};

export default NavigationBar;
