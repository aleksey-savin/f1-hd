import { useEffect, useMemo } from "react";
import { useParams } from "react-router";

import Badge from "react-bootstrap/Badge";
import ListGroup from "react-bootstrap/ListGroup";

import { RiArrowRightSLine } from "react-icons/ri";

import AlertMessage from "../../UI/AlertMessage";
import useKnowledgeNotesStore, {
  hasActiveFilter,
} from "../../store/lists/knowledgeNotes";
import {
  groupNotesByCompany,
  groupKeysOfNote,
} from "../../util/knowledgeNoteGrouping";

import NoteItem from "./NoteItem";
import NoteBulkActionBar from "./NoteBulkActionBar";

import "../../UI/knowledgeBase.css";

// Заголовок группы-папки. Липнет к верху скролл-контейнера, поэтому при длинном
// списке всегда видно, чьи заметки сейчас на экране.
const GroupHeader = ({ group, expanded, onToggle }) => (
  <button
    type="button"
    className={`kb-group${expanded ? "" : " is-collapsed"}`}
    aria-expanded={expanded}
    onClick={onToggle}
  >
    <RiArrowRightSLine className="kb-group__chevron" aria-hidden="true" />
    <span className="kb-group__title">{group.title}</span>
    <Badge bg="secondary" className="ms-auto">
      {group.notes.length}
    </Badge>
  </button>
);

// Список заметок как дерево папок-компаний («Общие» первой). Все папки свёрнуты
// по умолчанию: на двух сотнях заметок раскрытое дерево — это две сотни строк в
// колонке шириной в треть экрана, а список папок целиком помещается на экран и
// сам работает навигацией. Раскрываются папка открытой заметки и — пока идёт
// поиск — все папки с совпадениями.
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
  const asTree = !flat && !moderationMode;

  const groups = useMemo(
    () => (asTree ? groupNotesByCompany(list) : null),
    [list, asTree],
  );

  // Одна группа — группировать нечего: так бывает при выбранной компании и у
  // клиента, которому видны только заметки своей компании.
  const grouped = !!groups && groups.length > 1;

  // Раскрываем папки поиска по-настоящему, а не подменой флага: иначе заголовок
  // группы выглядит кликабельным, но клик по нему ничего не делает. Очистка
  // запроса сворачивает их обратно (см. fullTextSearch в сторе).
  useEffect(() => {
    if (!grouped || !isSearching) {
      return;
    }
    expandGroups(groups.map((group) => group.key));
  }, [grouped, isSearching, groups, expandGroups]);

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

  const renderNote = (note) => (
    <NoteItem
      key={note._id}
      note={note}
      isActive={note._id === activeId}
      selectable={!!moderationMode}
      isSelected={selectedIds.includes(note._id)}
      onToggleSelected={toggleSelected}
      showCompanies={showCompanies ?? !grouped}
    />
  );

  return (
    <>
      <div className="kb-explorer__list">
        {list.length === 0 ? (
          <AlertMessage variant="light" message={emptyMessage} />
        ) : grouped ? (
          groups.map((group) => (
            <div key={group.key}>
              <GroupHeader
                group={group}
                expanded={isExpanded(group.key)}
                onToggle={() => toggleGroup(group.key)}
              />
              {isExpanded(group.key) && (
                <ListGroup variant="flush">
                  {group.notes.map(renderNote)}
                </ListGroup>
              )}
            </div>
          ))
        ) : (
          <ListGroup variant="flush">{list.map(renderNote)}</ListGroup>
        )}
      </div>

      <NoteBulkActionBar />
    </>
  );
};

export default NoteList;
