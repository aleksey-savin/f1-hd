import { redirect } from "react-router";

import { api, ApiError } from "@/lib/api";
import { clearSession } from "@/pages/Auth/session";
import {
  assertBrowserSessionCurrent,
  browserSessionGeneration,
  beginBrowserSessionCheck,
  confirmBrowserSession,
} from "./browser-session.js";
import { adoptBrand } from "@/store/prefs";

export function getLocalStorageData() {
  const darkMode = localStorage.getItem("darkMode");
  const theme = localStorage.getItem("theme");
  const timezone = localStorage.getItem("timezone");
  const personalTimezone = localStorage.getItem("personalTimezone");
  return {
    darkMode: darkMode === "true",
    theme: theme,
    timezone: timezone,
    personalTimezone: personalTimezone,
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
// Используем общий запрос только для текущей личности; новая загрузка корня заменяет старые.
let pendingIdentity = null;

export function loadBrowserIdentity(signal) {
  const check = beginBrowserSessionCheck(signal);
  const promise = api("/api/me", { signal })
    .then((me) => {
      confirmBrowserSession(me, localStorage, check);
      return me;
    })
    .finally(() => {
      check.finish();
      if (pendingIdentity?.generation === check.generation)
        pendingIdentity = null;
    });
  pendingIdentity = { generation: check.generation, promise };
  return promise;
}

export function ensureBrowserIdentity() {
  if (pendingIdentity?.generation === browserSessionGeneration())
    return pendingIdentity.promise;
  return loadBrowserIdentity();
}

export async function authDataLoader({ request } = {}) {
  const identity = loadBrowserIdentity(request?.signal);
  const expected = browserSessionGeneration();
  try {
    const [appVersion, me] = await Promise.all([
      api("/api/app-version", { signal: request?.signal }),
      identity,
    ]);
    assertBrowserSessionCurrent(expected, request?.signal);

    // Бренд применяется в загрузчике, до отрисовки оболочки: акцент и название
    // портала известны раньше, чем появится первый экран
    adoptBrand(me.prefs?.brand);

    return {
      appVersion,
      userData: {
        ...me.user,
        statements: me.statements,
        // Что человек вправе ВЫДАТЬ роли — до вырезания по типу аккаунта
        // (store/authed-user.ts → useCanGrant). Без этого поля форма роли
        // не отличила бы «нет права» от «есть, но не действует у меня».
        grantStatements: me.grantStatements,
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
  clearSession();
  const expected = browserSessionGeneration();
  try {
    await api("/api/logout", { method: "POST" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      return redirect("/auth");
    // Сеанс мог уже истечь или быть отозван администратором — на клиенте это
    // всё равно выход.
  }
  assertBrowserSessionCurrent(expected);
  return redirect("/auth");
}
