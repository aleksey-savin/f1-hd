import { useContext, useMemo, useState } from "react";
import { Form, NavLink } from "react-router";

import {
  RiArrowDownSLine,
  RiLogoutBoxRLine,
  RiMenuLine,
  RiSettings3Line,
  RiUserSettingsLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import BrandMark from "@/components/app/BrandMark";
import NavProgress from "@/components/app/NavProgress";
import Bell from "@/components/Notifications/Bell";
import { THEME_OPTIONS } from "@/components/app/ThemeSegment";
import { cn } from "@/lib/utils";

import WorkStatusAvatar from "../components/User/WorkStatusAvatar";
import WorkStatusSwitcher from "../components/User/WorkStatusSwitcher";
import { AuthedUserContext } from "../store/authed-user-context";
import { useCan } from "../store/authed-user";
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
    "inline-flex cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground no-underline transition-colors outline-none",
    "hover:bg-accent hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50",
    isActive && "font-semibold text-foreground",
  );

const Brand = ({ size = "default" }) => {
  const { contacts } = useInitialPrefs();

  return (
    <NavLink
      to="/dashboard"
      aria-label="HelpDesk — на главную"
      className="inline-flex flex-none items-center no-underline"
    >
      <BrandMark logo={contacts?.logo} size={size} />
    </NavLink>
  );
};

// Дропдаун раздела бара: группы пунктов с разделителями; у группы может быть
// uppercase-заголовок (label — «Администрирование» подписывает группы по
// модулям). В триггере — shortLabel, если задан (экономия ширины бара на xl)
const SectionDropdown = ({ item }) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={navItemClass()}>
          <item.icon size={16} aria-hidden className="opacity-85" />
          {item.shortLabel ?? item.label}
          <RiArrowDownSLine size={14} aria-hidden className="opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {item.groups.map((group, groupIndex) => (
          <div key={group.label ?? groupIndex}>
            {groupIndex > 0 && <DropdownMenuSeparator />}
            {group.label && (
              <DropdownMenuLabel className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {group.label}
              </DropdownMenuLabel>
            )}
            {group.items.map((child) => (
              <DropdownMenuItem key={child.key} asChild>
                <NavLink to={child.to} className="no-underline">
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

  const changeTheme = (value) => setTheme(value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Служебная кнопка, а не пункт меню: меньше и приглушённее пунктов,
            чтобы не спорить с ними за внимание */}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Тема оформления: ${current.label}`}
          title="Тема оформления"
          className="text-muted-foreground hover:text-foreground"
        >
          <current.Icon size={15} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={changeTheme}>
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon size={16} aria-hidden className="me-1" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// Меню пользователя: статусы присутствия + «Мой аккаунт» + «Настройки
// системы» (кому открыты — переехали из «Администрирования») + «Выйти»
const UserMenu = ({ trigger, align = "end" }) => {
  const [open, setOpen] = useState(false);
  const { isEndUser, hideWorkStatus } = useContext(AuthedUserContext);
  const can = useCan();
  const workStatusAvailable = !isEndUser && !hideWorkStatus;

  const menuItemClass =
    "flex w-full cursor-pointer appearance-none items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-sm text-foreground no-underline outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-80 p-1.5">
        {workStatusAvailable && (
          <>
            <WorkStatusSwitcher />
            <div className="mx-2 my-1.5 h-px bg-border-soft" />
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
            className="text-muted-foreground"
          />
          Мой аккаунт
        </NavLink>
        {can({ settings: ["manage"] }) && (
          <NavLink
            to="/preferences"
            onClick={() => setOpen(false)}
            className={menuItemClass}
          >
            <RiSettings3Line
              size={16}
              aria-hidden
              className="text-muted-foreground"
            />
            Настройки системы
          </NavLink>
        )}
        <div className="mx-2 my-1.5 h-px bg-border-soft" />
        <Form action="/logout" method="POST">
          <button
            type="submit"
            className={cn(
              menuItemClass,
              "text-destructive hover:bg-destructive/10",
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
  const can = useCan();
  const { modules } = useInitialPrefs();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const {
    firstName,
    lastName,
    isEndUser,
    profileImagePath,
    workStatus,
    hideWorkStatus,
  } = authedUser;

  const workStatusAvailable = !isEndUser && !hideWorkStatus;
  const initials =
    `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.trim() || "?";

  const menuItems = useMemo(
    () =>
      isLoggedIn
        ? buildMenu({
            isEndUser,
            can,
            modules,
          })
        : [],
    [isLoggedIn, isEndUser, can, modules],
  );

  const userTrigger = (
    <button
      type="button"
      aria-label="Меню пользователя"
      className="inline-flex cursor-pointer appearance-none items-center gap-2 rounded-full border-0 bg-transparent py-1 ps-1 pe-2 text-sm font-medium whitespace-nowrap text-foreground outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50"
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
          className="grid size-7.5 flex-none place-items-center rounded-[25%] bg-accent text-xs font-semibold text-muted-foreground inset-ring inset-ring-border"
        >
          {initials}
        </span>
      )}
      <span className="max-lg:hidden">
        {firstName} {lastName}
      </span>
      <RiArrowDownSLine size={14} aria-hidden className="opacity-60" />
    </button>
  );

  // --- Мобильный shell: статичный флекс-ребёнок, а не fixed (см. гайд) ---
  if (embedded) {
    return (
      <header className="mobile-shell__header relative flex flex-none items-center gap-1.5 border-b border-border bg-card px-2.5 pb-2">
        {/* Линия ожидания перехода — на нижней границе шапки, как и на десктопе */}
        <NavProgress />
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
        {/* Колокольчик — каждому, кто вошёл; у клиента аватара статуса в шапке
            нет, и обёртка ms-auto нужна ему отдельно */}
        {isLoggedIn && (
          <div className="ms-auto flex items-center gap-1.5">
            <Bell />
            {workStatusAvailable && (
              <UserMenu
                trigger={
                  <button
                    type="button"
                    aria-label="Мой статус и аккаунт"
                    className="inline-grid cursor-pointer appearance-none place-items-center rounded-full border-0 bg-transparent p-0.5 outline-none focus-visible:ring-4 focus-visible:ring-ring/50"
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
            )}
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
  // статусов (1020), ниже модалок (1045+).
  return (
    <header
      className="fixed inset-x-0 top-0 border-b border-border bg-card"
      style={{ zIndex: 1030 }}
    >
      {/* Линия ожидания перехода — во всю ширину бара, поверх его границы */}
      <NavProgress />
      <div
        className="mx-auto flex h-14 items-center gap-1.5 px-6"
        style={{ maxWidth: "1920px" }}
      >
        {isLoggedIn && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Меню"
            className="xl:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            <RiMenuLine size={19} />
          </Button>
        )}
        <div className="me-3">
          <Brand />
        </div>

        {isLoggedIn && (
          <nav
            aria-label="Основная навигация"
            className="flex min-w-0 items-center gap-0.5 max-xl:hidden"
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
                          "opacity-85",
                          isActive && "text-accent-text opacity-100",
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
          <div className="ms-auto flex flex-none items-center gap-1">
            <Bell />
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
