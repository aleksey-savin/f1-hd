import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  changedKeys,
  mergeDraft,
  type DraftPayload,
} from "@/components/app/draft-merge";

// Черновик страницы настроек. Секции кладут сюда своё тело, а сохраняет их
// одна плашка внизу (app/DraftBar): пока правок нет, кнопки сохранения на
// странице нет вовсе, и промахнуться мимо «своей» секции нечем.
//
// Почему база сравнения — снимок ПРИ МОНТИРОВАНИИ, а не документ из loader'а:
// секреты наружу не отдаются, и пустое поле пароля означает «не менять»
// (см. «Секреты в настройках» в docs/ux-ui-guide.md). Сравнивать такое тело с
// сохранённым документом бессмысленно — сравниваем с тем, каким оно было в
// момент открытия страницы.

export type { DraftPayload };

/** Раздел, в котором есть несохранённые правки. */
export type DraftSection = { id: string; label: string };

type DraftEntry = DraftSection & {
  payload: DraftPayload;
  baseline: DraftPayload;
  /** Непустая причина гасит «Сохранить» и объясняет, чего не хватает. */
  blockedReason: string | null;
};

type DraftApi = {
  /** Изменённые разделы в порядке страницы. */
  sections: DraftSection[];
  isDirty: boolean;
  /** Почему сохранять нельзя — от первой такой изменённой секции. */
  blockedReason: string | null;
  /** Только изменившиеся ключи всех изменённых секций — одним телом. */
  buildPayload: () => DraftPayload;
  /** Пересеять секции из свежих данных loader'а: сохранили или отменили. */
  reset: () => void;
  /**
   * Ключ секции для ремоунта. Меняется ТОЛЬКО у разделов, которые были в
   * последнем сохранении (или отмене): их состояние надо пересеять, а соседей
   * трогать нельзя — у них своя незавершённая работа (открытая форма
   * отсутствия, ожидание привязки бота, диалог смены пароля, результат
   * проверки канала). Счётчик на раздел, а не общий: общий возвращал бы ключ
   * соседа к прежнему значению и ремоунтил уже его.
   */
  sectionKey: (id: string) => string;
  register: (entry: DraftEntry) => void;
  unregister: (id: string) => void;
};

const DraftContext = createContext<DraftApi | null>(null);
const SectionMetaContext = createContext<DraftSection | null>(null);

export const DraftProvider = ({ children }: { children: ReactNode }) => {
  // Реестр живёт в ref: секции перерегистрируются на каждый свой рендер, и
  // держать это состоянием нельзя — вышел бы цикл. Состоянием держим только то,
  // от чего зависит вид плашки: набор изменённых разделов и причину отказа.
  const entries = useRef(new Map<string, DraftEntry>());
  const [dirtyIds, setDirtyIds] = useState<string[]>([]);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [resetCounts, setResetCounts] = useState<Record<string, number>>({});

  // Причину считаем здесь же, а не в мемо ниже: она меняется и при неизменном
  // наборе разделов — стоит очистить обязательное поле уже изменённой секции.
  const sync = useCallback(() => {
    const next: string[] = [];
    let reason: string | null = null;
    entries.current.forEach((entry, id) => {
      if (changedKeys(entry.payload, entry.baseline).length === 0) return;
      next.push(id);
      reason = reason ?? entry.blockedReason;
    });
    setDirtyIds((prev) =>
      prev.length === next.length && prev.every((id, i) => id === next[i])
        ? prev
        : next,
    );
    setBlockedReason(reason);
  }, []);

  const register = useCallback(
    (entry: DraftEntry) => {
      entries.current.set(entry.id, entry);
      sync();
    },
    [sync],
  );

  const unregister = useCallback(
    (id: string) => {
      entries.current.delete(id);
      sync();
    },
    [sync],
  );

  const api = useMemo<DraftApi>(
    () => ({
      // Порядок реестра — порядок монтирования, то есть порядок секций на
      // странице: в плашке разделы перечислены так же, как идут глазами.
      sections: dirtyIds.map((id) => ({
        id,
        label: entries.current.get(id)?.label ?? id,
      })),
      isDirty: dirtyIds.length > 0,
      blockedReason,
      buildPayload: () => mergeDraft(entries.current.values()),
      reset: () => {
        const reseeded = dirtyIds;
        entries.current.clear();
        setDirtyIds([]);
        setBlockedReason(null);
        setResetCounts((counts) => {
          const next = { ...counts };
          for (const id of reseeded) next[id] = (next[id] ?? 0) + 1;
          return next;
        });
      },
      sectionKey: (id: string) => `${id}:${resetCounts[id] ?? 0}`,
      register,
      unregister,
    }),
    [dirtyIds, blockedReason, resetCounts, register, unregister],
  );

  return <DraftContext.Provider value={api}>{children}</DraftContext.Provider>;
};

/** Страница и плашка читают черновик отсюда. */
export const useDraft = (): DraftApi => {
  const draft = useContext(DraftContext);
  if (!draft) {
    throw new Error("useDraft вызван вне app/DraftProvider");
  }
  return draft;
};

/**
 * Подпись и якорь секции для черновика. Ставит app/SettingsSection — он и так
 * знает `id` и `label`, поэтому дублировать их в каждой секции не приходится.
 */
export const SectionMetaProvider = ({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) => {
  const meta = useMemo(() => ({ id, label }), [id, label]);

  return (
    <SectionMetaContext.Provider value={meta}>
      {children}
    </SectionMetaContext.Provider>
  );
};

/** Есть ли в разделе несохранённые правки: метка секции и пункт рейла. */
export const useIsSectionDirty = (id: string) => {
  const draft = useContext(DraftContext);

  return !!draft?.sections.some((section) => section.id === id);
};

/**
 * Регистрирует секцию в черновике страницы — зовёт обёртка секции. Вне
 * провайдера ничего не делает: app/SettingsSection живёт и на страницах без
 * черновика.
 */
export const useDraftSection = (
  buildPayload: () => DraftPayload,
  blockedReason: string | null = null,
) => {
  const draft = useContext(DraftContext);
  const meta = useContext(SectionMetaContext);
  const register = draft?.register;
  const unregister = draft?.unregister;

  const payload = buildPayload();
  // Снимок — КОПИЯ: секции держат состояние объектами (график, блоки
  // провайдеров ИИ), и ссылка на них менялась бы вместе с правкой, а разница
  // не находилась бы никогда. Сравнение всё равно идёт через JSON, поэтому
  // копия тем же способом ничего не теряет.
  const baseline = useRef<DraftPayload | null>(null);
  if (baseline.current === null) {
    baseline.current = JSON.parse(JSON.stringify(payload)) as DraftPayload;
  }

  // Без массива зависимостей: тело пересобирается на каждый рендер секции, и
  // черновик обязан видеть текущее. Лишние перерисовки гасит сам провайдер.
  useEffect(() => {
    if (!register || !meta || !baseline.current) return;
    register({
      id: meta.id,
      label: meta.label,
      payload,
      baseline: baseline.current,
      blockedReason,
    });
  });

  // Снятие с учёта — отдельным эффектом со СТАБИЛЬНЫМИ зависимостями: положи
  // сюда весь `draft`, и его новая ссылка после каждой правки снимала бы
  // секцию с учёта сразу после регистрации.
  useEffect(() => {
    if (!unregister || !meta) return undefined;
    return () => unregister(meta.id);
  }, [unregister, meta]);
};
