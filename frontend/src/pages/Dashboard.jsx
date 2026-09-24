import { useContext, useEffect } from "react";
import { redirect } from "react-router";
import { MobileView } from "react-device-detect";

import FormOutlet from "@/components/app/FormOutlet";
import PageShell from "@/components/app/PageShell";
import KbAttention from "../components/Dashboard/KbAttention";
import MonitoringOffline from "../components/Dashboard/MonitoringOffline";
import MySupport from "../components/Dashboard/MySupport";
import MyReport from "../components/Dashboard/MyReport";
import MyTicketsClient from "../components/Dashboard/MyTicketsClient";
import ServiceExpiry from "../components/Dashboard/ServiceExpiry";
import StaffTickets from "../components/Dashboard/StaffTickets";
import TeamNow from "../components/Dashboard/TeamNow";
import TodayPlan from "../components/Dashboard/TodayPlan";
import UpcomingWorks from "../components/Dashboard/UpcomingWorks";
import TechSection from "@/components/app/TechSection";
import TemplateTiles from "../components/Dashboard/TemplateTiles";
import useLiveTopic from "@/hooks/use-live-topic";
import { useCan } from "@/store/authed-user";
import { AuthedUserContext } from "../store/authed-user-context";
import usePlannedWorksStore from "@/store/dashboard-planned-works";
import useDashboardTicketsStore from "../store/dashboard-tickets";
import useDashboardTemplatesStore from "../store/dashboard-templates";
import { warm } from "@/store/form-data";
import useInitialPrefsStore from "../store/prefs";
import { getLocalStorageData } from "../util/auth";

/**
 * Главная — ролевой лендинг.
 *
 * Не отчёт и не список: у неё нет своего предмета, она собрана из чужих. Отсюда
 * три правила, которых нет у остальных страниц.
 *
 * 1. Композиций две. Клиенту страница отвечает «что мне сделать и что с моими
 *    заявками», сотруднику — «что на мне сегодня». Общий у них ровно один блок
 *    (заготовки заявок), поэтому одной простынёй с десятком `&&` это не пишется.
 * 2. Пустой блок не рисуется вовсе — ни заголовка, ни заглушки. У клиента без
 *    техники, без открытых заявок и без ответственности остаются одни карточки
 *    заготовок, и это правильная страница, а не сломанная.
 * 3. Загрузка поблочная. Router-loader только проверяет вход; каждый блок
 *    ходит за своим сам, поэтому медленный (техника, переработки) не держит
 *    остальные. Исключение — заявки сотрудника: три среза одного набора («на
 *    мне», «без ответственного», «давно без движения») делят и запрос, и блок —
 *    `store/dashboard-tickets` + переключатель в `StaffTickets`; и свои плановые
 *    работы: «Сегодня в плане» и «Дальше в плане» — `store/dashboard-planned-works`.
 *
 * Раскладка сотрудника не знает заранее, какие блоки будут: каждый исчезает
 * без права или без данных. Поэтому места задаёт порядок и CSS, а не условия
 * в JSX — см. комментарии в `DashboardStaff`.
 */

const DashboardClient = () => {
  const { modules } = useInitialPrefsStore();

  // Права инженера тут НЕ спрашиваем: `canUseInventoryModule` открывает раздел
  // «Устройства» целиком, его нет ни у одного из 676 клиентов и не должно
  // быть. Своё рабочее место — не модуль учёта; скоуп считает токен на ручке
  // /my-workplace. Остаётся только модульный рубильник.
  const showTech = !!modules?.inventory?.isActive;

  return (
    <>
      <TemplateTiles />
      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] xl:items-start">
        <div className="flex flex-col gap-5">
          <MyTicketsClient />
          {showTech && (
            <div>
              <TechSection
                self
                subject="user"
                label="Моё рабочее место"
                hideWhenEmpty
                from="Главная"
              />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-5">
          <MySupport />
          <ServiceExpiry />
        </div>
      </div>
    </>
  );
};

const DashboardStaff = () => {
  const can = useCan();
  const timeTracking = useInitialPrefsStore(
    (state) => !!state.modules?.timeTracking?.isActive,
  );
  const canReadWorks = timeTracking && !!can({ work: ["read"] });
  // Шаблоны нужны тому, кто заводит заявки за клиентов — открыть шаблон, пока
  // клиент на линии, и идти по его вопросам. Остальным сотрудникам ряд только
  // отнимал первый экран у мониторинга и сроков; шаблон и так выбирается в
  // форме новой заявки
  const takesCalls = !!can({ ticket: ["createForOthers"] });
  const loadPlan = usePlannedWorksStore((state) => state.load);

  useEffect(() => {
    if (canReadWorks) loadPlan();
  }, [canReadWorks, loadPlan]);

  // Работу подтвердили, перенесли или запланировали — тема заявок
  // (docs/live-updates.md); тема шумная, не чаще раза в 30 секунд
  useLiveTopic("tickets", loadPlan, {
    enabled: canReadWorks,
    minIntervalMs: 30_000,
  });

  return (
    <>
      {/* Телефон: команда на главной вместо ленты в шелле — первой карточкой
          под приветствием (решение владельца 24.09: «на самый верх»); на
          десктопе её роль у рейла статусов. Отступ вниз даёт метка следующей
          секции (mt-6), своего у карточки нет */}
      <MobileView renderWithFragment>
        <TeamNow />
      </MobileView>
      {/* Сегодняшнее и неподтверждённое — над остальными блоками: место на
          главной решает срочность. Нет плана на сегодня — полосы нет */}
      <TodayPlan />
      {/* Правая колонка пуста (нет плана дальше и отчёта) — левая встаёт во
          всю ширину: пустую колонку `empty:hidden` снимает, а `has-[…]`
          сбрасывает сетку в одну колонку */}
      {/* `grid-cols-1` + `min-w-0` на колонках — не украшение: без шаблона
          колонка сетки не уже своего самого широкого ребёнка, и один
          несжимаемый ряд (переключатель, контролы отчёта) утаскивал всю
          главную за правый край телефона (макет «Главная на телефоне —
          аккуратно», 24.09) */}
      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] xl:items-start xl:has-[>div:last-child:empty]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Телефон: шаблоны после заявок (`order` в колонке, сетка не
              меняется) — первый экран там за «что на мне», а шаблон с телефона
              открывают редко */}
          {takesCalls && (
            <TemplateTiles heading="Шаблоны заявок" className="max-md:order-1" />
          )}
          <StaffTickets />
          {/* «Внимание»: сроки, база знаний, мониторинг — одна группа в две
              колонки. Блоки сами решают, быть ли им, поэтому раскладка —
              на селекторах, а не на условиях: три карточки — две в ряд и
              третья во всю ширину, две — одним рядом, одна — во всю ширину,
              ни одной — группы нет. Порядок внутри не меняется */}
          <div className="grid min-w-0 grid-cols-1 gap-5 empty:hidden max-md:order-2 md:grid-cols-2 md:items-start [&>:nth-child(3)]:col-span-full [&>:only-child]:col-span-full">
            <ServiceExpiry showCompany />
            <KbAttention />
            <MonitoringOffline />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-5 empty:hidden">
          <UpcomingWorks />
          <MyReport />
        </div>
      </div>
    </>
  );
};

const Dashboard = () => {
  const { firstName, isEndUser } = useContext(AuthedUserContext);
  const load = useDashboardTicketsStore((state) => state.load);
  const refresh = useDashboardTicketsStore((state) => state.refresh);
  const loadTemplates = useDashboardTemplatesStore((state) => state.load);
  const templatesLoaded = useDashboardTemplatesStore((state) => state.loaded);
  const templatesCount = useDashboardTemplatesStore(
    (state) => state.templates.length,
  );

  useEffect(() => {
    load();
    loadTemplates();
  }, [load, loadTemplates]);

  // Справочники формы заявки — заранее: «Новая заявка» с главной открывается
  // без ожидания form-data. Список шаблонов греть отдельно не нужно: его берёт
  // из того же кэша store/dashboard-templates
  useEffect(() => {
    warm("/api/tickets/form-data");
  }, []);

  // Открытые заявки перечитываются, когда заявки изменились (docs/live-updates.md);
  // не чаще раза в 15 секунд — выборка тяжёлая, а в час пик меняется непрерывно
  useLiveTopic("tickets", refresh, { minIntervalMs: 15_000 });

  // «пятница, 1 августа» — день недели тут не украшение: половина блоков
  // сотрудника про «сегодня», и заголовок закрепляет, какое оно.
  const today = new Date().toLocaleDateString("ru", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <PageShell
      title={
        isEndUser ? "Чем помочь?" : `Здравствуйте, ${firstName || ""}`.trim()
      }
      subtitle={
        isEndUser
          ? // Подзаголовок обещает список — значит, он есть только когда список
            // есть: клиенту, которому не роздан ни один шаблон, обещать нечего,
            // и всё нужное скажет подпись единственной карточки
            templatesLoaded && templatesCount > 0
            ? "Выберите подходящий запрос из списка или создайте новую задачу"
            : undefined
          : today
      }
    >
      {isEndUser ? <DashboardClient /> : <DashboardStaff />}
      {/* «Новая заявка» — вложенный маршрут главной (tickets/add) в шторке */}
      <FormOutlet />
    </PageShell>
  );
};

// Главная открыта всем вошедшим: рубильник `user.dashboard.isActive` и шесть
// флагов блоков удалены — состав страницы считают права и наличие данных.
export function loader() {
  const { token } = getLocalStorageData();
  if (!token) {
    return redirect("/auth");
  }
  document.title = "Главная";
  return null;
}

export default Dashboard;
