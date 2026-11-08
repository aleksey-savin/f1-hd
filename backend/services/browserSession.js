/** Публичная личность для старых сборок; точка заставляет старый bearer проверить и отвергнуть её. */
const sessionMarker = (sessionId) => {
  if (sessionId == null || !String(sessionId).trim()) {
    throw new TypeError("A browser session ID is required");
  }
  return `cookie.${sessionId}`;
};

const browserSessionPayload = ({ sessionId, expiresAt, userId }) => ({
  token: sessionMarker(sessionId),
  expiryDate: expiresAt,
  userId,
});

/** Сохраняет отдельные строки Set-Cookie и cookie, уже записанные middleware. */
const forwardSessionCookies = (headers, res) => {
  const cookies = headers.getSetCookie();
  if (!cookies.length) return;
  const previous = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [
    ...(previous == null ? [] : Array.isArray(previous) ? previous : [previous]),
    ...cookies,
  ]);
};

// Данные сеанса и пользователя могут быть вложены в массивы или обёртки плагинов.
// Токены сброса и материалы настройки TOTP вне этих контекстов передаются намеренно.
const withoutSessionTokens = (value, sessionContext = false) => {
  if (Array.isArray(value)) return value.map((item) => withoutSessionTokens(item, sessionContext));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (key === "token" && (sessionContext || value.user || value.session || value.browserSession)) return [];
    return [[key, withoutSessionTokens(item, sessionContext || ["session", "sessions", "user", "users"].includes(key))]];
  }));
};

/** Только граница HTTP: внутренним потребителям auth.api по-прежнему нужен session.token. */
const browserSessionResponse = async (response) => {
  const headers = new Headers(response.headers);
  headers.delete("set-auth-token");
  const exposed = headers.get("access-control-expose-headers");
  if (exposed) {
    const safe = exposed.split(",").map((name) => name.trim()).filter((name) => name.toLowerCase() !== "set-auth-token");
    if (safe.length) headers.set("access-control-expose-headers", safe.join(", "));
    else headers.delete("access-control-expose-headers");
  }
  const options = { status: response.status, statusText: response.statusText, headers };
  if (!response.body || (response.status >= 300 && response.status < 400) ||
      !headers.get("content-type")?.includes("application/json")) {
    return new Response(response.body, options);
  }
  const body = await response.json();
  const clean = withoutSessionTokens(body);
  if (body?.browserSession) {
    delete clean.browserSession;
    Object.assign(clean, body.browserSession);
  }
  headers.delete("content-length");
  return Response.json(clean, options);
};

module.exports = { sessionMarker, browserSessionPayload, forwardSessionCookies, browserSessionResponse };
