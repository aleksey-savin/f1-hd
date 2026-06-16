import { useContext, useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import ListGroup from "react-bootstrap/ListGroup";
import Stack from "react-bootstrap/Stack";

import {
  RiAddLine,
  RiDeleteBin6Line,
  RiShieldKeyholeLine,
  RiArchiveLine,
} from "react-icons/ri";

import Select from "../../UI/Select";
import useKnowledgeNotesStore from "../../store/lists/knowledgeNotes";
import useInitialPrefsStore from "../../store/prefs";
import { AuthedUserContext } from "../../store/authed-user-context";
import { NOTE_TYPES, getApprovalMeta } from "../../util/knowledgeNoteTypes";

// Уникальные объекты по _id
const uniqueById = (items) => {
  const map = new Map();
  items.forEach((item) => {
    if (item?._id) {
      map.set(item._id.toString(), item);
    }
  });
  return [...map.values()];
};

// Фильтры модерации (только для модераторов) — в обход скоупинга
const MODERATION_FILTERS = [
  { mode: "all-unapproved", label: "Не одобрены" },
  { mode: "pending-deletion", label: "Запрос на удаление" },
  { mode: "pending-archive", label: "Запрос на архивацию" },
  { mode: "flagged-secrets", label: "Найдены секреты" },
];

const KnowledgeBaseSidebar = () => {
  const { id: activeId } = useParams();
  const { isAdmin, permissions } = useContext(AuthedUserContext);
  const canManage = isAdmin || permissions?.canManageKnowledgeBase;
  const isModerator = useInitialPrefsStore(
    (state) => state.knowledgeBase.isModerator,
  );
  const scanForSecrets = useInitialPrefsStore(
    (state) => state.knowledgeBase.scanForSecrets,
  );

  const store = useKnowledgeNotesStore();
  const {
    originalList,
    filteredList,
    isLoading,
    enabledTypes,
    updateFilter,
    refresh,
    ensureLoaded,
    moderationMode,
    setModerationMode,
    showArchived,
    setShowArchived,
  } = store;

  const [query, setQuery] = useState(store.searchTerm || "");
  const [companies, setCompanies] = useState([]);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);

  const companyOptions = useMemo(
    () => uniqueById(originalList.flatMap((note) => note.companies || [])),
    [originalList],
  );
  const userOptions = useMemo(
    () => uniqueById(originalList.flatMap((note) => note.users || [])),
    [originalList],
  );
  const categoryOptions = useMemo(
    () => uniqueById(originalList.flatMap((note) => note.categories || [])),
    [originalList],
  );

  const hasFilter =
    query.trim().length > 0 ||
    companies.length > 0 ||
    users.length > 0 ||
    categories.length > 0;

  // Бейдж компании показываем после названия заметки, кроме случая, когда в
  // фильтре выбрана ровно одна компания (тогда он избыточен)
  const showCompanyBadges = companies.length !== 1;

  const searchHandler = (event) => {
    const value = event.target.value;
    setQuery(value);
    updateFilter({ searchTerm: value });
    refresh();
  };

  // Скоуп-фильтры (компания/пользователь/категория) выходят из режима модерации
  const companiesHandler = (selected) => {
    setCompanies(selected || []);
    updateFilter({
      companies: (selected || []).map((item) => item._id),
      moderationMode: null,
    });
    refresh();
  };

  const usersHandler = (selected) => {
    setUsers(selected || []);
    updateFilter({
      users: (selected || []).map((item) => item._id),
      moderationMode: null,
    });
    refresh();
  };

  const categoriesHandler = (selected) => {
    setCategories(selected || []);
    updateFilter({
      categories: (selected || []).map((item) => item._id),
      moderationMode: null,
    });
    refresh();
  };

  // Кнопки модерации: повторный клик по активной — сброс режима
  const toggleModerationMode = (mode) => {
    setModerationMode(moderationMode === mode ? null : mode);
  };

  const archiveToggleHandler = () => {
    setShowArchived(!showArchived);
  };

  // Тип — переключатель на каждый вид заметки; по умолчанию все включены.
  // Выключение типа убирает его заметки из выдачи (тип сам по себе список не открывает).
  const typeToggleHandler = (value) => {
    updateFilter({
      enabledTypes: {
        ...enabledTypes,
        [value]: !(enabledTypes?.[value] ?? true),
      },
    });
    refresh();
  };

  return (
    <Stack gap={3} style={{ maxHeight: "calc(100svh - 160px)" }}>
      {canManage && (
        <Button as={Link} to="/knowledge-base/add" variant="primary" size="sm">
          <RiAddLine /> Новая заметка
        </Button>
      )}

      <Form.Control
        type="search"
        value={query}
        placeholder="Поиск по базе знаний"
        onChange={searchHandler}
      />

      {/* Фильтры всегда видимы. Опции подгружаются при открытии списка. */}
      <Stack gap={2}>
        <Select
          placeholder="Компании"
          closeMenuOnSelect={false}
          isClearable
          isSearchable
          isMulti
          value={companies}
          options={companyOptions}
          onMenuOpen={ensureLoaded}
          getOptionLabel={(option) => option.alias}
          getOptionValue={(option) => option._id}
          onChange={companiesHandler}
        />
        <Select
          placeholder="Пользователи"
          closeMenuOnSelect={false}
          isClearable
          isSearchable
          isMulti
          value={users}
          options={userOptions}
          onMenuOpen={ensureLoaded}
          getOptionLabel={(option) =>
            `${option.lastName || ""} ${option.firstName || ""}`.trim()
          }
          getOptionValue={(option) => option._id}
          onChange={usersHandler}
        />
        <Select
          placeholder="Категории"
          closeMenuOnSelect={false}
          isClearable
          isSearchable
          isMulti
          value={categories}
          options={categoryOptions}
          onMenuOpen={ensureLoaded}
          getOptionLabel={(option) => option.title}
          getOptionValue={(option) => option._id}
          onChange={categoriesHandler}
        />
      </Stack>

      {/* Переключатели типов — сужают выдачу; по умолчанию все включены */}
      <Stack direction="horizontal" gap={3} className="flex-wrap">
        {NOTE_TYPES.map((type) => (
          <Form.Check
            key={type.value}
            type="switch"
            id={`note-type-${type.value}`}
            label={<Badge bg={type.badge}>{type.label}</Badge>}
            checked={enabledTypes?.[type.value] ?? true}
            onChange={() => typeToggleHandler(type.value)}
          />
        ))}
      </Stack>

      {/* Просмотр архива — переключает список на архивные заметки */}
      <Form.Check
        type="switch"
        id="kb-show-archived"
        label="Показать архив"
        checked={showArchived}
        onChange={archiveToggleHandler}
      />

      {/* Фильтры модерации — модераторам в активном виде; игнорируют скоуп-фильтры */}
      {isModerator && !showArchived && (
        <Stack direction="horizontal" gap={2} className="flex-wrap">
          {MODERATION_FILTERS.filter(
            (item) => item.mode !== "flagged-secrets" || scanForSecrets,
          ).map((item) => (
            <Button
              key={item.mode}
              size="sm"
              variant={
                moderationMode === item.mode ? "primary" : "outline-secondary"
              }
              onClick={() => toggleModerationMode(item.mode)}
            >
              {item.label}
            </Button>
          ))}
        </Stack>
      )}

      <div className="overflow-auto">
        <ListGroup variant="flush">
          {filteredList.length === 0 && (
            <ListGroup.Item className="text-secondary text-center py-3">
              {isLoading
                ? "Загрузка…"
                : showArchived
                  ? "Архив пуст"
                  : hasFilter
                    ? "Заметки не найдены"
                    : "Введите запрос или выберите фильтр"}
            </ListGroup.Item>
          )}
          {filteredList.map((note) => {
            const approval = getApprovalMeta(note);
            const ApprovalIcon = approval.icon;
            return (
              <ListGroup.Item
                key={note._id}
                action
                as={Link}
                to={`/knowledge-base/${note._id}`}
                active={note._id === activeId}
                className="d-flex align-items-center gap-1"
              >
                <ApprovalIcon
                  className={`text-${approval.bg} flex-shrink-0`}
                  title={approval.label}
                />
                <span className="text-truncate" style={{ minWidth: 0 }}>
                  {note.title}
                </span>
                {showCompanyBadges &&
                  (note.companies || []).map((company) => (
                    <Badge
                      key={company._id}
                      bg="secondary"
                      className="flex-shrink-0"
                    >
                      {company.alias}
                    </Badge>
                  ))}
                {(note.pendingDeletion ||
                  note.pendingArchive ||
                  note.secretsScan?.flagged) && (
                  <span className="ms-auto d-flex align-items-center gap-1 flex-shrink-0">
                    {note.secretsScan?.flagged && (
                      <RiShieldKeyholeLine
                        className="text-danger"
                        title="Найдены секреты"
                      />
                    )}
                    {note.pendingArchive && (
                      <RiArchiveLine
                        className="text-warning"
                        title="Ожидает архивации"
                      />
                    )}
                    {note.pendingDeletion && (
                      <RiDeleteBin6Line
                        className="text-danger"
                        title="На удалении"
                      />
                    )}
                  </span>
                )}
              </ListGroup.Item>
            );
          })}
        </ListGroup>
      </div>
    </Stack>
  );
};

export default KnowledgeBaseSidebar;
