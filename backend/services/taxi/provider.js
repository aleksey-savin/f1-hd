const { AppError } = require('../../middleware/errorHandling');
const BASE = 'https://b2b-api.go.yandex.ru/integration/2.0';
const METHODS = { '/users': 'GET', '/orders/list': 'GET', '/orders/info': 'GET', '/orders/taxi/report': 'POST' };
const request = async (settings, path, { method = 'GET', body, query } = {}, fetcher = fetch) => {
  if (!Object.hasOwn(METHODS, path) || METHODS[path] !== method || method === 'GET' && body !== undefined) throw new AppError('Неизвестный метод такси', 400);
  if (!settings?.token || !settings.clientId) throw new AppError('Укажите токен и ID клиента Яндекс Go', 400);
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(query || {})) if (value != null) url.searchParams.set(key, String(value));
  const headers = { Authorization: `Bearer ${settings.token}`, 'X-YaTaxi-Selected-Corp-Client-Id': settings.clientId, 'Accept-Language': 'ru', 'Content-Type': 'application/json' };
  let response;
  try {
    response = await fetcher(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000), redirect: 'error' });
  } catch {
    throw new AppError('Яндекс Go недоступен; повторите запрос', 502);
  }
  let data;
  try { data = await response.json(); } catch { throw new AppError('Некорректный ответ Яндекс Go', 502); }
  if (!data || typeof data !== 'object' || (Array.isArray(data) && (path !== '/orders/taxi/report' || !response.ok))) throw new AppError('Некорректный ответ Яндекс Go', 502);
  if (!response.ok) {
    const error = new AppError('Яндекс Go отклонил запрос', response.status >= 500 ? 502 : 400);
    throw error;
  }
  return data;
};
module.exports = { request };
