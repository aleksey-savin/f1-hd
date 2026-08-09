// Сеанс в localStorage: одно место, которое его заводит и одно, которое чистит.
// Раньше запись жила в экшене страницы входа, а очистка — в экшене выхода, и
// списки ключей успели разойтись.

export const API = import.meta.env.VITE_API_ADDRESS;

/**
 * Статусы, у которых сервер объясняет причину словами, — их показывают как
 * есть. Пред-авторизационные экраны не роняют в error boundary НИЧЕГО (см.
 * `authFailure`), но остальным формам список по-прежнему нужен.
 */
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
export async function storeSession(data: AuthResponse, response?: Response) {
  // Сеанс живёт на сервере, и браузер уже получил его cookie. Токен в
  // localStorage — переходный транспорт для экранов, ещё не переехавших на
  // api()-клиент: они шлют его заголовком, плагин `bearer` принимает.
  // Приоритет у заголовка `set-auth-token`; поле `token` тела — то же
  // значение, оставлено ради совместимости и уйдёт вместе с bearer.
  const token = response?.headers.get("set-auth-token") || data.token;
  localStorage.setItem("token", token);
  localStorage.setItem("expiryDate", new Date(data.expiryDate).toISOString());
  localStorage.setItem("userId", String(data.userId));

  try {
    const response = await fetch(`${API}/api/preferences-initial`, {
      headers: { Authorization: "Bearer " + token },
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

export type AuthFailure = { message: string; locked: boolean };

/**
 * Неудача пред-авторизационного экрана — ВСЕГДА на месте, ничего не бросаем.
 *
 * Экран ошибки предлагает «вернуться» и «на главную», а человеку, который не
 * может войти, возвращаться некуда: обе дороги ведут обратно сюда же, зато
 * введённый адрес теряется. Поэтому 500 и оборванная сеть остаются на форме
 * плашкой — как и 401.
 *
 * Сообщение сервера показываем, только когда он объяснил причину по-русски и
 * по существу (наш `AppError` со списком статусов). У 500 текст свой: «Login
 * failed» из журнала человеку ничего не говорит и выглядит как его вина.
 */
export async function authFailure(
  response: Response,
  fallback: string,
): Promise<AuthFailure> {
  if (INLINE_STATUSES.includes(response.status)) {
    return inlineError(response, fallback);
  }

  console.error("auth: сервер ответил", response.status, await responseText(response));

  return {
    message:
      "Сервер не смог обработать запрос. Попробуйте ещё раз через минуту — если повторится, сообщите в поддержку.",
    locked: false,
  };
}

/** Разрыв связи, а не ответ сервера: `fetch` бросает, и это тоже не повод уходить с экрана. */
export const OFFLINE_FAILURE: AuthFailure = {
  message: "Нет связи с сервером. Проверьте подключение и попробуйте снова.",
  locked: false,
};

const responseText = async (response: Response) =>
  response
    .clone()
    .text()
    .catch(() => "");
