import { api } from "@/lib/api";

/**
 * Требования к паролю и генератор.
 *
 * Правил вида «заглавная + цифра + символ» здесь НЕТ намеренно. `Qwerty123!`
 * удовлетворяет любому такому набору и при этом встречается в известных утечках
 * 184 730 раз — чек-лист, пропускающий такое, не защищает, а учит неправильному.
 * Вместо него длина плюс проверка по спискам утечек на сервере
 * (`POST /api/password/check`, k-анонимность: наружу уходят первые пять
 * символов SHA1).
 */

export const MIN_LENGTH = 8;
export const GEN_MIN = 8;
export const GEN_MAX = 24;
export const GEN_DEFAULT = 10;

/**
 * Алфавит без похожих знаков: ни `0/O`, ни `1/l/I`. Пароль, заданный
 * администратором, кто-то будет читать с экрана или диктовать по телефону.
 */
const ALPHABET =
  "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_@#%+=?";

export function generatePassword(length: number): string {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (n) => ALPHABET[n % ALPHABET.length]).join("");
}

export type PasswordVerdict =
  | { kind: "idle" }
  | { kind: "short"; missing: number }
  | { kind: "checking" }
  | { kind: "breached"; count: number }
  | { kind: "ok"; checked: boolean };

type CheckResponse = {
  ok: boolean;
  reason?: "short" | "long" | "breached";
  count?: number;
  missing?: number;
  maxLength?: number;
  checked?: boolean;
};

/**
 * Спрашивает сервер. Короткий пароль отсекаем на клиенте — незачем ходить за
 * тем, что видно по длине строки.
 */
export async function checkPassword(value: string): Promise<PasswordVerdict> {
  if (!value) return { kind: "idle" };
  if (value.length < MIN_LENGTH) {
    return { kind: "short", missing: MIN_LENGTH - value.length };
  }

  try {
    const result = await api<CheckResponse>("/api/password/check", {
      method: "POST",
      body: { password: value },
    });
    if (result.reason === "breached") {
      return { kind: "breached", count: result.count ?? 0 };
    }
    if (!result.ok) {
      return { kind: "short", missing: result.missing ?? 1 };
    }
    return { kind: "ok", checked: result.checked !== false };
  } catch {
    // Сервер не ответил — не повод запирать человека. Пароль принимаем, а
    // отсутствие проверки называем вслух.
    return { kind: "ok", checked: false };
  }
}

const NUMBER_FORMAT = new Intl.NumberFormat("ru-RU");

/** Текст подсказки под полем. Отказ объясняет причину и даёт выход. */
export function verdictText(verdict: PasswordVerdict): string {
  switch (verdict.kind) {
    case "idle":
      return `Не короче ${MIN_LENGTH} знаков. Проверим по базе утечек.`;
    case "short":
      return `Ещё ${verdict.missing} ${verdict.missing === 1 ? "знак" : "знака"}.`;
    case "checking":
      return "Проверяем по базе утечек…";
    case "breached":
      return `Встречается в утечках ${NUMBER_FORMAT.format(verdict.count)} раз. Такой подбирают за секунды — возьмите другой.`;
    case "ok":
      return verdict.checked
        ? "Подходит. В известных утечках не встречается."
        : "Пароль принят. Проверить по базе утечек не удалось — сервис не ответил.";
  }
}

export const verdictAllows = (verdict: PasswordVerdict) => verdict.kind === "ok";
