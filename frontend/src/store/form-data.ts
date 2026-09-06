import { api } from "@/lib/api";

/**
 * Кэш справочных данных форм — `form-data`, каталоги для селектов.
 *
 * Лоадеры маршрутов живут вне React, поэтому это модуль с Map, а не стор.
 * Шторка формы открывается по готовности данных (см. `app/FormOutlet`), и
 * каждый лишний запрос на открытии — это пауза между щелчком и формой.
 * Справочники меняются редко, поэтому:
 *   • свежая запись (моложе `maxAge`) отдаётся сразу, без запроса;
 *   • устаревшая, но пригодная (моложе `staleMax`) — отдаётся сразу, а
 *     обновление уходит в фон: эта форма открывается без ожидания, следующая —
 *     уже с новыми данными;
 *   • отсутствующая или слишком старая — ждём ответ;
 *   • параллельные запросы одного пути склеиваются в один.
 *
 * Ключ включает токен сеанса: выход, вход под другим человеком и подмена
 * пользователя никогда не получат чужие списки.
 *
 * Сущности (заявка, устройство, компания) здесь не кэшируются никогда: их
 * правят многие и часто, форма правки обязана видеть свежее.
 */
type Entry = { data: unknown; fetchedAt: number; inflight: Promise<unknown> | null };

const entries = new Map<string, Entry>();

const keyOf = (path: string) => `${localStorage.getItem("token") ?? ""}|${path}`;

function refresh<T>(key: string, path: string): Promise<T> {
  const current = entries.get(key);
  if (current?.inflight) return current.inflight as Promise<T>;

  const inflight = api<T>(path)
    .then((data) => {
      entries.set(key, { data, fetchedAt: Date.now(), inflight: null });
      return data;
    })
    .catch((error: unknown) => {
      const entry = entries.get(key);
      if (entry) entry.inflight = null;
      throw error;
    });

  entries.set(key, {
    data: current?.data,
    fetchedAt: current?.fetchedAt ?? 0,
    inflight,
  });
  return inflight;
}

export type LoadOptions = {
  /** Моложе — отдаём из кэша без запроса. */
  maxAge?: number;
  /** Моложе — отдаём из кэша, но обновляем в фоне; старше — ждём ответ. */
  staleMax?: number;
};

export async function load<T = unknown>(
  path: string,
  { maxAge = 60_000, staleMax = 10 * 60_000 }: LoadOptions = {},
): Promise<T> {
  const key = keyOf(path);
  const entry = entries.get(key);
  const age =
    entry && entry.data !== undefined ? Date.now() - entry.fetchedAt : Infinity;

  if (age < maxAge) return entry!.data as T;
  if (age < staleMax) {
    refresh<T>(key, path).catch(() => {});
    return entry!.data as T;
  }
  return refresh<T>(key, path);
}

/** Прогрев с страницы-хозяина формы: первое открытие уже не ждёт справочников. */
export function warm(path: string, options?: LoadOptions) {
  load(path, options).catch(() => {});
}

export function invalidate(prefix = "") {
  for (const key of entries.keys()) {
    if (key.slice(key.indexOf("|") + 1).startsWith(prefix)) entries.delete(key);
  }
}
