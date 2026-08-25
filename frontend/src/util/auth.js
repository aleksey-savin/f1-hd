import { redirect } from "react-router";

import { api, ApiError } from "@/lib/api";
import { clearSession } from "@/pages/Auth/session";

export function getTokenDuration() {
  const storedExpiryDate = localStorage.getItem("expiryDate");
  const expiryDate = new Date(storedExpiryDate);
  const now = new Date();
  const duration = expiryDate - now;
  return duration;
}

export function getLocalStorageData() {
  const token = localStorage.getItem("token");
  const expiryDate = localStorage.getItem("expiryDate");
  const userId = localStorage.getItem("userId");
  const darkMode = localStorage.getItem("darkMode");
  const theme = localStorage.getItem("theme");
  const timezone = localStorage.getItem("timezone");

  if (!token || !expiryDate) {
    return { token: null };
  }

  const tokenDuration = getTokenDuration();

  if (tokenDuration < 0) {
    return { token: "EXPIRED" };
  }

  return {
    token: token,
    expiryDate: expiryDate,
    userId: userId,
    darkMode: darkMode === "true",
    theme: theme,
    timezone: timezone,
  };
}

/**
 * Загрузчик корня. Наличие токена в localStorage больше НЕ считается признаком
 * сеанса: сеанс живёт на сервере, а с переходом на httpOnly-cookie клиент его
 * и не увидит. Единственный честный вопрос — у сервера, и задаёт его `/api/me`.
 *
 * Прежняя версия дёргала `/api/users/:id` и `/api/preferences-initial` и НЕ
 * проверяла `response.ok`: отклонённый сервером токен превращался в
 * `userData = { error: true, ... }`, попадал в контекст как пользователь без
 * `_id` и прав, и приложение рисовало «залогиненную» оболочку со всем
 * выключенным вместо того, чтобы отправить на вход.
 */
export async function authDataLoader() {
  try {
    const [appVersion, me] = await Promise.all([
      api("/api/app-version"),
      api("/api/me"),
    ]);

    return {
      appVersion,
      userData: {
        ...me.user,
        statements: me.statements,
        permissionCatalogue: me.permissionCatalogue,
      },
      prefs: { ...me.prefs, modules: me.modules },
      sessionId: me.sessionId,
      // Подмена — состояние вкладки: полосу о ней рисует оболочка.
      impersonation: me.impersonation || null,
      // Непустое = требование включено, а фактора у человека ещё нет.
      twoFactorPolicy: me.twoFactorPolicy || null,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return redirect("/auth");
    }
    throw error;
  }
}

/**
 * Выход. Гасит СЕРВЕРНЫЙ сеанс, а не полагается на то, что клиент забудет
 * токен: до появления серверных сессий выход был `localStorage.removeItem`, и
 * выданный токен жил свои четырнадцать дней.
 */
export async function logoutLoader() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    // Сеанс мог уже истечь или быть отозван администратором — на клиенте это
    // всё равно выход.
  }
  clearSession();
  return redirect("/auth");
}
