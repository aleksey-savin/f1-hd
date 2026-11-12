import { useContext, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { RiArrowDownSLine, RiCloseLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { NavCount } from "@/components/Conversation/NavBadges";
import { AuthedUserContext } from "@/store/authed-user-context";
import { useCan } from "@/store/authed-user";
import useInitialPrefs from "@/store/prefs";
import Brand from "./Navigation/Brand";
import UserMenu, { UserMenuTrigger } from "./Navigation/UserMenu";
import { activeMenuKey, buildMenu } from "./Navigation/menu";

const linkClass =
  "h-auto min-h-9 py-1.5 no-underline [&>span:last-child]:whitespace-normal data-[active=true]:bg-primary/15 data-[active=true]:text-accent-text";

function NavigationSection({ item, activeKey, onNavigate }) {
  const active = item.groups.some((group) =>
    group.items.some((child) => child.key === activeKey),
  );
  const [open, setOpen] = useState(active || item.defaultOpen !== false);

  // Переход по прямой ссылке или истории раскрывает текущую ветку.
  useEffect(() => {
    if (active) setOpen(true);
  }, [active, activeKey]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={active}
            className={`${linkClass} group/section cursor-pointer`}
          >
            <item.icon
              size={18}
              aria-hidden
              className={active ? "text-accent-text" : "text-muted-foreground"}
            />
            <span className="min-w-0 flex-1">{item.label}</span>
            <RiArrowDownSLine
              size={16}
              aria-hidden
              className="transition-transform group-data-[state=open]/section:rotate-180 motion-reduce:transition-none"
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {item.groups.map((group, index) => (
            <div key={group.label ?? index}>
              {group.label && (
                <div className="pt-3 pb-1 pl-8 text-xs font-medium text-muted-foreground">
                  {group.label}
                </div>
              )}
              <SidebarMenuSub>
                {group.items.map((child) => (
                  <SidebarMenuSubItem key={child.key}>
                    <SidebarMenuSubButton
                      asChild
                      isActive={child.key === activeKey}
                      className={linkClass}
                    >
                      <Link
                        to={child.to}
                        aria-current={
                          child.key === activeKey ? "page" : undefined
                        }
                        onClick={onNavigate}
                      >
                        <child.icon size={16} aria-hidden />
                        <span>{child.label}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            </div>
          ))}
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

export default function AppSidebar() {
  const { isEndUser, hideWorkStatus } = useContext(AuthedUserContext);
  const can = useCan();
  const { modules } = useInitialPrefs();
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const items = useMemo(
    () => buildMenu({ isEndUser, can, modules, hideWorkStatus }),
    [isEndUser, can, modules, hideWorkStatus],
  );
  const activeKey = activeMenuKey(items, pathname);
  const close = () => setOpenMobile(false);

  return (
    <Sidebar
      collapsible="offcanvas"
      className="app-sidebar bg-card text-foreground"
    >
      <SidebarHeader className="app-sidebar-header shrink-0 flex-row items-center justify-between gap-2 border-b px-4">
        <div className="min-w-0 flex-1 overflow-hidden">
          <Brand size="sm" />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Закрыть меню"
          className="lg:hidden"
          onClick={close}
        >
          <RiCloseLine size={18} aria-hidden />
        </Button>
      </SidebarHeader>
      <SidebarContent className="scrollbar-none">
        <SidebarGroup>
          <nav aria-label="Основная навигация">
            <SidebarMenu>
              {items.map((item) =>
                item.groups ? (
                  <NavigationSection
                    key={item.key}
                    item={item}
                    activeKey={activeKey}
                    onNavigate={close}
                  />
                ) : (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      asChild
                      isActive={item.key === activeKey}
                      className={linkClass}
                    >
                      <Link
                        to={item.to}
                        aria-current={
                          item.key === activeKey ? "page" : undefined
                        }
                        onClick={close}
                      >
                        <item.icon
                          size={18}
                          aria-hidden
                          className={
                            item.key === activeKey
                              ? "text-accent-text"
                              : "text-muted-foreground"
                          }
                        />
                        <span className="min-w-0 flex-1">{item.label}</span>
                        {item.badge === "conversations" && <NavCount />}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ),
              )}
            </SidebarMenu>
          </nav>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="shrink-0 border-t p-2">
        <UserMenu
          side="right"
          onNavigate={close}
          trigger={<UserMenuTrigger />}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
