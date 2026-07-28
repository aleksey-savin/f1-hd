import { useEffect, useMemo } from "react";
import { useParams } from "react-router";

import { RiArrowRightSLine, RiInboxLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

import useKnowledgeNotesStore, {
  hasActiveFilter,
} from "../../store/lists/knowledgeNotes";
import { plural } from "../../util/plural";
import {
  groupNotesByCompany,
  groupKeysOfNote,
} from "../../util/knowledgeNoteGrouping";

import NoteItem from "./NoteItem";

// Заголовок папки-компании. Это навигация, а не подпись к секции: строка
// кликается целиком, поэтому обычный регистр, шеврон и счётчик (uppercase-метку
// ListGroupLabel оставляем неинтерактивным группам).
const FolderRow = ({ group, expanded, onToggle }) => {
  const unapproved = group.notes.filter(
    (note) => note.approved !== true,
  ).length;

  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2 tw:border-0 tw:bg-transparent tw:px-3.5 tw:py-2.5 tw:text-start tw:text-base tw:font-semibold tw:text-foreground tw:transition-colors tw:hover:bg-accent/60 tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50 tw:focus-visible:outline-none"
    >
      <RiArrowRightSLine
        size={16}
        aria-hidden
        className={cn(
          "tw:flex-none tw:text-faint tw:transition-transform tw:motion-reduce:transition-none",
          expanded && "tw:rotate-90",
        )}
      />
      <span className="tw:min-w-0 tw:truncate">{group.title}</span>
      <span className="tw:flex-none tw:text-faint tw:tabular-nums">
        · {group.notes.length}
      </span>
      {unapproved > 0 && (
        <span className="tw:ms-auto tw:flex-none tw:text-sm tw:font-normal tw:text-faint tw:tabular-nums">
          {unapproved}{" "}
          {plural(unapproved, "не проверена", "не проверены", "не проверено")}
        </span>
      )}
    </button>
  );
};

const EmptyState = ({ message }) => (
  <div className="tw:flex tw:flex-col tw:items-center tw:gap-1.5 tw:px-5 tw:py-12 tw:text-center">
    <RiInboxLine size={32} aria-hidden className="tw:text-faint" />
    <p className="tw:my-0 tw:text-sm tw:text-muted-foreground">{message}</p>
  </div>
);

// Список заметок как дерево папок-компаний («Общие» первой). Все папки свёрнуты
// по умолчанию: на двух сотнях заметок раскрытое дерево — это две сотни строк в
// узкой колонке, а список папок целиком помещается на экран и сам работает
// навигацией. Раскрываются папка открытой заметки и — пока идёт поиск — все
// папки с совпадениями.
//
// В очередях модерации дерева нет: там важен статус, а не компания, и работает
// выделение для массовых действий.
const NoteList = ({ notes, flat = false, showCompanies }) => {
  const { id: activeId } = useParams();
  const store = useKnowledgeNotesStore();
  const {
    filteredList,
    isLoading,
    scope,
    searchTerm,
    moderationMode,
    selectedIds,
    toggleSelected,
    expandedGroups,
    toggleGroup,
    expandGroups,
  } = store;

  const list = notes ?? filteredList;
  const isSearching = searchTerm.trim().length > 0;
  const asTree = !flat && !moderationMode && !isSearching;

  const groups = useMemo(
    () => (asTree ? groupNotesByCompany(list) : null),
    [list, asTree],
  );

  // Одна группа — группировать нечего: так бывает при выбранной компании и у
  // клиента, которому видны только заметки своей компании.
  const grouped = !!groups && groups.length > 1;

  // Открыли заметку из свёрнутой папки (переход по ссылке, deep-link) — папку
  // раскрываем, иначе активной строки не видно.
  const activeNote = list.find((note) => note._id === activeId);
  useEffect(() => {
    if (!activeNote || !grouped) {
      return;
    }
    expandGroups(groupKeysOfNote(activeNote));
  }, [activeNote, grouped, expandGroups]);

  const isExpanded = (key) => expandedGroups.includes(key);

  const emptyMessage = isLoading
    ? "Загрузка…"
    : scope === "archived"
      ? "Архив пуст"
      : moderationMode
        ? "В этой очереди пусто — всё разобрано"
        : hasActiveFilter(store)
          ? "Ничего не нашлось. Измените запрос или сбросьте фильтры"
          : "Заметок пока нет";

  const renderNote = (note, nested) => (
    <NoteItem
      key={note._id}
      note={note}
      nested={nested}
      isActive={note._id === activeId}
      selectable={!!moderationMode}
      isSelected={selectedIds.includes(note._id)}
      onToggleSelected={toggleSelected}
      showCompanies={showCompanies ?? !grouped}
    />
  );

  if (list.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  if (!grouped) {
    return <div>{list.map((note) => renderNote(note, false))}</div>;
  }

  return (
    <div>
      {groups.map((group, index) => (
        <div
          key={group.key}
          // Разделитель между папками — сверху у каждой, кроме первой
          style={
            index > 0 ? { borderTop: "1px solid var(--border-soft)" } : undefined
          }
        >
          <FolderRow
            group={group}
            expanded={isExpanded(group.key)}
            onToggle={() => toggleGroup(group.key)}
          />
          {isExpanded(group.key) && (
            <div>{group.notes.map((note) => renderNote(note, true))}</div>
          )}
        </div>
      ))}
    </div>
  );
};

export default NoteList;
