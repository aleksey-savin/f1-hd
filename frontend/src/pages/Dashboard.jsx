import { useEffect, useMemo } from "react";
import { isMobile } from "react-device-detect";

import FormOutlet from "@/components/app/FormOutlet";
import PageShell from "@/components/app/PageShell";
import TechSection from "@/components/app/TechSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import AgentChanges from "@/components/Dashboard/AgentChanges";
import UserReviewAttention from "@/components/Dashboard/UserReviewAttention";
import DashboardLayout from "@/components/Dashboard/DashboardLayout";
import {
  DashboardSettingsActions,
  DashboardSettingsButton,
  DashboardSettingsPanel,
} from "@/components/Dashboard/DashboardCustomization";
import {
  availableWidgets,
  dataRequirements,
  WIDGET_LABELS,
} from "@/components/Dashboard/layout";
import useDashboardLayout from "@/components/Dashboard/use-dashboard-layout";
import KbAttention from "@/components/Dashboard/KbAttention";
import MonitoringOffline from "@/components/Dashboard/MonitoringOffline";
import MySupport from "@/components/Dashboard/MySupport";
import MyReport from "@/components/Dashboard/MyReport";
import MyTicketsClient from "@/components/Dashboard/MyTicketsClient";
import ServiceExpiry from "@/components/Dashboard/ServiceExpiry";
import StaffTickets from "@/components/Dashboard/StaffTickets";
import TeamNow from "@/components/Dashboard/TeamNow";
import TodayPlan from "@/components/Dashboard/TodayPlan";
import UpcomingWorks from "@/components/Dashboard/UpcomingWorks";
import TemplateTiles from "@/components/Dashboard/TemplateTiles";
import { setDocTitle } from "@/hooks/use-doc-title";
import useLiveTopic from "@/hooks/use-live-topic";
import { useAuthedUser, useCan } from "@/store/authed-user";
import usePlannedWorksStore from "@/store/dashboard-planned-works";
import useDashboardTicketsStore from "@/store/dashboard-tickets";
import useDashboardTemplatesStore from "@/store/dashboard-templates";
import { warm } from "@/store/form-data";
import useInitialPrefsStore from "@/store/prefs";

// Главная остаётся ролевым лендингом. Персональная раскладка меняет только
// композицию: доступность считают те же права/модули, данные — сами блоки.
// Скрытые блоки не монтируются. Общие запросы живут здесь и нужны, пока есть
// хотя бы один включённый потребитель (план делят TodayPlan и UpcomingWorks).
const DashboardPage = () => {
  const user = useAuthedUser();
  const { firstName, isEndUser, hideWorkStatus } = user;
  const audience = isEndUser ? "client" : "staff";
  const modules = useInitialPrefsStore((state) => state.modules);
  const can = useCan();
  const settings = useDashboardLayout(user.dashboardLayout, audience);
  const available = useMemo(
    () => availableWidgets({ audience, modules, can, hideWorkStatus }),
    [audience, modules, can, hideWorkStatus],
  );
  const needs = dataRequirements(settings.layout, available);
  const load = useDashboardTicketsStore((state) => state.load);
  const refresh = useDashboardTicketsStore((state) => state.refresh);
  const loadTemplates = useDashboardTemplatesStore((state) => state.load);
  const templatesLoaded = useDashboardTemplatesStore((state) => state.loaded);
  const templatesCount = useDashboardTemplatesStore(
    (state) => state.templates.length,
  );
  const loadPlan = usePlannedWorksStore((state) => state.load);

  useEffect(() => {
    if (needs.tickets) load();
  }, [needs.tickets, load]);
  useEffect(() => {
    if (needs.templates) loadTemplates();
  }, [needs.templates, loadTemplates]);
  useEffect(() => {
    if (needs.plan) loadPlan();
  }, [needs.plan, loadPlan]);
  useEffect(() => {
    if (needs.tickets || needs.templates) warm("/api/tickets/form-data");
  }, [needs.tickets, needs.templates]);

  useLiveTopic("tickets", refresh, {
    enabled: needs.tickets,
    minIntervalMs: 15_000,
  });
  useLiveTopic("tickets", loadPlan, {
    enabled: needs.plan,
    minIntervalMs: 30_000,
  });

  const label = (id) =>
    id === "tickets" && isEndUser ? "Мои заявки" : WIDGET_LABELS[id];
  // Две ролевые композиции; общие компоненты сохраняют свои API, ссылки,
  // локальные состояния и правило «нет данных — нет блока».
  const content = isEndUser
    ? {
        templates: <TemplateTiles />,
        tickets: <MyTicketsClient />,
        workplace: (
          <TechSection
            self
            subject="user"
            label="Моё рабочее место"
            hideWhenEmpty
            from="Главная"
          />
        ),
        support: <MySupport />,
        expiry: <ServiceExpiry />,
      }
    : {
        team: <TeamNow />,
        today: <TodayPlan />,
        agentChanges: <AgentChanges />,
        templates: <TemplateTiles heading="Шаблоны заявок" />,
        userReview: <UserReviewAttention />,
        tickets: <StaffTickets />,
        expiry: <ServiceExpiry showCompany />,
        knowledge: <KbAttention />,
        monitoring: <MonitoringOffline />,
        upcoming: <UpcomingWorks />,
        report: <MyReport />,
      };
  const widgets = Object.fromEntries(
    Object.entries(content).map(([id, component]) => [
      id,
      { label: label(id), content: component },
    ]),
  );
  const today = new Date().toLocaleDateString("ru", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <TooltipProvider delayDuration={200}>
      <PageShell
        breadcrumbTitle="Главная"
        title={
          isEndUser ? "Чем помочь?" : `Здравствуйте, ${firstName || ""}`.trim()
        }
        subtitle={
          isEndUser
            ? needs.templates && templatesLoaded && templatesCount > 0
              ? "Выберите подходящий запрос из списка или создайте новую задачу"
              : undefined
            : today
        }
        action={<DashboardSettingsButton settings={settings} />}
      >
        <DashboardSettingsPanel
          settings={settings}
          available={available}
          mobile={isMobile}
          label={label}
        />
        <DashboardLayout
          settings={settings}
          widgets={widgets}
          available={available}
          mobile={isMobile}
        />
        <DashboardSettingsActions settings={settings} />
        <FormOutlet />
      </PageShell>
    </TooltipProvider>
  );
};

const Dashboard = () => {
  const user = useAuthedUser();
  // Подмена/смена аудитории не должна переносить незавершённый черновик.
  return (
    <DashboardPage key={`${user._id}:${user.isEndUser ? "client" : "staff"}`} />
  );
};

export function loader() {
  setDocTitle("Главная");
  return null;
}
export default Dashboard;
