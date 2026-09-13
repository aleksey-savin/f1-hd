/**
 * Сборка «Результата выполнения» из чипов диалога закрытия заявки.
 *
 * Сообщение читается как «приветствие · работы · итог · пожелание», и чипы
 * вставляют текст ровно на своё место, чтобы не гонять курсор:
 * - приветствие — всегда в начало, по местному времени заявителя;
 * - работы ЭТОЙ заявки и строки итога складываются в порядке чипов;
 * - «Хорошего дня!» — всегда в конец.
 *
 * Состояние чипа выводится из текста, а не хранится: ручная правка сразу
 * гасит чип, чей текст перестал совпадать, и повторный клик по горящему чипу
 * убирает его текст.
 */

export const SIGN_OFF = "Хорошего дня!";

/** Общие строки итога — идут после работ заявки. */
export const OUTCOMES = ["Работы по заявке выполнены.", "Проблема устранена."];

const GREETINGS = ["Доброе утро!", "Добрый день!", "Добрый вечер!"];

/** 05–12 утро, 12–18 день, остальное — вечер (ночного приветствия нет). */
export const greetingAt = (hour: number): string => {
  if (hour >= 5 && hour < 12) return GREETINGS[0];
  if (hour >= 12 && hour < 18) return GREETINGS[1];
  return GREETINGS[2];
};

const ENDS_SENTENCE = /[.!?…)]$/;

const sentence = (text: string): string =>
  !text || ENDS_SENTENCE.test(text) ? text : `${text}.`;

/** Описание работы как предложение: пробелы схлопнуты, с заглавной, с точкой. */
const asSentence = (raw: string): string => {
  const text = raw.replace(/\s+/g, " ").trim();
  return text ? sentence(text[0].toUpperCase() + text.slice(1)) : "";
};

type WorkLike = { description?: string | null; finishedAt?: unknown };

/** Тексты чипов работ: только завершённые, без «-» и повторов. */
export const workSentences = (works: WorkLike[]): string[] => {
  const result: string[] = [];
  for (const work of works) {
    if (!work.finishedAt) continue;
    const text = asSentence(work.description ?? "");
    if (text.replace(/[^\p{L}\p{N}]/gu, "").length < 3) continue;
    if (!result.includes(text)) result.push(text);
  }
  return result;
};

/** Приветствие отдельно, остальное (с пожеланием, если есть) — тело. */
const parse = (text: string) => {
  const trimmed = text.trim();
  const greeting = GREETINGS.find((item) => trimmed.startsWith(item)) ?? "";
  return { greeting, body: trimmed.slice(greeting.length).trim() };
};

const join = (greeting: string, body: string): string =>
  [greeting, body.replace(/\s{2,}/g, " ").trim()].filter(Boolean).join(" ");

/**
 * Вставка перед первым из якорей, что уже есть в тексте; без якорей — в
 * конец, но перед пожеланием.
 */
const insert = (body: string, part: string, anchors: string[]): string => {
  const found = anchors.filter((anchor) => body.includes(anchor));
  if (found.length > 0) {
    const at = Math.min(...found.map((anchor) => body.indexOf(anchor)));
    return [sentence(body.slice(0, at).trim()), part, body.slice(at)]
      .filter(Boolean)
      .join(" ");
  }
  const signOff = body.endsWith(SIGN_OFF);
  const core = signOff ? body.slice(0, -SIGN_OFF.length).trim() : body;
  return [sentence(core), part, signOff ? SIGN_OFF : ""]
    .filter(Boolean)
    .join(" ");
};

/** Что горит: приветствие (какое стоит), пожелание и текст работы или итога. */
export const chipState = (text: string) => {
  const { greeting, body } = parse(text);
  return {
    greeting,
    signOff: body.endsWith(SIGN_OFF),
    has: (part: string) => body.includes(part),
  };
};

export const toggleGreeting = (text: string, greeting: string): string => {
  const parts = parse(text);
  return join(parts.greeting ? "" : greeting, parts.body);
};

export const toggleSignOff = (text: string): string => {
  const { greeting, body } = parse(text);
  if (body.endsWith(SIGN_OFF)) {
    return join(greeting, body.slice(0, -SIGN_OFF.length));
  }
  return join(greeting, [sentence(body), SIGN_OFF].filter(Boolean).join(" "));
};

/**
 * Работа или строка итога. `order` — все такие чипы в порядке показа: новый
 * текст встаёт перед первым из следующих за ним, что уже есть в сообщении.
 */
export const togglePart = (
  text: string,
  part: string,
  order: string[],
): string => {
  const { greeting, body } = parse(text);
  if (body.includes(part)) return join(greeting, body.replace(part, ""));

  const later = order.slice(order.indexOf(part) + 1);
  return join(greeting, insert(body, part, later));
};
