import { useContext } from "react";
import { NavLink, useLocation } from "react-router";
import { motion, LayoutGroup, useReducedMotion } from "framer-motion";

import {
  RiDashboard2Line,
  RiAccountBoxLine,
  RiBuilding2Line,
  RiBookOpenLine,
  RiArchiveLine,
  RiCheckboxLine,
} from "react-icons/ri";

import { cn } from "@/lib/utils";

import { AuthedUserContext } from "../store/authed-user-context";

const MobileBottomNavbar = () => {
  const { isEndUser, isAdmin, permissions } = useContext(AuthedUserContext);
  const { pathname } = useLocation();
  const reduceMotion = useReducedMotion();

  // Набор вкладок фильтруется по правам (как в бургер-меню). Иконка «Главная»
  // ведёт на /dashboard (как в drawer), а индекс "/" — алиас через extraActive,
  // чтобы активной всегда была ровно одна вкладка (инвариант для layoutId-пилюли).
  const tabs = [
    {
      to: "/dashboard",
      extraActive: ["/"],
      icon: RiDashboard2Line,
      label: "Главная",
    },
    { to: "/tickets", icon: RiCheckboxLine, label: "Заявки" },
    !isEndUser && { to: "/users", icon: RiAccountBoxLine, label: "Люди" },
    !isEndUser && {
      to: "/companies",
      icon: RiBuilding2Line,
      label: "Компании",
    },
    !isEndUser &&
      (isAdmin || permissions?.canSeeKnowledgeBase) && {
        to: "/knowledge-base",
        icon: RiBookOpenLine,
        label: "База",
      },
    isEndUser && { to: "/archive", icon: RiArchiveLine, label: "Архив" },
  ].filter(Boolean);

  const isActive = (tab) =>
    pathname === tab.to ||
    pathname.startsWith(tab.to + "/") ||
    (tab.extraActive?.includes(pathname) ?? false);

  return (
    <LayoutGroup id="mobile-tabbar">
      <nav
        className="mobile-tabbar flex items-stretch justify-around border border-border bg-card/88 px-1.5 py-1"
        aria-label="Основная навигация"
      >
        {tabs.map((tab) => {
          const active = isActive(tab);
          const Icon = tab.icon;

          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              replace
              aria-label={tab.label}
              aria-current={active ? "page" : undefined}
              // min-h-13 — тач-таргет ≥44px с запасом под подпись
              className={cn(
                "tap-none relative flex min-h-13 flex-1 flex-col items-center justify-center gap-1 p-1 no-underline transition-colors motion-reduce:transition-none focus-visible:rounded-xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="mobile-tab-pill"
                  // Пилюлю центрируем равными inset, а НЕ transform: им
                  // управляет layoutId-анимация framer и перетёрла бы сдвиг
                  className="absolute inset-x-2 inset-y-1 z-0 rounded-xl bg-primary/15"
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 500, damping: 40 }
                  }
                />
              )}
              <Icon className="relative z-10 size-6" aria-hidden="true" />
              <span className="relative z-10 max-w-full truncate text-xs leading-none">
                {tab.label}
              </span>
            </NavLink>
          );
        })}
      </nav>
    </LayoutGroup>
  );
};

export default MobileBottomNavbar;
