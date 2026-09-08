import { useContext, useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";
import {
  Outlet,
  useLoaderData,
  useMatches,
  useNavigate,
  useNavigation,
  useSubmit,
} from "react-router";

import {
  AuthedUserContext,
  defaultAuthedUser,
} from "../store/authed-user-context";

import NavigationBar from "./Navbar";
import Footer from "./Footer";
import RouteGuard from "@/components/app/RouteGuard";
import WorkStatusBar from "../components/User/WorkStatusBar";
import { Toaster } from "@/components/ui/sonner";
import {
  RiRefreshLine,
  RiShieldKeyholeLine,
  RiSpyLine,
} from "react-icons/ri";

import { formatDate, formatIn } from "@/util/format-date";
import { Button } from "@/components/ui/button";
import AppBanner from "@/components/app/AppBanner";
import { cn } from "@/lib/utils";

import Transitions from "../animations/Transition";

import MobileBottomNavbar from "./MobileBottomNavbar";

import { getLocalStorageData, getTokenDuration } from "../util/auth";
import useInitialPrefsStore from "../store/prefs";
import useWorkStatusesStore from "../store/work-statuses";
import { ThemeContext } from "../store/theme-context";
import useRouteErrorStore from "../store/route-error";
import { layoutPathname, resolveSheetWidth } from "./sheet-width";

const RootLayout = () => {
  const { token } = getLocalStorageData();
  const { appVersion, userData, prefs, impersonation, twoFactorPolicy } =
    useLoaderData();
  const navigate = useNavigate();
  const impersonatedName =
    `${userData.lastName || ""} ${userData.firstName || ""}`.trim() ||
    userData.email;
  // «через 54 минуты» вместо времени окончания: считать разницу в уме, глядя
  // на чужой портал, — лишняя работа.
  const impersonationEnds = impersonation?.until
    ? formatIn(impersonation.until)
    : "меньше чем через час";

  const initialPrefs = useInitialPrefsStore();

  // В Outlet отрисован errorElement (флаг ставит pages/Error.jsx): контент —
  // на канву независимо от MIGRATED_ROUTES.
  const routeErrorActive = useRouteErrorStore((s) => s.active);

  useEffect(() => {
    initialPrefs.set(prefs);
  }, [prefs]);

  const location = useLocation();

  // Переход, который длится дольше мгновения (шторка формы открывается по
  // готовности данных; прямая ссылка; медленная сеть), получает признак на
  // корне документа: `data-navigating="pending"` — index.css показывает по
  // нему курсор ожидания и линию на границе бара оболочки (app/NavProgress).
  // Порог — чтобы быстрые переходы не мигали. По коммиту линия, если успела
  // появиться, доезжает до конца и гаснет: «done» живёт ровно на время этой
  // анимации, иначе признак просто снимается.
  const navigation = useNavigation();
  useEffect(() => {
    const root = document.documentElement.dataset;
    if (navigation.state !== "idle") {
      const timer = setTimeout(() => {
        root.navigating = "pending";
      }, 200);
      return () => clearTimeout(timer);
    }
    if (root.navigating !== "pending") {
      delete root.navigating;
      return undefined;
    }
    root.navigating = "done";
    const timer = setTimeout(() => {
      if (root.navigating === "done") delete root.navigating;
    }, 450);
    return () => clearTimeout(timer);
  }, [navigation.state]);

  // Версия фронта вшита в бандл из frontend/package.json (vite.config.js),
  // бэкенд отдаёт свою из своего package.json — расхождение значит, что на
  // сервере уже новая сборка. Пустое значение с любой стороны — не повод для
  // баннера: пока версию фронта задавали руками в .env, она отставала, и
  // баннер висел всегда.
  const frontendVersion = import.meta.env.VITE_VERSION;
  const versionMismatch =
    !!appVersion && !!frontendVersion && appVersion !== frontendVersion;

  // Ширина листа под текущий маршрут — по его ХОЗЯИНУ: пока открыта шторка
  // формы, за ней виден список или карточка, и лист не должен под ней
  // прыгать (layout/sheet-width.js). Страница ошибок живёт на канве при любом
  // pathname — ширина как у карточки (944). Незнакомый путь до сюда не
  // доходит: его ловит errorElement и поднимает тот же флаг.
  const matches = useMatches();
  const sheetWidth = routeErrorActive
    ? 944
    : resolveSheetWidth(layoutPathname(matches));

  // Мобильный app-shell: <main> — свой скролл-контейнер (не window), поэтому
  // сбрасываем прокрутку вверх при смене маршрута вручную.
  const mobileScrollRef = useRef(null);
  useEffect(() => {
    if (mobileScrollRef.current) {
      mobileScrollRef.current.scrollTop = 0;
    }
  }, [location.pathname]);

  // Масштаб текста — личная настройка с сервера; localStorage лишь зеркало
  // для первой отрисовки. Сервер побеждает: на общем рабочем месте после
  // входа другого человека действует его выбор, а не прошлого.
  const { fontScale, setFontScale, plainCanvas, setPlainCanvas } =
    useContext(ThemeContext);
  const railOpen = useWorkStatusesStore((state) => state.railOpen);
  useEffect(() => {
    const server = userData?.fontScale;
    if (server && server !== fontScale) {
      setFontScale(server);
    }
  }, [userData?.fontScale]);

  // Чистый вид — там же на сервере и с тем же правилом «сервер побеждает».
  // Значение булево, поэтому сравниваем явно: undefined из старого ответа не
  // должен молча выключать настройку.
  useEffect(() => {
    const server = userData?.plainCanvas;
    if (server !== undefined && Boolean(server) !== plainCanvas) {
      setPlainCanvas(server);
    }
  }, [userData?.plainCanvas]);

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
        statements: userData?.statements || defaultAuthedUser.statements,
        permissionCatalogue:
          userData?.permissionCatalogue ||
          defaultAuthedUser.permissionCatalogue,
      }}
    >
      {isLoggedIn && (
        <BrowserView>
          <NavigationBar />
          {/* Бар статусов: фиксирован к правому краю окна. Рендерим вне
              Transitions — transform у предка ломает position: fixed */}
          {!userData?.isEndUser && !userData?.hideWorkStatus && (
            <WorkStatusBar />
          )}
        </BrowserView>
      )}
      <Transitions>
        <BrowserView>
          {/* <Pro32Connect /> */}
          {!plainCanvas && userData.backgroundImagePath && (
            <div
              // Декоративный слой обоев под контентом. top-14 — высота бара
              // оболочки, без зазора-полосы; pointer-events-none обязателен:
              // fixed-слой рисуется поверх статического контента и иначе
              // съедает клики.
              //
              // Класс app-wallpaper — признак для канвы: по нему index.css
              // гасит собственную фактуру (клетку и вуаль), потому что фон
              // здесь задаёт пользователь.
              className="app-wallpaper pointer-events-none fixed inset-x-0 top-14 bottom-0 bg-cover bg-center bg-no-repeat"
              style={{
                backgroundImage: `url("${import.meta.env.VITE_API_ADDRESS}/uploads/${userData.backgroundImagePath}")`,
              }}
            />
          )}
          {/* Контентная область оболочки. Ширина 1920 и отступ под фиксированный
              бар — стилем: ни того, ни другого нет во встроенной сетке tw.
              has-ws-rail резервирует место под рейл статусов, has-ws-rail-open
              — под раскрытый: рейл стоит в потоке и сдвигает контент, а не
              накрывает его (правила в index.css). */}
          <div
            // 5rem = бар h-14 (3.5rem) + 1.5rem воздуха; в rem, потому что бар
            // в rem, а личный масштаб текста двигает и то и другое
            style={{ maxWidth: "1920px", paddingTop: "5rem" }}
            className={cn(
              "mx-auto w-full px-12 pb-12",
              isLoggedIn &&
                !userData?.isEndUser &&
                !userData?.hideWorkStatus &&
                "has-ws-rail",
              isLoggedIn &&
                !userData?.isEndUser &&
                !userData?.hideWorkStatus &&
                railOpen &&
                "has-ws-rail-open",
            )}
          >
            <div
              /* «Лист» страницы. relative — контент рисуется поверх fixed-слоя
                 обоев; без позиционирования он бы под ними исчез.

                 Лист рисуется всегда, кроме чистого вида. Раньше без обоев
                 страницы жили прямо на канве, и это работало, пока канва была
                 ровной заливкой. С фактурой (index.css → «Фактура канвы»)
                 заголовок, фильтры и чипы оказались на клетке — для лендинга
                 нормально, для повседневной работы утомительно. Плотному
                 интерфейсу нужна спокойная подложка, а фактура остаётся тем,
                 чем и была: полями вокруг листа.

                 Лист обнимает контент по ширине его маршрута (sheetWidth), а не
                 тянется на всю рабочую область: пустых полей-«карточек» нет, а
                 под обоями они к тому же видны по бокам. */
              className={cn(
                "relative",
                !plainCanvas && "mx-auto w-full rounded-2xl border bg-card p-4",
              )}
              style={{
                minHeight: "calc(100svh - 6.5rem)",
                ...(plainCanvas ? {} : { maxWidth: `${sheetWidth / 16}rem` }),
              }}
            >
              {/* Баннеры — первыми элементами внутри листа, а не над ним:
                  так они ровно по ширине карточки страницы. */}
              {/* Работа под чужой учётной записью — состояние, о котором надо
                  помнить постоянно, поэтому полоса видна на каждой странице и
                  не закрывается. «Выйти» здесь — обычный выход: своя вкладка
                  администратора всё это время цела, возвращаться некуда. */}
              {impersonation && (
                <AppBanner
                  tone="warning"
                  icon={<RiSpyLine />}
                  title={`Вы под учётной записью: ${impersonatedName}`}
                  className={cn(
                    "mb-4",
                    plainCanvas && "mx-auto w-full max-w-7xl",
                  )}
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate("/logout")}
                      className="max-md:w-full"
                    >
                      Выйти
                    </Button>
                  }
                >
                  Сеанс завершится сам {impersonationEnds}. Всё, что вы здесь
                  сделаете, будет записано на этого человека.
                </AppBanner>
              )}
              {/* Требование второго фактора уже включено, но отсрочка ещё не
                  вышла: полоса называет дату, потому что после неё вход
                  закроется, и узнать об этом на экране входа — поздно. */}
              {twoFactorPolicy && (
                <AppBanner
                  tone="warning"
                  icon={<RiShieldKeyholeLine />}
                  title="Настройте вход по коду из приложения"
                  className={cn(
                    "mb-4",
                    plainCanvas && "mx-auto w-full max-w-7xl",
                  )}
                  action={
                    <Button
                      size="sm"
                      onClick={() => navigate("/my-account#security")}
                      className="max-md:w-full"
                    >
                      Настроить
                    </Button>
                  }
                >
                  {twoFactorPolicy.requiredUntil
                    ? `Администраторам он обязателен. После ${formatDate(twoFactorPolicy.requiredUntil)} вход без него закроется.`
                    : "Администраторам он обязателен — вход без него уже закрывается."}
                </AppBanner>
              )}
              {versionMismatch && (
                <AppBanner
                  tone="warning"
                  icon={<RiRefreshLine />}
                  title="Доступна новая версия"
                  className={cn(
                    "mb-4",
                    plainCanvas && "mx-auto w-full max-w-7xl",
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
              <RouteGuard>
                <Outlet />
              </RouteGuard>
            </div>
            <Footer />
          </div>
        </BrowserView>
      </Transitions>
      <MobileView>
        {isLoggedIn ? (
          <div className="mobile-shell fixed inset-0 flex flex-col overflow-hidden">
            <NavigationBar embedded />
            {/* Ленты статусов в шелле больше нет: 56px на каждом экране ради
                информации, которая нужна изредка. На телефоне команда — блок
                «Команда сейчас» на главной (components/Dashboard/TeamNow) */}
            <main
              className="mobile-shell__scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
              ref={mobileScrollRef}
            >
              <div className="mx-auto w-full px-3 pt-3">
                <RouteGuard>
                  <Outlet />
                </RouteGuard>
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
