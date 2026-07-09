import { useContext } from "react";
import { Link } from "react-router";

import Accordion from "react-bootstrap/Accordion";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Dropdown from "react-bootstrap/Dropdown";
import Stack from "react-bootstrap/Stack";

import { RiAddLine } from "react-icons/ri";

import SearchBar from "../../UI/SearchBar";
import useKnowledgeNotesStore from "../../store/lists/knowledgeNotes";
import { AuthedUserContext } from "../../store/authed-user-context";

import NoteList from "./NoteList";
import useModerationSummary from "./useModerationSummary";
import {
  ScopeSwitch,
  TypeChips,
  ModerationMenu,
  BindingFilters,
  activeFilterCount,
  isFilterActive,
  MODERATION_FILTERS,
} from "./Filter";

import "../../UI/knowledgeBase.css";

// Сортировка ссылкой-дропдауном, а не полноразмерным Select'ом: она меняется
// раз в сессию, а место занимает постоянно.
const SortMenu = () => {
  const sortBy = useKnowledgeNotesStore((state) => state.sortBy);
  const sortingOptions = useKnowledgeNotesStore((state) => state.sortingOptions);
  const handleSorting = useKnowledgeNotesStore((state) => state.handleSorting);

  return (
    <Dropdown>
      <Dropdown.Toggle
        variant="link"
        size="sm"
        className="kb-explorer__sort"
        aria-label="Сортировка"
      >
        {sortBy.label}
      </Dropdown.Toggle>
      <Dropdown.Menu align="end">
        {sortingOptions.map((option) => (
          <Dropdown.Item
            key={option.label}
            active={option.label === sortBy.label}
            onClick={() => handleSorting(option)}
          >
            {option.label}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
};

// Проводник по базе знаний для десктопной левой колонки (Root.jsx).
//
// Заметки — главное на этой странице, поэтому над списком ровно три ряда:
// поиск с действиями, свёрнутые «Фильтры» и строка состояния. Набор данных,
// чипы типов и мультиселекты уехали внутрь аккордеона: каждый из них стоил
// списку 40+ пикселей, а трогают их редко. То, что скрыто, посчитано бейджем.
//
// На мобилке эту роль играет pages/KnowledgeBase/List.jsx поверх ListWrapper.
const KnowledgeBaseExplorer = () => {
  const { isAdmin, permissions } = useContext(AuthedUserContext);
  const canManage = isAdmin || permissions?.canManageKnowledgeBase;

  const store = useKnowledgeNotesStore();
  const {
    filteredList,
    searchTerm,
    fullTextSearch,
    resetFilter,
    scope,
    moderationMode,
  } = store;

  const { counts } = useModerationSummary();
  const activeFilters = activeFilterCount(store);

  const queue = MODERATION_FILTERS.find((item) => item.mode === moderationMode);
  const context = queue ? `Очередь: ${queue.label}` : scope === "archived" ? "Архив" : null;

  return (
    <Stack gap={2} className="kb-explorer">
      <div className="d-flex align-items-center gap-2">
        <div className="flex-grow-1">
          <SearchBar
            value={searchTerm}
            onChange={(event) => fullTextSearch(event.target.value)}
          />
        </div>
        <ModerationMenu counts={counts} />
        {canManage && (
          <Button
            as={Link}
            to="/knowledge-base/add"
            variant="primary"
            title="Новая заметка"
            aria-label="Новая заметка"
            className="kb-explorer__add"
          >
            <RiAddLine />
          </Button>
        )}
      </div>

      <Accordion flush className="kb-filters">
        <Accordion.Item eventKey="filters">
          <Accordion.Header>
            Фильтры
            {activeFilters > 0 && (
              <Badge bg="primary" className="ms-2">
                {activeFilters}
              </Badge>
            )}
          </Accordion.Header>
          <Accordion.Body>
            <Stack gap={3}>
              <ScopeSwitch />
              <TypeChips />
              <BindingFilters />
            </Stack>
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>

      <div className="kb-explorer__status">
        {context && <span className="text-body fw-semibold">{context}</span>}
        <span>Найдено: {filteredList.length}</span>
        {isFilterActive(store) && (
          <Button
            variant="link"
            size="sm"
            className="kb-explorer__reset"
            onClick={resetFilter}
          >
            Сбросить
          </Button>
        )}
        <SortMenu />
      </div>

      <NoteList />
    </Stack>
  );
};

export default KnowledgeBaseExplorer;
