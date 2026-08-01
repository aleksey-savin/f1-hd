// Сеанс в localStorage: одно место, которое его заводит и одно, которое чистит.
// Раньше запись жила в экшене страницы входа, а очистка — в экшене выхода, и
// списки ключей успели разойтись.

export const API = import.meta.env.VITE_API_ADDRESS;

/** Статусы, которые формы показывают на месте, а не роняют в error boundary. */
export const INLINE_STATUSES = [400, 401, 403, 404, 409, 422, 429];

type AuthResponse = {
  token: string;
  expiryDate: string;
  userId: string;
};

/**
 * Ключи сеанса. Часть из них пишет не эта функция (права, имя, флаги модулей —
 * загрузчик корня), но чистить надо всё разом, иначе следующий вход получит
 * хвост прошлого. Список намеренно шире, чем `storeSession`.
 */
const SESSION_KEYS = [
  "token",
  "expiryDate",
  "userId",
  "isAdmin",
  "role",
  "canEditTickets",
  "canAdministrateTickets",
  "canDeleteTickets",
  "canSeeAllTickets",
  "canSeeWorksReport",
  "canSeeAnalytics",
  "userName",
  "contactsTel",
  "contactsEmail",
  "contactsAddress",
  "getScreenIsActive",
  "timezone",
  "emailNotifications",
];

/**
 * Кладёт выданный сервером сеанс и подтягивает начальные настройки: их читают
 * из localStorage форматтеры дат (`orgTimezone`) и виджеты контактов ещё до
 * того, как отработает загрузчик корня.
 */
export async function storeSession(data: AuthResponse) {
  localStorage.setItem("token", data.token);
  localStorage.setItem("expiryDate", new Date(data.expiryDate).toISOString());
  localStorage.setItem("userId", String(data.userId));

  try {
    const response = await fetch(`${API}/api/preferences-initial`, {
      headers: { Authorization: "Bearer " + data.token },
    });
    if (!response.ok) return;

    const prefs = (await response.json()) as {
      contacts?: { tel?: string; email?: string; address?: string };
      getScreen?: { isActive?: boolean };
      timezone?: string;
    };

    localStorage.setItem("contactsTel", prefs.contacts?.tel || "");
    localStorage.setItem("contactsEmail", prefs.contacts?.email || "");
    localStorage.setItem("contactsAddress", prefs.contacts?.address || "");
    localStorage.setItem(
      "getScreenIsActive",
      String(prefs.getScreen?.isActive ?? ""),
    );
    localStorage.setItem("timezone", prefs.timezone || "");
  } catch {
    // Настройки — не условие входа: без них приложение откроется и дочитает
    // их загрузчиком корня
  }
}

export function clearSession() {
  SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
}

/**
 * Ошибка, которую экран показывает на месте. Сообщение формулирует бэкенд —
 * он один знает причину («Укажите…», «Попробуйте после 14:20»); фронт её не
 * угадывает и подставляет своё, только если сервер промолчал.
 *
 * `locked` приходит от ограничителя попыток входа: это не ошибка ввода, и
 * плашка у неё другого тона.
 */
export async function inlineError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as {
    message?: string;
    locked?: boolean;
  } | null;

  return {
    message: data?.message || fallback,
    locked: Boolean(data?.locked),
  };
}
