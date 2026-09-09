/**
 * Черновик новой заявки в `localStorage`.
 *
 * Половину заполненной анкеты легко потерять: на телефоне шторку закрывает
 * тап по затемнению, а браузер выгружает фоновую вкладку сам. Черновик
 * переживает и то, и другое — в отличие от `sessionStorage`, который умирает
 * вместе со вкладкой, то есть ровно в том случае, от которого мы страхуемся.
 *
 * Ключ — на человека и на заготовку: заявки по разным шаблонам не смешиваются,
 * а на общем компьютере один человек не увидит набросок другого. Без
 * идентификатора человека черновик не пишется вовсе: перепутать чужой хуже,
 * чем потерять свой.
 *
 * Вложения в черновик не попадают (файл в строку не положить) — поэтому
 * запись помнит `hadFiles`, и форма может сказать, что их надо прикрепить
 * заново.
 *
 * Срок — сутки: набросок, который всплывает через неделю, сбивает больше, чем
 * помогает. Просроченные записи чистятся попутно, при любом чтении.
 */

export const DRAFT_PREFIX = "hd.ticketDraft.";
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

// Хранилища может не быть (приватное окно, отключённые данные сайта) или его
// обращения могут бросать. Черновик — удобство, и падать из-за него форма
// не имеет права: каждое обращение обёрнуто, отказ читается как «черновика нет».
const store = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const keyOf = (userId, templateId) =>
  `${DRAFT_PREFIX}${userId}.${templateId || "none"}`;

const drop = (storage, key) => {
  try {
    storage.removeItem(key);
  } catch {
    // хранилище недоступно — чистить нечего
  }
};

/** Ключи всех черновиков: `localStorage` не итерируется, только по индексу. */
const draftKeys = (storage) => {
  const keys = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
  } catch {
    return keys;
  }
  return keys;
};

const prune = (storage, now) => {
  for (const key of draftKeys(storage)) {
    let entry = null;
    try {
      entry = JSON.parse(storage.getItem(key) ?? "");
    } catch {
      entry = null;
    }
    const fresh =
      entry && entry.data && now - Number(entry.savedAt) < DRAFT_TTL_MS;
    if (!fresh) drop(storage, key);
  }
};

/**
 * @param {{ userId?: string, templateId?: string|null }} params
 * @returns {{ savedAt: number, hadFiles: boolean, data: object }|null}
 */
export const readDraft = ({ userId, templateId }) => {
  const storage = store();
  if (!storage || !userId) return null;

  // Чистим весь набор, а не только свой ключ: заготовок много, и мёртвые
  // записи иначе лежали бы до конца времён
  prune(storage, Date.now());

  let entry = null;
  try {
    entry = JSON.parse(storage.getItem(keyOf(userId, templateId)) ?? "");
  } catch {
    return null;
  }
  if (!entry?.data) return null;

  return {
    savedAt: Number(entry.savedAt) || 0,
    hadFiles: !!entry.hadFiles,
    data: entry.data,
  };
};

/**
 * @param {{ userId?: string, templateId?: string|null, data: object, hadFiles?: boolean }} params
 */
export const saveDraft = ({ userId, templateId, data, hadFiles = false }) => {
  const storage = store();
  if (!storage || !userId || !data) return;
  try {
    storage.setItem(
      keyOf(userId, templateId),
      JSON.stringify({ savedAt: Date.now(), hadFiles, data }),
    );
  } catch {
    // Переполнение или запрет записи: заявку это не должно останавливать
  }
};

export const clearDraft = ({ userId, templateId }) => {
  const storage = store();
  if (!storage || !userId) return;
  drop(storage, keyOf(userId, templateId));
};

/** Выход из системы: чужих наброски на этом компьютере оставаться не должно. */
export const clearAllDrafts = () => {
  const storage = store();
  if (!storage) return;
  for (const key of draftKeys(storage)) drop(storage, key);
};
