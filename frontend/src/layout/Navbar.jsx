import { useContext, useMemo, useState } from "react";

import { RiMenuLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import NavProgress from "@/components/app/NavProgress";
import Bell from "@/components/Notifications/Bell";

import WorkStatusControl from "@/components/User/WorkStatusControl";
import { AuthedUserContext } from "../store/authed-user-context";
import { useCan } from "../store/authed-user";
import useInitialPrefs from "../store/prefs";
import NavDrawer from "./NavDrawer";
import { buildMenu } from "./Navigation/menu";
import ThemeMenu from "./Navigation/ThemeMenu";
import HeaderCrumbs from "@/components/app/HeaderCrumbs";

const NavigationBar = ({ embedded = false }) => {
  const authedUser = useContext(AuthedUserContext);
  const isLoggedIn = Boolean(authedUser?._id);
  const can = useCan();
  const { modules } = useInitialPrefs();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { open, openMobile, isMobile } = useSidebar();
  const sidebarOpen = isMobile ? openMobile : open;

  const { isEndUser, hideWorkStatus } = authedUser;

  const menuItems = useMemo(
    () =>
      isLoggedIn
        ? buildMenu({
            isEndUser,
            can,
            modules,
            hideWorkStatus,
          })
        : [],
    [isLoggedIn, isEndUser, can, modules, hideWorkStatus],
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
        <HeaderCrumbs />
        {/* Клиент видит уведомления; сотрудник — ещё и свой статус рядом. */}
        {isLoggedIn && (
          <div className="ms-auto flex shrink-0 items-center gap-3">
            <ThemeMenu />
            <Bell />
            <WorkStatusControl compact />
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

  return (
    <header
      className="app-navbar fixed inset-x-0 top-0 border-b border-border bg-card"
      style={{ zIndex: 1030 }}
    >
      <NavProgress />
      <div className="flex h-full min-w-0 items-center gap-3 px-6">
        {isLoggedIn && (
          <SidebarTrigger
            aria-label={sidebarOpen ? "Свернуть меню" : "Открыть меню"}
            aria-expanded={sidebarOpen}
            title={sidebarOpen ? "Свернуть меню" : "Открыть меню"}
          />
        )}
        <span aria-hidden className="h-4 w-px flex-none bg-border" />
        <HeaderCrumbs />
        {isLoggedIn && (
          <div className="ms-auto flex flex-none items-center gap-4">
            <ThemeMenu />
            <Bell />
            <WorkStatusControl />
          </div>
        )}
      </div>
    </header>
  );
};

export default NavigationBar;
