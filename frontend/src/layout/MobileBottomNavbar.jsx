import { useContext } from "react";
import { NavLink, useLocation } from "react-router";
import { motion, LayoutGroup, useReducedMotion } from "framer-motion";

import {
  RiDashboard2Line,
  RiAccountBoxLine,
  RiBuilding2Line,
  RiBookOpenLine,
  RiArchiveLine,
} from "react-icons/ri";
import { TbCheckbox } from "react-icons/tb";

import { AuthedUserContext } from "../store/authed-user-context";

const MobileBottomNavbar = () => {
  const { dashboard, isEndUser, isAdmin, permissions } =
    useContext(AuthedUserContext);
  const { pathname } = useLocation();
  const reduceMotion = useReducedMotion();

  // Набор вкладок фильтруется по правам (как в бургер-меню). Иконка «Главная»
  // ведёт на /dashboard (как в drawer), а индекс "/" — алиас через extraActive,
  // чтобы активной всегда была ровно одна вкладка (инвариант для layoutId-пилюли).
  const tabs = [
    dashboard?.isActive && {
      to: "/dashboard",
      extraActive: ["/"],
      icon: RiDashboard2Line,
      label: "Главная",
    },
    { to: "/tickets", icon: TbCheckbox, label: "Заявки" },
    !isEndUser && { to: "/users", icon: RiAccountBoxLine, label: "Люди" },
    !isEndUser && { to: "/companies", icon: RiBuilding2Line, label: "Компании" },
    !isEndUser &&
      (isAdmin || permissions?.canSeeKnowledgeBase) && {
        to: "/knowledge-base",
        icon: RiBookOpenLine,
        label: "База",
      },
    isEndUser && { to: "/closed-tickets", icon: RiArchiveLine, label: "Архив" },
  ].filter(Boolean);

  const isActive = (tab) =>
    pathname === tab.to ||
    pathname.startsWith(tab.to + "/") ||
    (tab.extraActive?.includes(pathname) ?? false);

  return (
    <LayoutGroup id="mobile-tabbar">
      <nav className="mobile-tabbar" aria-label="Основная навигация">
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
              className={`mobile-tabbar__tab${active ? " is-active" : ""}`}
            >
              {active && (
                <motion.span
                  layoutId="mobile-tab-pill"
                  className="mobile-tabbar__pill"
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 500, damping: 40 }
                  }
                />
              )}
              <Icon className="mobile-tabbar__icon" aria-hidden="true" />
              <span className="mobile-tabbar__label">{tab.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </LayoutGroup>
  );
};

export default MobileBottomNavbar;
