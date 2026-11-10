import { useContext, useState } from "react";
import { Form, NavLink } from "react-router";
import {
  RiExpandUpDownLine,
  RiLogoutBoxRLine,
  RiUserSettingsLine,
} from "react-icons/ri";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import ThemeSegment from "@/components/app/ThemeSegment";
import WorkStatusAvatar from "@/components/User/WorkStatusAvatar";
import WorkStatusSwitcher from "@/components/User/WorkStatusSwitcher";
import { AuthedUserContext } from "@/store/authed-user-context";
import { ThemeContext } from "@/store/theme-context";
import { cn } from "@/lib/utils";

export function UserMenuTrigger({ className, ...props }) {
  const {
    firstName,
    lastName,
    isAdmin,
    isEndUser,
    hideWorkStatus,
    profileImagePath,
    workStatus,
  } = useContext(AuthedUserContext);
  const initials =
    `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.trim() || "?";

  return (
    <button
      {...props}
      type="button"
      aria-label="Меню пользователя"
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent p-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50",
        className,
      )}
    >
      {!isEndUser && !hideWorkStatus ? (
        <WorkStatusAvatar
          size={36}
          firstName={firstName}
          lastName={lastName}
          profileImagePath={profileImagePath}
          workStatus={workStatus}
        />
      ) : (
        <span
          aria-hidden
          className="grid size-9 flex-none place-items-center rounded-lg bg-accent text-sm font-semibold text-muted-foreground"
        >
          {initials}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {firstName} {lastName}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {isAdmin ? "Администратор" : isEndUser ? "Пользователь" : "Сотрудник"}
        </span>
      </span>
      <RiExpandUpDownLine
        size={16}
        aria-hidden
        className="flex-none text-muted-foreground"
      />
    </button>
  );
}

// Popover сохраняет обычный ввод в поле заметки статуса. На десктопе это
// единственное место для темы и действий аккаунта; на телефоне тема в drawer.
export default function UserMenu({
  trigger,
  align = "end",
  side = "bottom",
  showTheme = false,
  onNavigate,
}) {
  const [open, setOpen] = useState(false);
  const { isEndUser, hideWorkStatus } = useContext(AuthedUserContext);
  const { theme, setTheme } = useContext(ThemeContext);
  const close = () => {
    setOpen(false);
    onNavigate?.();
  };
  const menuItemClass =
    "flex w-full cursor-pointer appearance-none items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-sm text-foreground no-underline outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={8}
        className="w-80 p-1.5"
      >
        {!isEndUser && !hideWorkStatus && (
          <>
            <WorkStatusSwitcher />
            <div className="mx-2 my-1.5 h-px bg-border-soft" />
          </>
        )}
        {showTheme && (
          <div className="px-2 pb-2">
            <ThemeSegment
              theme={theme}
              onChange={setTheme}
              showLabels={false}
              className="flex"
            />
          </div>
        )}
        <NavLink to="/my-account" onClick={close} className={menuItemClass}>
          <RiUserSettingsLine
            size={16}
            aria-hidden
            className="text-muted-foreground"
          />
          Мой аккаунт
        </NavLink>
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
}
