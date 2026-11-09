import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Portal } from "radix-ui";
import {
  RiArrowDownLine,
  RiArrowLeftRightLine,
  RiArrowUpLine,
  RiDraggable,
  RiEyeOffLine,
  RiSettings3Line,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  DashboardWidget,
  DashboardWidgetId,
  DashboardZone,
} from "@/types/dashboard";

import { changeLayout, type Customization } from "./DashboardCustomization";
import {
  groupWidgets,
  widgetGroupKey,
  moveWidget,
  stepWidget,
  toggleWidget,
  visibleWidgets,
  ZONE_LABELS,
  ZONES,
} from "./layout";
import "./dashboard-layout.css";

type Drag = { id: DashboardWidgetId; x: number; y: number };
type Target = { zone: DashboardZone; before: DashboardWidgetId | null };
type Descriptor = { label: string; content: ReactNode };
export type DashboardWidgets = Partial<Record<DashboardWidgetId, Descriptor>>;

function IconAction({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function DashboardLayout({
  settings,
  widgets,
  available,
  mobile,
}: {
  settings: Customization;
  widgets: DashboardWidgets;
  available: ReadonlySet<DashboardWidgetId>;
  mobile: boolean;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dragRef = useRef<Drag | null>(null);
  const targetRef = useRef<Target | null>(null);
  const focusAfterMove = useRef<DashboardWidgetId | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const active = visibleWidgets(settings.layout, available, mobile);
  const peers = (widget: DashboardWidget) =>
    active.filter((item) => item.zone === widget.zone);
  const move = (
    id: DashboardWidgetId,
    zone: DashboardZone,
    before: DashboardWidgetId | null = null,
  ) => {
    focusAfterMove.current = id;
    changeLayout(settings, (layout) =>
      moveWidget(layout, id, zone, before, mobile),
    );
    setAnnouncement(
      `${widgets[id]!.label}: ${ZONE_LABELS[zone].toLowerCase()}`,
    );
  };
  const step = (widget: DashboardWidget, direction: -1 | 1) => {
    focusAfterMove.current = widget.id;
    changeLayout(settings, (layout) =>
      stepWidget(layout, widget.id, direction, available, mobile),
    );
    setAnnouncement(
      `${widgets[widget.id]!.label}: ${direction < 0 ? "перемещён выше" : "перемещён ниже"}`,
    );
  };
  const clearDrag = () => {
    dragRef.current = null;
    targetRef.current = null;
    setDrag(null);
    setTarget(null);
  };
  // A move can split/merge the attention grid and remount its wrapper.
  // Restore the moved handle after React and the dropdown finish moving focus.
  useEffect(() => {
    const id = focusAfterMove.current;
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      root.current
        ?.querySelector<HTMLButtonElement>(
          `[data-dashboard-widget="${id}"] [data-dashboard-handle]`,
        )
        ?.focus();
      focusAfterMove.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [settings.layout]);
  useEffect(() => {
    if (!settings.editing) clearDrag();
  }, [settings.editing]);

  // Scroll the app-shell's scroll container on phones, the document on desktop.
  useEffect(() => {
    if (!drag) return;
    let frame: number;
    const tick = () => {
      const current = dragRef.current;
      if (!current) return;
      const scroll =
        root.current?.closest<HTMLElement>(".mobile-shell__scroll") ??
        document.scrollingElement;
      const bounds =
        scroll === document.scrollingElement
          ? { top: 0, bottom: window.innerHeight }
          : scroll?.getBoundingClientRect();
      if (scroll && bounds) {
        const speed =
          current.y < bounds.top + 90
            ? -12
            : current.y > bounds.bottom - 120
              ? 12
              : 0;
        if (speed) {
          scroll.scrollBy(0, speed);
          updateTarget(current);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [!!drag]);

  const updateTarget = (current: Drag) => {
    const hit = document.elementFromPoint(current.x, current.y);
    const area = hit?.closest<HTMLElement>("[data-dashboard-zone]");
    let next: Target | null = null;
    if (area && root.current?.contains(area)) {
      const zone = area.dataset.dashboardZone as DashboardZone;
      const element = hit?.closest<HTMLElement>("[data-dashboard-widget]");
      if (element?.dataset.dashboardWidget === current.id) next = null;
      else {
        let before = element?.dataset.dashboardWidget as
          | DashboardWidgetId
          | undefined;
        if (
          element &&
          current.y >
            element.getBoundingClientRect().top +
              element.getBoundingClientRect().height / 2
        ) {
          const cards = Array.from(
            area.querySelectorAll<HTMLElement>("[data-dashboard-widget]"),
          );
          before = cards
            .slice(cards.indexOf(element) + 1)
            .find((card) => card.dataset.dashboardWidget !== current.id)
            ?.dataset.dashboardWidget as DashboardWidgetId | undefined;
        }
        next = { zone, before: before ?? null };
      }
    }
    targetRef.current = next;
    setTarget(next);
  };
  const startDrag = (
    event: PointerEvent<HTMLButtonElement>,
    widget: DashboardWidget,
  ) => {
    if (event.button !== 0 || settings.saving) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = { id: widget.id, x: event.clientX, y: event.clientY };
    dragRef.current = current;
    setDrag(current);
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    const current = { ...dragRef.current, x: event.clientX, y: event.clientY };
    dragRef.current = current;
    setDrag(current);
    updateTarget(current);
  };
  const endDrag = () => {
    if (dragRef.current && targetRef.current)
      move(
        dragRef.current.id,
        targetRef.current.zone,
        targetRef.current.before,
      );
    clearDrag();
  };

  const renderWidget = (widget: DashboardWidget) => {
    const descriptor = widgets[widget.id]!;
    if (!settings.editing)
      return <Fragment key={widget.id}>{descriptor.content}</Fragment>;
    const siblings = peers(widget);
    const index = siblings.findIndex((item) => item.id === widget.id);
    return (
      <section
        key={widget.id}
        data-dashboard-widget={widget.id}
        className={cn(
          "dashboard-widget min-w-0 rounded-xl",
          drag?.id === widget.id && "opacity-35",
          target?.before === widget.id && "dashboard-drop-before",
        )}
        aria-label={descriptor.label}
      >
        <div className="mb-2 flex min-w-0 items-center gap-0.5">
          <IconAction
            label={`Перетащить: ${descriptor.label}`}
            disabled={settings.saving}
            className="cursor-grab touch-none active:cursor-grabbing"
            data-dashboard-handle
            onPointerDown={(event) => startDrag(event, widget)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={clearDrag}
            onLostPointerCapture={clearDrag}
            onKeyDown={(event) => {
              if (
                event.altKey &&
                ["ArrowUp", "ArrowDown"].includes(event.key)
              ) {
                event.preventDefault();
                step(widget, event.key === "ArrowUp" ? -1 : 1);
              }
            }}
          >
            <RiDraggable aria-hidden />
          </IconAction>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {ZONE_LABELS[widget.zone]}
          </span>
          <IconAction
            label={`Выше: ${descriptor.label}`}
            disabled={settings.saving || index === 0}
            onClick={() => step(widget, -1)}
          >
            <RiArrowUpLine aria-hidden />
          </IconAction>
          <IconAction
            label={`Ниже: ${descriptor.label}`}
            disabled={settings.saving || index === siblings.length - 1}
            onClick={() => step(widget, 1)}
          >
            <RiArrowDownLine aria-hidden />
          </IconAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={settings.saving}
                aria-label={`Переместить: ${descriptor.label}`}
                title="Переместить в другую область"
              >
                <RiArrowLeftRightLine aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {ZONES.map((zone) => (
                <DropdownMenuItem
                  key={zone}
                  disabled={zone === widget.zone}
                  onSelect={() => move(widget.id, zone)}
                >
                  {ZONE_LABELS[zone]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <IconAction
            label={`Скрыть: ${descriptor.label}`}
            disabled={settings.saving}
            onClick={() => {
              changeLayout(settings, (layout) =>
                toggleWidget(layout, widget.id),
              );
              setAnnouncement(`${descriptor.label}: скрыт`);
            }}
          >
            <RiEyeOffLine aria-hidden />
          </IconAction>
        </div>
        <div
          className="dashboard-widget-body pointer-events-none select-none"
          inert
        >
          {descriptor.content}
        </div>
        <div className="dashboard-widget-empty rounded-xl border border-dashed border-border p-4">
          <div className="font-medium">{descriptor.label}</div>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">
            Виджет появится, когда будут данные.
          </p>
        </div>
      </section>
    );
  };

  const renderZone = (zone: DashboardZone) => {
    const items = active.filter((widget) => widget.zone === zone);
    const groups =
      zone === "main" ? groupWidgets(items) : items.map((widget) => [widget]);
    return (
      <div
        data-dashboard-zone={zone}
        className={cn(
          "dashboard-region flex min-w-0 flex-col gap-5",
          zone === "main"
            ? "dashboard-main"
            : zone === "aside"
              ? "dashboard-aside"
              : "dashboard-top",
          target?.zone === zone && !target.before && "rounded-xl bg-primary/5",
        )}
      >
        {groups.map((group) =>
          group.length > 1 ? (
            <div
              key={widgetGroupKey(group)}
              className="grid min-w-0 grid-cols-1 gap-5 empty:hidden md:grid-cols-2 md:items-start [&>:nth-child(3)]:col-span-full [&>:only-child]:col-span-full"
            >
              {group.map(renderWidget)}
            </div>
          ) : (
            renderWidget(group[0])
          ),
        )}
        {settings.editing && (
          <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            <RiDraggable size={18} className="mr-1 inline" aria-hidden />
            {ZONE_LABELS[zone]} · перетащите виджет сюда
          </div>
        )}
      </div>
    );
  };
  return (
    <div ref={root} data-dashboard-editing={settings.editing}>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      {renderZone("top")}
      <div className="dashboard-columns mt-6 grid grid-cols-1 items-start gap-5">
        {renderZone("main")}
        {renderZone("aside")}
      </div>
      {!settings.editing && active.length === 0 && (
        <div className="py-14 text-center">
          <RiSettings3Line
            size={28}
            className="mx-auto mb-3 text-faint"
            aria-hidden
          />
          <div className="font-medium">Все виджеты скрыты</div>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">
            Вернуть их можно через шестерёнку вверху страницы.
          </p>
        </div>
      )}
      {drag && (
        <Portal.Root>
          <div
            className="pointer-events-none fixed z-50 max-w-72 rounded-lg border border-primary bg-card px-4 py-3 text-sm font-semibold shadow-lg"
            style={{ left: drag.x + 16, top: drag.y + 16, zIndex: 1200 }}
          >
            <RiDraggable
              size={18}
              className="mr-2 inline text-accent-text"
              aria-hidden
            />
            {widgets[drag.id]!.label}
          </div>
        </Portal.Root>
      )}
    </div>
  );
}
