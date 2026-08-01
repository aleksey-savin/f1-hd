import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  AnimatePresence,
  Reorder,
  motion,
  useDragControls,
  useReducedMotion,
} from "framer-motion";
import {
  RiAddLine,
  RiArrowGoBackLine,
  RiCheckLine,
  RiCheckboxMultipleLine,
  RiDeleteBinLine,
  RiDraggable,
  RiErrorWarningLine,
  RiFlag2Fill,
  RiFlag2Line,
} from "react-icons/ri";

import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

// Переиспользуемый чек-лист приложения (макет согласован до кода). Один компонент,
// три режима:
//   - run  — выполнение (заявка): отметка исполнителем, прогресс, подпись «кто · когда»,
//            обязательные пункты, сноска про закрытие;
//   - edit — составление (шаблон/регламент/правка чек-листа заявки): добавление по Enter,
//            правка на месте, порядок перетаскиванием/Alt+↑↓, флаг «обязательный», удаление с возвратом;
//   - read — только чтение (предпросмотр).
// Компонент контролируемый: run зовёт onToggle(item, checked), edit — onChange(items).
// Форма пункта — надмножество нынешних заявки и регламента.

type ChecklistItemData = {
  _id: string;
  description: string;
  checked?: boolean;
  mandatory?: boolean;
  checkedBy?: { _id?: string; firstName?: string; lastName?: string } | null;
  checkedAt?: string | Date | null;
};

type Mode = "run" | "edit" | "read";

type ChecklistProps = {
  mode?: Mode;
  items: ChecklistItemData[];
  /** edit: новый список после любой мутации. */
  onChange?: (items: ChecklistItemData[]) => void;
  /** run: одиночная отметка пункта. */
  onToggle?: (item: ChecklistItemData, checked: boolean) => void;
  /** run: может ли пользователь отмечать (исполнитель заявки). */
  canCheck?: boolean;
  /** run: показать поле добавления (по умолчанию только в edit). */
  canAdd?: boolean;
  /** Заголовок-eyebrow над списком. */
  title?: string;
  /** run: сноска про блокировку закрытия заявки обязательными пунктами. */
  mandatoryGuard?: boolean;
  /** Обернуть в панель с границей (по умолчанию да). */
  framed?: boolean;
  /** run/read: показывать прогресс выполнения (done/total + %). Для шаблона
   *  (определение, не выполнение) — false: остаётся только счётчик пунктов. */
  showProgress?: boolean;
  /** Скрыть встроенный заголовок (eyebrow + счётчик/прогресс) — когда секцию
   *  подписывают снаружи (например, карточка со своей кнопкой «Изменить»). */
  showHeader?: boolean;
  className?: string;
};

const genId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `tmp-${Math.random().toString(16).slice(2)}-${Date.now()}`;

const normalize = (i: ChecklistItemData): ChecklistItemData => ({
  _id: i._id,
  description: i.description ?? "",
  checked: !!i.checked,
  mandatory: !!i.mandatory,
  checkedBy: i.checkedBy ?? null,
  checkedAt: i.checkedAt ?? null,
});

const plural = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "пункт";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "пункта";
  return "пунктов";
};

// «сегодня 15:10» / «12 июля 15:10» — короткая подпись времени отметки.
const MONTHS = "янв фев мар апр мая июн июл авг сен окт ноя дек".split(" ");
const formatWhen = (value?: string | Date | null): string => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  return sameDay
    ? `сегодня ${hh}:${mm}`
    : `${d.getDate()} ${MONTHS[d.getMonth()]} ${hh}:${mm}`;
};

const ROW =
  "group relative flex items-start gap-3 rounded-lg px-1.5 py-2.5 transition-colors";
// Разделитель между строками — фоновой линией (как в app/ListRow): голый border-t
// без preflight ненадёжен. Отступ слева — под чекбокс/ручку.
const DIVIDER =
  "before:absolute before:top-0 before:right-1.5 before:left-9 before:h-px before:bg-border-soft first:before:hidden";
const ICON_BTN =
  "inline-grid size-8 place-items-center appearance-none rounded-md border-0 bg-transparent text-faint transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50 [&_svg]:size-4";
const KBD =
  "rounded border border-border bg-accent px-1.5 py-0.5 text-xs font-semibold text-muted-foreground";

const EnterEsc = () => (
  <span className="mt-1.5 flex items-center gap-1.5 text-xs text-faint">
    <kbd className={KBD}>Enter</kbd> сохранить · <kbd className={KBD}>Esc</kbd>{" "}
    отменить
  </span>
);

/* ---------- Строка режима составления ---------- */

const EditRow = ({
  item,
  editing,
  onEdit,
  onCommit,
  onCancel,
  onToggleMandatory,
  onDelete,
  onMove,
  reduce,
}: {
  item: ChecklistItemData;
  editing: boolean;
  onEdit: () => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
  onToggleMandatory: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  reduce: boolean;
}) => {
  const controls = useDragControls();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  return (
    <Reorder.Item
      as="li"
      value={item}
      dragListener={false}
      dragControls={controls}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={
        reduce
          ? { opacity: 0 }
          : { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }
      }
      transition={{ duration: reduce ? 0 : 0.18 }}
      tabIndex={0}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          onMove(e.key === "ArrowUp" ? -1 : 1);
        }
      }}
      className={cn(
        ROW,
        DIVIDER,
        "list-none hover:bg-accent/60 focus-visible:bg-accent/60 outline-none",
      )}
    >
      <span
        onPointerDown={(e) => controls.start(e)}
        style={{ touchAction: "none" }}
        title="Перетащить"
        aria-hidden
        className="mt-0.5 inline-grid size-5 flex-none cursor-grab place-items-center text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 active:cursor-grabbing pointer-coarse:opacity-100 [&_svg]:size-4"
      >
        <RiDraggable />
      </span>

      <div className="min-w-0 flex-1">
        {editing ? (
          <>
            <input
              ref={inputRef}
              defaultValue={item.description}
              aria-label="Текст пункта"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onCommit(e.currentTarget.value);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onCancel();
                }
              }}
              onBlur={(e) => onCommit(e.currentTarget.value)}
              className="w-full appearance-none rounded-md border border-ring bg-transparent px-2 py-1 text-sm text-foreground outline-none ring-4 ring-ring/25"
            />
            <EnterEsc />
          </>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="block w-full cursor-text appearance-none border-0 bg-transparent p-0 text-left text-sm text-foreground"
          >
            {item.description}
            {item.mandatory && <MandatoryTag />}
          </button>
        )}
      </div>

      <span className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
        <button
          type="button"
          onClick={onToggleMandatory}
          title={
            item.mandatory ? "Сделать необязательным" : "Сделать обязательным"
          }
          aria-pressed={item.mandatory}
          className={cn(
            ICON_BTN,
            item.mandatory && "text-warning hover:text-warning",
          )}
        >
          {item.mandatory ? <RiFlag2Fill /> : <RiFlag2Line />}
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Удалить"
          className={cn(ICON_BTN, "hover:text-destructive")}
        >
          <RiDeleteBinLine />
        </button>
      </span>
    </Reorder.Item>
  );
};

/* ---------- Строка режимов выполнения / чтения ---------- */

const RunRow = ({
  item,
  mode,
  canCheck,
  attribution,
  onToggle,
  reduce,
}: {
  item: ChecklistItemData;
  mode: Mode;
  canCheck: boolean;
  attribution: ReactNode;
  onToggle: (item: ChecklistItemData, checked: boolean) => void;
  reduce: boolean;
}) => {
  const id = useId();
  const interactive = mode === "run" && canCheck;

  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: reduce ? 0 : 0.18 }}
      className="list-none"
    >
      <label
        htmlFor={id}
        className={cn(
          ROW,
          DIVIDER,
          interactive ? "cursor-pointer hover:bg-accent/60" : "cursor-default",
        )}
      >
        <Checkbox
          id={id}
          checked={!!item.checked}
          disabled={!interactive}
          onCheckedChange={(v) => onToggle(item, v === true)}
          className="mt-0.5 flex-none disabled:opacity-100"
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "text-sm text-foreground",
              item.checked &&
                "text-muted-foreground line-through decoration-faint/70",
            )}
          >
            {item.description}
            {item.mandatory && !item.checked && <MandatoryTag />}
          </div>
          {attribution && (
            <div className="mt-0.5 text-xs text-faint tabular-nums">
              {attribution}
            </div>
          )}
        </div>
      </label>
    </motion.li>
  );
};

const MandatoryTag = () => (
  <span className="ml-2 inline-flex items-center gap-1.5 align-middle text-xs font-semibold text-warning">
    <span className="size-1.5 rounded-full bg-warning" />
    обязательно
  </span>
);

/* ---------- Компонент ---------- */

const Checklist = ({
  mode = "run",
  items,
  onChange,
  onToggle,
  canCheck = true,
  canAdd = false,
  title = "Чек-лист",
  mandatoryGuard = false,
  framed = true,
  showProgress = true,
  showHeader = true,
  className,
}: ChecklistProps) => {
  const reduce = useReducedMotion() ?? false;
  const [local, setLocal] = useState<ChecklistItemData[]>(() =>
    items.map(normalize),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [justToggled, setJustToggled] = useState<Set<string>>(() => new Set());
  const [undo, setUndo] = useState<{
    item: ChecklistItemData;
    index: number;
  } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const addRef = useRef<HTMLInputElement>(null);

  // Ресинк из пропсов при их реальном изменении (ответ сервера после отметки/сохранения).
  // Во время правки пропсы стабильны, поэтому локальный черновик не затирается.
  const signature = items
    .map(
      (i) =>
        `${i._id}:${i.checked ? 1 : 0}:${i.mandatory ? 1 : 0}:${
          i.checkedAt ?? ""
        }:${i.description}`,
    )
    .join("|");
  useEffect(() => {
    // В edit локальный черновик — источник правды: не затираем его пропсами
    // (родитель их и получает из наших onChange), иначе дёргается drag.
    if (mode === "edit") return;
    setLocal(items.map(normalize));
    setJustToggled(new Set());
  }, [signature, mode]);

  const isEdit = mode === "edit";
  const isRun = mode === "run";
  const showCompletion = !isEdit && showProgress;
  const total = local.length;
  const done = local.filter((i) => i.checked).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const mandatoryLeft = local.filter((i) => i.mandatory && !i.checked).length;

  // run/read с пустым списком — не показываем ничего (как раньше на заявке).
  if (!isEdit && total === 0) return null;

  const emit = (next: ChecklistItemData[]) => {
    setLocal(next);
    onChange?.(next);
  };

  const toggle = (item: ChecklistItemData, next: boolean) => {
    setLocal((prev) =>
      prev.map((i) =>
        i._id === item._id
          ? {
              ...i,
              checked: next,
              checkedBy: next ? i.checkedBy : null,
              checkedAt: next ? new Date().toISOString() : null,
            }
          : i,
      ),
    );
    setJustToggled((prev) => {
      const s = new Set(prev);
      if (next) s.add(item._id);
      else s.delete(item._id);
      return s;
    });
    onToggle?.(item, next);
  };

  const addItem = () => {
    const value = (addRef.current?.value ?? "").trim();
    if (!value) return;
    emit([
      ...local,
      {
        _id: genId(),
        description: value,
        checked: false,
        mandatory: false,
        checkedBy: null,
        checkedAt: null,
      },
    ]);
    if (addRef.current) {
      addRef.current.value = "";
      addRef.current.focus();
    }
  };

  const commitEdit = (id: string, value: string) => {
    const v = value.trim();
    if (v)
      emit(local.map((i) => (i._id === id ? { ...i, description: v } : i)));
    setEditingId(null);
  };

  const toggleMandatory = (id: string) =>
    emit(
      local.map((i) => (i._id === id ? { ...i, mandatory: !i.mandatory } : i)),
    );

  const removeItem = (id: string) => {
    const index = local.findIndex((i) => i._id === id);
    if (index < 0) return;
    const item = local[index];
    emit(local.filter((i) => i._id !== id));
    setUndo({ item, index });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  };

  const restore = () => {
    if (!undo) return;
    const next = [...local];
    next.splice(Math.min(undo.index, next.length), 0, undo.item);
    emit(next);
    setUndo(null);
  };

  const move = (id: string, dir: -1 | 1) => {
    const i = local.findIndex((x) => x._id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= local.length) return;
    const next = [...local];
    [next[i], next[j]] = [next[j], next[i]];
    emit(next);
  };

  const attributionOf = (item: ChecklistItemData): ReactNode => {
    if (!item.checked) return null;
    if (justToggled.has(item._id)) return "вы · только что";
    const name = item.checkedBy
      ? `${item.checkedBy.lastName ?? ""} ${item.checkedBy.firstName ?? ""}`.trim()
      : "";
    const when = formatWhen(item.checkedAt);
    return [name, when].filter(Boolean).join(" · ") || null;
  };

  return (
    <section
      className={cn(
        framed && "rounded-xl border border-border bg-card p-3",
        className,
      )}
    >
      {showHeader && (
        <div className="flex items-center gap-2 px-1.5 pt-0.5 pb-2.5">
          <span className="text-xs font-bold tracking-wider text-faint uppercase">
            {title}
          </span>
          <span className="text-xs font-bold text-faint tabular-nums">
            {showCompletion
              ? `${done} / ${total}`
              : `${total} ${plural(total)}`}
          </span>
          {showCompletion && (
            <span className="ml-auto text-sm font-semibold text-accent-text tabular-nums">
              {pct}%
            </span>
          )}
        </div>
      )}

      {/* Прогресс — и без встроенного заголовка: секция карточки подписывает
          список снаружи, но полоса выполнения остаётся его частью */}
      {showCompletion && total > 0 && (
        <Progress
          value={pct}
          className={cn("mx-1.5 mb-1 h-1.5", !showHeader && "mb-2")}
        />
      )}

      {/* Список */}
      {isEdit ? (
        total > 0 ? (
          <Reorder.Group
            as="ul"
            axis="y"
            values={local}
            onReorder={emit}
            className="m-0 list-none p-0"
          >
            <AnimatePresence initial={false}>
              {local.map((item) => (
                <EditRow
                  key={item._id}
                  item={item}
                  editing={editingId === item._id}
                  onEdit={() => setEditingId(item._id)}
                  onCommit={(v) => commitEdit(item._id, v)}
                  onCancel={() => setEditingId(null)}
                  onToggleMandatory={() => toggleMandatory(item._id)}
                  onDelete={() => removeItem(item._id)}
                  onMove={(d) => move(item._id, d)}
                  reduce={reduce}
                />
              ))}
            </AnimatePresence>
          </Reorder.Group>
        ) : (
          <div className="py-6 text-center">
            <RiCheckboxMultipleLine className="mx-auto mb-2 size-9 text-faint" />
            <div className="text-sm font-semibold">Пунктов пока нет</div>
            <div className="text-sm text-muted-foreground">
              Добавьте первый пункт списка.
            </div>
          </div>
        )
      ) : (
        <ul className="m-0 list-none p-0">
          <AnimatePresence initial={false}>
            {local.map((item) => (
              <RunRow
                key={item._id}
                item={item}
                mode={mode}
                canCheck={canCheck}
                attribution={attributionOf(item)}
                onToggle={toggle}
                reduce={reduce}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}

      {/* Поле добавления */}
      {(isEdit || canAdd) && (
        <div>
          <div className="flex items-center gap-2.5 px-1.5 pt-1.5">
            <RiAddLine className="size-4.5 flex-none text-faint" />
            <input
              ref={addRef}
              placeholder="Добавить пункт…"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addItem();
                } else if (e.key === "Escape") {
                  e.currentTarget.value = "";
                }
              }}
              className="flex-1 appearance-none border-0 bg-transparent py-1 text-sm text-foreground outline-none placeholder:text-faint"
            />
          </div>
          <div className="flex items-center gap-1.5 px-1.5 pt-1.5 text-xs text-faint">
            <kbd className={KBD}>Enter</kbd> добавить и продолжить
          </div>
        </div>
      )}

      {/* Возврат удалённого */}
      <AnimatePresence>
        {undo && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-1 flex items-center gap-3 px-1.5 py-2 text-sm text-muted-foreground"
          >
            <RiDeleteBinLine className="size-4 flex-none text-faint" />
            <span>Пункт удалён</span>
            <button
              type="button"
              onClick={restore}
              className="ml-auto inline-flex items-center gap-1.5 appearance-none rounded-md border-0 bg-transparent px-1.5 py-1 text-sm font-semibold text-accent-text outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50 [&_svg]:size-4"
            >
              <RiArrowGoBackLine /> Вернуть
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Сноска про закрытие заявки */}
      {isRun && mandatoryGuard && mandatoryLeft > 0 && (
        <div className="mt-1 flex items-center gap-2 border-t border-border-soft px-1.5 pt-3 text-sm text-warning">
          <RiErrorWarningLine className="size-4 flex-none" />
          {mandatoryLeft === 1
            ? "Не выполнен обязательный пункт"
            : "Не выполнены обязательные пункты"}{" "}
          — заявку нельзя закрыть
        </div>
      )}
      {isRun &&
        mandatoryGuard &&
        mandatoryLeft === 0 &&
        done === total &&
        total > 0 && (
          <div className="mt-1 flex items-center gap-2 border-t border-border-soft px-1.5 pt-3 text-sm text-accent-text">
            <RiCheckLine className="size-4 flex-none" />
            Все пункты выполнены — заявку можно закрыть
          </div>
        )}
    </section>
  );
};

export default Checklist;
