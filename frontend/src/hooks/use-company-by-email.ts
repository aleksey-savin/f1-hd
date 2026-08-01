import { useEffect, useRef, useState } from "react";

import { API } from "../pages/Auth/session";

/**
 * Узнавание компании по адресу рабочей почты, пока человек печатает.
 *
 * То же правило, по которому привязывает регистрация, но ДО сабмита: иначе
 * пять заполненных полей заканчиваются 404 «не можем понять из какой Вы
 * компании». Ответ бэкенда разделяет три случая — домен наш, домен чужой,
 * адрес уже занят.
 */

type CompanyResolution = {
  status: "known" | "unknown";
  company: { title: string } | null;
  /** У адреса уже есть учётная запись — регистрация ему не нужна. */
  registered: boolean;
};

const DEBOUNCE_MS = 400;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function useCompanyByEmail(email: string) {
  const [resolution, setResolution] = useState<CompanyResolution | null>(null);
  const [loading, setLoading] = useState(false);
  // Кэш по полному адресу, а не по домену: `registered` — про адрес.
  // Стирание хвоста и возврат к нему повторного запроса не стоят
  const cache = useRef(new Map<string, CompanyResolution>());

  useEffect(() => {
    const value = email.trim().toLowerCase();

    if (!EMAIL_RE.test(value)) {
      setResolution(null);
      setLoading(false);
      return;
    }

    const cached = cache.current.get(value);
    if (cached) {
      setResolution(cached);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`${API}/api/signup/company-by-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: value }),
          signal: controller.signal,
        });
        if (!response.ok) {
          // Подсказка необязательна: молчим и не мешаем регистрироваться —
          // сервер проверит то же самое на сабмите
          setResolution(null);
          return;
        }
        const data = (await response.json()) as CompanyResolution;
        cache.current.set(value, data);
        setResolution(data);
      } catch {
        setResolution(null);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);

    // Следующее нажатие отменяет и таймер, и запрос: поздний ответ по
    // предыдущему адресу иначе перетёр бы свежий
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [email]);

  return { resolution, loading };
}
