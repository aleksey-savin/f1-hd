import { useEffect, useRef } from "react";
import { useLocation, useRevalidator } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";
import { Outlet, useLoaderData, useSubmit } from "react-router";

import {
  AuthedUserContext,
  defaultAuthedUser,
} from "../store/authed-user-context";

import NavigationBar from "./Navbar";
import Footer from "./Footer";
import WorkStatusBar from "../components/User/WorkStatusBar";
import { Toaster } from "@/components/ui/sonner";
import { RiRefreshLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import AppBanner from "@/components/app/AppBanner";
import { cn } from "@/lib/utils";

import Transitions from "../animations/Transition";

import MobileBottomNavbar from "./MobileBottomNavbar";

import { getLocalStorageData, getTokenDuration } from "../util/auth";
import useOffcanvasStore from "../store/offcanvas";
import useInitialPrefsStore from "../store/prefs";
import useRouteErrorStore from "../store/route-error";

// Страницы живут прямо на канве: заголовок — на канве, панель — у самого
// списка (согласованный макет, см. docs/ux-ui-guide.md → раздел миграции).
// maxWidth — контентная ширина страницы (её max-w-*) + горизонтальный p-4
// листа; сам лист рисуется только под фоновой картинкой.
const MIGRATED_ROUTES = [
  // Главная: ролевой лендинг, PageShell max-w-7xl + 2×24.
  // «/» — точным совпадением, иначе префикс поймал бы вообще
  // всё остальное приложение.
  { path: "/dashboard", maxWidth: 1328 },
  { path: "/", maxWidth: 1328, exact: true },
  // Заявки: список ListWrapper (max-w-7xl) и карточка (тоже
  // max-w-7xl — рейл + секции + хроника). Форма создания
  // живёт в шторке списка, поэтому идёт первой; «/tickets/»
  // (со слэшем) ловит карточку и её вложенные маршруты
  { path: "/tickets/checklist-templates", maxWidth: 1328 },
  { path: "/tickets/add", maxWidth: 1328 },
  // Карточка шире списка: max-w-8xl (1440) + 2×24 — виджету
  // «Окружение» в 1280 не хватало места
  { path: "/tickets/", maxWidth: 1488 },
  { path: "/tickets", maxWidth: 1328, exact: true },
  // Расположения: карточка (max-w-4xl, со слэшем) матчится
  // раньше списка (max-w-7xl) — порядок в .find важен
  { path: "/inventory/locations/", maxWidth: 944 },
  { path: "/inventory/locations", maxWidth: 1328 },
  // Вендоры: карточка (max-w-4xl, со слэшем) матчится
  // раньше списка (max-w-7xl) — порядок в .find важен
  { path: "/inventory/vendors/", maxWidth: 944 },
  // ListWrapper: max-w-7xl (1280) + 2×24
  { path: "/inventory/vendors", maxWidth: 1328 },
  { path: "/inventory/device-attributes", maxWidth: 1328 },
  // Поставщики: карточка (max-w-4xl, со слэшем) матчится
  // раньше списка (max-w-7xl) — порядок в .find важен
  { path: "/inventory/suppliers/", maxWidth: 944 },
  { path: "/inventory/suppliers", maxWidth: 1328 },
  // Устройства: формы списка (add/update/:id) — его ширина;
  // карточка (max-w-5xl + рейл, со слэшем) идёт ПОСЛЕ них, но
  // ДО точного «/inventory/client-devices»
  { path: "/inventory/client-devices/add", maxWidth: 1328 },
  {
    path: "/inventory/client-devices/update",
    maxWidth: 1328,
  },
  { path: "/inventory/client-devices/", maxWidth: 1072 },
  {
    path: "/inventory/client-devices",
    maxWidth: 1328,
    exact: true,
  },
  // Типы: карточка (max-w-4xl, со слэшем) матчится раньше
  // списка (max-w-7xl) — порядок в .find важен
  { path: "/inventory/device-types/", maxWidth: 944 },
  { path: "/inventory/device-types", maxWidth: 1328 },
  // Модели: карточка/формы (max-w-4xl, со слэшем) матчатся
  // раньше списка (max-w-7xl) — порядок в .find важен
  { path: "/inventory/device-models/", maxWidth: 944 },
  { path: "/inventory/device-models", maxWidth: 1328 },
  { path: "/ticket-categories", maxWidth: 1328 },
  // Компании: формы add/update — в шторке списка (та же
  // ширина); карточка /companies/:id — с рейлом-якорем
  // (max-w-5xl, со слэшем) — идёт ПОСЛЕ форм списка,
  // но ДО точного «/companies»
  { path: "/companies/add", maxWidth: 1328 },
  { path: "/companies/update", maxWidth: 1328 },
  { path: "/companies/", maxWidth: 1072 },
  { path: "/companies", maxWidth: 1328, exact: true },
  // Шаблоны: карточка (max-w-4xl, со слэшем) матчится раньше
  // списка (max-w-7xl) — порядок в .find важен
  { path: "/ticket-templates/", maxWidth: 944 },
  // ListWrapper: max-w-7xl (1280) + 2×24
  { path: "/ticket-templates", maxWidth: 1328 },
  // Регламенты: карточка (со слэшем) матчится раньше списка
  { path: "/routine-tasks/", maxWidth: 944 },
  { path: "/routine-tasks", maxWidth: 1328 },
  // Услуги: карточка/формы (max-w-4xl, со слэшем) матчатся
  // раньше списка (max-w-7xl) — порядок в .find важен
  { path: "/finances/service-plans/", maxWidth: 944 },
  { path: "/finances/service-plans", maxWidth: 1328 },
  // Пользователи: список на канве (max-w-7xl), формы add/update
  // списка — в его шторке (та же ширина). Карточка /users/:id —
  // max-w-4xl, поэтому «/users/» (со слэшем) идёт ПОСЛЕ форм
  // списка, но ДО точного «/users», иначе перехватила бы их.
  { path: "/users/add", maxWidth: 1328 },
  { path: "/users/update", maxWidth: 1328 },
  // карточка с рейлом-якорем: max-w-5xl (1024) + 2×24
  { path: "/users/", maxWidth: 1072 },
  { path: "/users", maxWidth: 1328, exact: true },
  // страница: max-w-4xl (896) + 2×24
  { path: "/my-account", maxWidth: 944 },
  // Архив заявок: список ListWrapper (max-w-7xl), вложенных
  // маршрутов нет
  { path: "/archive", maxWidth: 1328, exact: true },
  // Мониторинг Mikrotik: страница записи (max-w-5xl,
  // «records») матчится раньше списка (max-w-7xl)
  { path: "/devices/mikrotik/records", maxWidth: 1072 },
  { path: "/devices/mikrotik", maxWidth: 1328 },
  // Настройки системы: рейл + секции, как «Мой аккаунт»
  { path: "/preferences", maxWidth: 944 },
  // Отчёт «Компании»: сводка и карточки — один каркас
  // PageShell max-w-7xl (1280) + 2×24
  { path: "/report/companies", maxWidth: 1328 },
  // «Диапазоны сетей»: тот же каркас — пять колонок реестра
  // укладываются в 1280 без переносов
  { path: "/report/networks", maxWidth: 1328 },
  // «Согласование работ»: карточка отчёта (max-w-5xl + 2×24)
  // матчится раньше конвейера — со слэшем, как у карточек
  // сущностей под общим префиксом
  // Карточка отчёта шире конвейера: шесть колонок работ на
  // 1024 давились и лезли друг на друга (max-w-7xl + 2×24)
  { path: "/finances/approval/", maxWidth: 1328 },
  { path: "/finances/approval", maxWidth: 1328 },
  // Отчёты по сотрудникам — тот же каркас
  { path: "/finances/employees", maxWidth: 1328 },
  { path: "/finances/my-report", maxWidth: 1328 },
  // Календарь команды — тот же каркас, что у отчётов
  { path: "/team/calendar", maxWidth: 1328 },
  // База знаний: двухпанельный раздел (проводник + заметка)
  // одной шириной на все вложенные маршруты (add, :id)
  { path: "/knowledge-base", maxWidth: 1328 },
];

// Маршрут вне таблицы: ширина по умолчанию — max-w-7xl + поля.
const DEFAULT_SHEET_WIDTH = 1328;

const RootLayout = () => {
  const { token } = getLocalStorageData();
  const { appVersion, userData, prefs } = useLoaderData();

  const initialPrefs = useInitialPrefsStore();

  // В Outlet отрисован errorElement (флаг ставит pages/Error.jsx): контент —
  // на канву независимо от MIGRATED_ROUTES.
  const routeErrorActive = useRouteErrorStore((s) => s.active);

  useEffect(() => {
    initialPrefs.set(prefs);
  }, [prefs]);

  const offcanvas = useOffcanvasStore();
  const location = useLocation();
  const revalidator = useRevalidator();

  // Версия фронта вшита в бандл из frontend/package.json (vite.config.js),
  // бэкенд отдаёт свою из своего package.json — расхождение значит, что на
  // сервере уже новая сборка. Пустое значение с любой стороны — не повод для
  // баннера: пока версию фронта задавали руками в .env, она отставала, и
  // баннер висел всегда.
  const frontendVersion = import.meta.env.VITE_VERSION;
  const versionMismatch =
    !!appVersion && !!frontendVersion && appVersion !== frontendVersion;

  // Ширина листа под текущий маршрут. Страница ошибок живёт на канве при любом
  // pathname — ширина как у карточки (944). Незнакомый путь до сюда не доходит:
  // его ловит errorElement и поднимает тот же флаг.
  const sheetWidth = routeErrorActive
    ? 944
    : (MIGRATED_ROUTES.find((r) =>
        r.exact
          ? location.pathname === r.path
          : location.pathname.startsWith(r.path),
      )?.maxWidth ?? DEFAULT_SHEET_WIDTH);

  // Мобильный app-shell: <main> — свой скролл-контейнер (не window), поэтому
  // сбрасываем прокрутку вверх при смене маршрута вручную.
  const mobileScrollRef = useRef(null);
  useEffect(() => {
    if (mobileScrollRef.current) {
      mobileScrollRef.current.scrollTop = 0;
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.state?.refresh) {
      revalidator.revalidate();
    }
  }, [location]);

  useEffect(() => {
    // Формы базы знаний открываются в основной панели, а не в offcanvas
    if (
      !location.pathname.startsWith("/knowledge-base") &&
      (["add", "update", "process", "schedule", "confirm"].includes(
        location.pathname.split("/")[location.pathname.split("/").length - 1],
      ) ||
        ["update"].includes(
          location.pathname.split("/")[location.pathname.split("/").length - 2],
        ))
    ) {
      return offcanvas.setShow();
    } else {
      return offcanvas.setClose();
    }
  }, [location]);

  const submit = useSubmit();
  const isLoggedIn = !!token;

  useEffect(() => {
    if (!token) {
      return;
    }

    if (token === "EXPIRED") {
      submit(null, { action: "/logout", method: "POST" });
      return;
    }

    const tokenDuration = getTokenDuration();

    setTimeout(() => {
      submit(null, { action: "/logout", method: "POST" });
    }, tokenDuration);
  }, [token, submit]);

  return (
    <AuthedUserContext.Provider
      value={{
        ...defaultAuthedUser,
        ...userData,
        permissions: userData?.permissions || defaultAuthedUser.permissions,
      }}
    >
      {isLoggedIn && (
        <BrowserView>
          <NavigationBar />
          {/* Бар статусов: фиксирован к правому краю окна. Рендерим вне
              Transitions — transform у предка ломает position: fixed */}
          {!userData?.isEndUser && !userData?.hideWorkStatus && (
            <WorkStatusBar variant="rail" />
          )}
        </BrowserView>
      )}
      <Transitions>
        <BrowserView>
          {/* <Pro32Connect /> */}
          {userData.backgroundImagePath && (
            <div
              // Декоративный слой обоев под контентом. top-14 — высота бара
              // оболочки, без зазора-полосы; pointer-events-none обязателен:
              // fixed-слой рисуется поверх статического контента и иначе
              // съедает клики.
              className="pointer-events-none fixed inset-x-0 top-14 bottom-0 bg-cover bg-center bg-no-repeat"
              style={{
                backgroundImage: `url("${import.meta.env.VITE_API_ADDRESS}/uploads/${userData.backgroundImagePath}")`,
              }}
            />
          )}
          {/* Контентная область оболочки. Ширина 1920 и отступ под фиксированный
              бар — стилем: ни того, ни другого нет во встроенной сетке tw.
              has-ws-rail резервирует место под свёрнутый рейл статусов
              (правило в index.css). */}
          <div
            style={{ maxWidth: "1920px", paddingTop: "80px" }}
            className={cn(
              "mx-auto w-full px-12 pb-12",
              isLoggedIn &&
                !userData?.isEndUser &&
                !userData?.hideWorkStatus &&
                "has-ws-rail",
            )}
          >
            <div
              /* relative — контент рисуется поверх fixed-слоя фоновой картинки.
                 При заданной картинке он лежит на «листе» цвета канвы (content
                 sheet on wallpaper), и лист обнимает контент по ширине его
                 маршрута, а не тянется на всю ширину: пустых полей-«карточек»
                 нет, обои видны по бокам. Без картинки лист не рисуется вовсе. */
              className={cn(
                "relative",
                userData.backgroundImagePath &&
                  "mx-auto w-full rounded-2xl border bg-card p-4",
              )}
              style={{
                minHeight: "calc(100svh - 104px)",
                ...(userData.backgroundImagePath
                  ? { maxWidth: sheetWidth }
                  : {}),
              }}
            >
              {/* Баннер оболочки — первым элементом внутри листа, а не над
                  ним: так он ровно по ширине карточки страницы. Когда листа
                  нет (нет обоев), ограничиваем его сами — иначе растянулся бы
                  на всю рабочую область. */}
              {versionMismatch && (
                <AppBanner
                  tone="warning"
                  icon={<RiRefreshLine />}
                  title="Доступна новая версия"
                  className={cn(
                    "mb-4",
                    !userData.backgroundImagePath && "mx-auto w-full max-w-7xl",
                  )}
                  action={
                    <Button
                      size="sm"
                      onClick={() => window.location.reload()}
                      className="max-md:w-full"
                    >
                      <RiRefreshLine /> Обновить
                    </Button>
                  }
                >
                  Обновите страницу, чтобы загрузить последнюю версию. Не
                  помогло — Ctrl&nbsp;+&nbsp;Shift&nbsp;+&nbsp;R.
                </AppBanner>
              )}
              <Outlet />
            </div>
            <Footer />
          </div>
        </BrowserView>
      </Transitions>
      <MobileView>
        {isLoggedIn ? (
          <div className="mobile-shell fixed inset-0 flex flex-col overflow-hidden">
            <NavigationBar embedded />
            {/* Лента статусов сотрудников: flex-элемент шелла, не fixed */}
            {!userData?.isEndUser && !userData?.hideWorkStatus && (
              <WorkStatusBar variant="strip" />
            )}
            <main
              className="mobile-shell__scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
              ref={mobileScrollRef}
            >
              <div className="mx-auto w-full px-3 pt-3">
                <Outlet />
                <Footer />
              </div>
            </main>
            <MobileBottomNavbar />
          </div>
        ) : (
          <div className="mx-auto w-full px-3 py-6">
            <Outlet />
          </div>
        )}
      </MobileView>
      <Toaster />
    </AuthedUserContext.Provider>
  );
};

export default RootLayout;
