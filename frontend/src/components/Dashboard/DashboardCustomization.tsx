import {
  RiAddLine,
  RiRestartLine,
  RiSaveLine,
  RiSettings3Line,
} from "react-icons/ri";

import MobileActionBar from "@/components/app/MobileActionBar";
import { isMobile } from "react-device-detect";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import CountPill from "@/components/app/CountPill";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DashboardLayout, DashboardWidgetId } from "@/types/dashboard";

import { toggleWidget, WIDGET_LABELS } from "./layout";
import type useDashboardLayout from "./use-dashboard-layout";

export type Customization = ReturnType<typeof useDashboardLayout>;

export function DashboardSettingsButton({
  settings,
}: {
  settings: Customization;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Настроить главную"
          aria-pressed={settings.editing}
          disabled={settings.saving}
          onClick={() => {
            if (!settings.editing) settings.start();
          }}
          className={
            settings.editing
              ? "bg-primary/15 text-accent-text hover:bg-primary/20"
              : undefined
          }
        >
          <RiSettings3Line size={20} aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>Настроить главную</TooltipContent>
    </Tooltip>
  );
}

export function DashboardSettingsPanel({
  settings,
  available,
  mobile,
  label,
}: {
  settings: Customization;
  available: ReadonlySet<DashboardWidgetId>;
  mobile: boolean;
  label: (id: DashboardWidgetId) => string;
}) {
  if (!settings.editing) return null;
  const hidden = settings.layout.widgets.filter(
    (widget) => !widget.visible && available.has(widget.id),
  );
  const toggle = (id: DashboardWidgetId) =>
    settings.setDraft((current) => current && toggleWidget(current, id));
  const team = settings.layout.widgets.find((widget) => widget.id === "team");
  return (
    <section
      aria-label="Настройка Главной"
      className="mb-6 rounded-xl border border-border bg-accent/40 p-4"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Настройка Главной</div>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">
            Перетаскивайте виджеты за ручку или перемещайте стрелками. Ненужные
            можно скрыть.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={settings.saving}
          onClick={settings.reset}
        >
          <RiRestartLine aria-hidden />
          Восстановить по умолчанию
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border-soft pt-3">
        <span className="mr-1 inline-flex items-center gap-2 text-sm text-muted-foreground">
          Скрытые виджеты{" "}
          {hidden.length > 0 && <CountPill>{hidden.length}</CountPill>}
        </span>
        {hidden.length ? (
          hidden.map((widget) => (
            <Button
              key={widget.id}
              type="button"
              variant="outline"
              size="xs"
              disabled={settings.saving}
              onClick={() => toggle(widget.id)}
            >
              <RiAddLine aria-hidden />
              {label(widget.id)}
            </Button>
          ))
        ) : (
          <span className="text-sm text-faint">
            Все доступные виджеты включены
          </span>
        )}
      </div>
      {!mobile && team && available.has("team") && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-soft pt-3 text-sm text-muted-foreground">
          <span>«{WIDGET_LABELS.team}» отображается только на телефоне</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={settings.saving}
            onClick={() => toggle("team")}
          >
            {team.visible ? "Скрыть" : "Показать"}
          </Button>
        </div>
      )}
    </section>
  );
}

export function DashboardSettingsActions({
  settings,
}: {
  settings: Customization;
}) {
  return (
    <>
      {isMobile ? (
        <MobileActionBar
          show={settings.editing}
          statusText={
            settings.dirty ? "Раскладка изменена" : "Настройка Главной"
          }
          ariaLabel="Настройка Главной"
          actions={[{ key: "save", icon: RiSaveLine, label: "Сохранить" }]}
          isLoading={settings.saving}
          onPick={() => {
            void settings.save();
          }}
          onCancel={settings.cancel}
          cancelLabel="Отмена"
        />
      ) : (
        settings.editing && (
          <div
            className="draft-bar pointer-events-none fixed inset-x-0 bottom-4 flex justify-center px-4"
            style={{ zIndex: 1100 }}
          >
            <div
              role="toolbar"
              aria-label="Настройка Главной"
              className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-lg"
            >
              <span className="inline-flex items-center gap-2 pr-2 text-sm font-semibold">
                <span
                  aria-hidden
                  className={
                    settings.dirty
                      ? "size-1.5 rounded-full bg-warning"
                      : "size-1.5 rounded-full bg-faint"
                  }
                />
                {settings.dirty ? "Раскладка изменена" : "Настройка Главной"}
              </span>
              <Button
                type="button"
                variant="ghost"
                disabled={settings.saving}
                onClick={settings.cancel}
              >
                Отмена
              </Button>
              <Button
                type="button"
                disabled={settings.saving}
                onClick={() => {
                  void settings.save();
                }}
              >
                <RiSaveLine aria-hidden />
                {settings.saving ? "Сохранение…" : "Сохранить"}
              </Button>
            </div>
          </div>
        )
      )}
      <ConfirmDialog
        open={settings.blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && !settings.saving) settings.blocker.reset?.();
        }}
        title="Уйти без сохранения?"
        description="Изменения состава и расположения виджетов пропадут."
        confirmLabel="Уйти"
        isLoading={settings.saving}
        onConfirm={() => settings.blocker.proceed?.()}
      />
    </>
  );
}

export function changeLayout(
  settings: Customization,
  change: (layout: DashboardLayout) => DashboardLayout,
) {
  if (!settings.saving)
    settings.setDraft((current) => current && change(current));
}
