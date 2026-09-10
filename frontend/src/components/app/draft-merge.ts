// Чистая часть черновика настроек (app/draft-context): что считать правкой и
// как сложить правки нескольких секций в одно тело запроса. Без React —
// поэтому проверяется юнит-тестом (`node --test src/components/app/draft-merge.test.js`).

/** Тело секции: ключи верхнего уровня документа настроек. */
export type DraftPayload = Record<string, unknown>;

/** Секция глазами черновика: тело сейчас и тело на момент открытия страницы. */
export type DraftDiff = { payload: DraftPayload; baseline: DraftPayload };

const isGroup = (value: unknown): value is DraftPayload =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Ключи, значение которых отличается от снимка «как было при открытии».
 *
 * Идём по ключам ТЕКУЩЕГО тела: ключ, который секция перестала присылать
 * (инициатор по умолчанию в «Сборе заявок»), правкой не считается — отсутствие
 * ключа бэкенд читает как «не трогать», и сохранить такое всё равно нельзя.
 *
 * Сравнение через JSON: оба объекта строит один и тот же buildPayload, поэтому
 * порядок ключей у них одинаковый. Плата за простоту — перестановка элементов
 * массива (список модераторов) читается как правка.
 */
export const changedKeys = (current: DraftPayload, baseline: DraftPayload) =>
  Object.keys(current).filter(
    (key) => JSON.stringify(current[key]) !== JSON.stringify(baseline[key]),
  );

/** То же на уровень глубже — поля внутри группы. */
const changedFields = (current: DraftPayload, baseline: unknown) => {
  const base = isGroup(baseline) ? baseline : {};
  const fields: DraftPayload = {};
  for (const key of changedKeys(current, base)) {
    fields[key] = current[key];
  }
  return fields;
};

/**
 * Тело запроса: только изменившиеся ключи всех секций.
 *
 * Одну группу могут заполнять две секции — `overtime` заполняют и «Финансы», и
 * «Производственный календарь». Бэкенд заменяет группу целиком, поэтому
 * склеиваем её здесь: поверх целой группы от первой секции ложатся только те
 * поля, которые вторая действительно меняла, — иначе её снимок loader'а затёр
 * бы свежие правки соседки.
 */
export const mergeDraft = (entries: Iterable<DraftDiff>): DraftPayload => {
  const body: DraftPayload = {};

  for (const entry of entries) {
    for (const key of changedKeys(entry.payload, entry.baseline)) {
      const value = entry.payload[key];
      const collected = body[key];

      body[key] =
        isGroup(collected) && isGroup(value)
          ? { ...collected, ...changedFields(value, entry.baseline[key]) }
          : value;
    }
  }

  return body;
};
