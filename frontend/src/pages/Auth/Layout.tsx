import { Outlet, redirect, useRouteLoaderData } from "react-router";

import { getLocalStorageData } from "../../util/auth";
import AuthShell from "../../components/Auth/AuthShell";
import { API } from "./session";
import { FALLBACK_PREFS, type AuthPrefs } from "./prefs";

/**
 * Беспутевой layout-маршрут пред-авторизационных экранов.
 *
 * Беспутевой, а не `path: "auth"`, потому что `/reset-password/:token` уже
 * разослан письмами и не может стать потомком `/auth` — react-router требует,
 * чтобы путь ребёнка продолжал путь родителя.
 *
 * Здесь же единственная загрузка `preferences-auth`: экраны читают её через
 * `useAuthPrefs`, иначе четыре маршрута сходили бы за одним и тем же по
 * отдельности.
 */

/** Старые адреса режимов: на них ведут закладки и редирект выхода. */
const LEGACY_MODES: Record<string, string> = {
  // Саморегистрации больше нет — старая закладка ведёт на вход.
  signup: "/auth",
  "forgot-password": "/auth/password",
  login: "/auth",
};

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const path = url.pathname;
  const onAuth = path === "/auth" || path.startsWith("/auth/");

  if (onAuth) {
    const mode = url.searchParams.get("mode");
    if (mode && LEGACY_MODES[mode]) {
      return redirect(LEGACY_MODES[mode]);
    }

    // Вошедшего на форму входа не пускаем. Ссылку из письма — наоборот:
    // пароль меняют и не выходя из приложения
    const { token } = getLocalStorageData();
    if (token && token !== "EXPIRED") {
      return redirect("/");
    }
  }

  let prefs = FALLBACK_PREFS;
  try {
    const response = await fetch(`${API}/api/preferences-auth`);
    if (response.ok) {
      prefs = { ...FALLBACK_PREFS, ...((await response.json()) as AuthPrefs) };
    }
  } catch {
    // молчим намеренно: см. FALLBACK_PREFS
  }

  // Экрана первого запуска больше нет: администратор и компания заводятся
  // сидом при старте бэкенда, а неавторизованная ручка провижининга удалена.
  return prefs;
}

/** Настройки оболочки из layout-маршрута — экранам под ним. */
export function useAuthPrefs(): AuthPrefs {
  return (useRouteLoaderData("auth") as AuthPrefs) ?? FALLBACK_PREFS;
}

const AuthLayout = () => {
  const prefs = useAuthPrefs();

  return (
    <AuthShell prefs={prefs}>
      <Outlet />
    </AuthShell>
  );
};

export default AuthLayout;
