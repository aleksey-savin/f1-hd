import { useContext, useEffect } from "react";
import { redirect } from "react-router";
import { MobileView } from "react-device-detect";

import PageShell from "@/components/app/PageShell";
import KbAttention from "../components/Dashboard/KbAttention";
import MonitoringOffline from "../components/Dashboard/MonitoringOffline";
import MySupport from "../components/Dashboard/MySupport";
import MyTicketsClient from "../components/Dashboard/MyTicketsClient";
import ScheduledWorks from "../components/Dashboard/ScheduledWorks";
import ServiceExpiry from "../components/Dashboard/ServiceExpiry";
import StaffKpis from "../components/Dashboard/StaffKpis";
import StaffTickets from "../components/Dashboard/StaffTickets";
import TeamNow from "../components/Dashboard/TeamNow";
import TechSection from "@/components/app/TechSection";
import TemplateTiles from "../components/Dashboard/TemplateTiles";
import usePolling from "../hooks/use-polling";
import { AuthedUserContext } from "../store/authed-user-context";
import useDashboardTicketsStore from "../store/dashboard-tickets";
import useInitialPrefsStore from "../store/prefs";
import { getLocalStorageData } from "../util/auth";
import { useCan } from "@/store/authed-user";

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
 *    остальные. Исключение — три «заявочных» блока сотрудника: они делят один
 *    запрос через `store/dashboard-tickets`.
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
  // Заготовки сотруднику — под правом администрирования заявок: остальным они
  // не инструмент, а лишний ряд плиток над тем, за чем сюда пришли.
  const showTemplates = !!can({ ticket: ["administrate"] });

  return (
    <>
      {/* Телефон: команда на главной вместо ленты в шелле; на десктопе —
          рейл, блок был бы дублированием */}
      <MobileView renderWithFragment>
        <TeamNow />
      </MobileView>
      <StaffKpis />
      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] xl:items-start">
        <div className="flex flex-col gap-5">
          <StaffTickets />
          {showTemplates && <TemplateTiles heading="Заготовки заявок" />}
        </div>
        <div className="flex flex-col gap-5">
          <MonitoringOffline />
          <ScheduledWorks />
          <KbAttention />
          <ServiceExpiry showCompany />
        </div>
      </div>
    </>
  );
};

const Dashboard = () => {
  const { firstName, isEndUser } = useContext(AuthedUserContext);
  const load = useDashboardTicketsStore((state) => state.load);
  const refresh = useDashboardTicketsStore((state) => state.refresh);

  useEffect(() => {
    load();
  }, [load]);

  usePolling(refresh, { intervalMs: 15000 });

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
          ? "Выберите готовый запрос — заявка заполнится сама. Ничего не подходит — опишите словами."
          : today
      }
    >
      {isEndUser ? <DashboardClient /> : <DashboardStaff />}
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
