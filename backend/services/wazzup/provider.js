const { normalizeAccount } = require('./events');

class ProviderError extends Error {
  constructor(message, { code = '', statusCode = 502, retryable = false, retryAfterMs = 0 } = {}) {
    super(message);
    Object.assign(this, { name: 'WazzupError', code, statusCode, retryable, retryAfterMs, isOperational: true });
  }
}
const errorText = (status, code) => {
  if (status === 401 || status === 403) return 'Wazzup отклонил API-ключ — проверьте ключ в настройках';
  if (status === 429) return 'Wazzup ограничил частоту запросов — повторим позже';
  if (code === 'testPostNotPassed') return 'Wazzup не смог подключить приём сообщений — проверьте доступность HD по HTTPS';
  if (code === 'REPEATED_CRM_MESSAGE_ID') return 'Wazzup уже получил это сообщение — проверьте переписку перед повтором';
  if (code === '24_HOURS_EXCEEDED') return 'Окно ответа WhatsApp Business закрыто — используйте шаблон в Wazzup';
  if (code === 'BAD_CONTACT') return 'Получатель не найден в мессенджере';
  return 'Wazzup не выполнил запрос — проверьте состояние аккаунта в Wazzup';
};
const createClient = ({ fetch: request = globalThis.fetch } = {}) => {
  const call = async (key, path, { method = 'GET', body } = {}) => {
    let response;
    try {
      response = await request(`https://api.wazzup24.com/v3/${path}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new ProviderError(method === 'POST' ? 'Результат отправки неизвестен — проверьте переписку в Wazzup перед повтором' : 'Нет ответа Wazzup — проверьте подключение к сервису');
    }
    let data;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      const code = typeof data?.error === 'string' && /^[A-Za-z0-9_]+$/.test(data.error) ? data.error : '';
      const retryAfterMs = Math.min(6 * 3600_000, Math.max(1000, Number(response.headers.get('retry-after')) * 1000 || 30_000));
      throw new ProviderError(errorText(response.status, code), { code, statusCode: [400, 401, 403, 422].includes(response.status) ? 422 : 502, retryable: response.status === 429, retryAfterMs: response.status === 429 ? retryAfterMs : 0 });
    }
    return data;
  };
  return {
    async fetchAccounts(key) {
      const data = await call(key, 'channels');
      if (!Array.isArray(data) || data.length > 1000) throw new ProviderError('Wazzup вернул некорректный список аккаунтов');
      return data.map(normalizeAccount).filter(Boolean);
    },
    getWebhooks: key => call(key, 'webhooks'),
    setWebhooks: (key, body) => call(key, 'webhooks', { method: 'PATCH', body }),
    sendMessage: (key, body) => call(key, 'message', { method: 'POST', body }),
  };
};
module.exports = { ...createClient(), createClient, normalizeAccount, ProviderError, errorText };
