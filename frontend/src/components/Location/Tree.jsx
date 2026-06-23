import { useState, useMemo, useEffect, useContext } from "react";
import { Link } from "react-router";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Alert from "react-bootstrap/Alert";
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiBuilding2Line,
  RiStackLine,
  RiDoorLine,
  RiComputerLine,
  RiArchiveLine,
  RiUser3Line,
  RiAddLine,
  RiEyeLine,
  RiExpandVerticalLine,
  RiCollapseVerticalLine,
} from "react-icons/ri";

import useOffcanvasStore from "../../store/offcanvas";
import { AuthedUserContext } from "../../store/authed-user-context";
import LocationOffcanvas from "./LocationOffcanvas";

const TYPE_LABEL = {
  building: "Здание",
  floor: "Этаж",
  room: "Помещение",
  workplace: "Рабочее место",
  storage: "Склад",
};

const TYPE_ICON = {
  building: RiBuilding2Line,
  floor: RiStackLine,
  room: RiDoorLine,
  workplace: RiComputerLine,
  storage: RiArchiveLine,
};

const TYPE_ORDER = { building: 0, floor: 1, room: 2, workplace: 3, storage: 4 };
// Типы, внутрь которых можно вложить дочернее расположение.
const CHILD_CAPABLE = ["building", "floor", "room"];

// Лес из плоского списка по parent-рёбрам. Узел, чей родитель отсутствует в
// наборе (отфильтрован / поиск), становится корнем — дерево не ломается.
const buildForest = (items) => {
  const byId = new Map(
    items.map((i) => [String(i._id), { data: i, children: [] }]),
  );
  const roots = [];
  byId.forEach((node) => {
    const pid = node.data.parent?._id || node.data.parent;
    const parent = pid ? byId.get(String(pid)) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const sortNodes = (arr) => {
    arr.sort(
      (a, b) =>
        (TYPE_ORDER[a.data.type] ?? 9) - (TYPE_ORDER[b.data.type] ?? 9) ||
        (a.data.name || "").localeCompare(b.data.name || "", "ru"),
    );
    arr.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return { roots, byId };
};

// Id всех узлов с детьми — для «Свернуть всё».
const collectParentIds = (nodes, acc = []) => {
  nodes.forEach((node) => {
    if (node.children.length) {
      acc.push(node.data._id);
      collectParentIds(node.children, acc);
    }
  });
  return acc;
};

// Действия в строке: добавить дочернее (только для контейнеров) и просмотр —
// открыть детальную панель справа (там же правка/удаление).
const LocationRowActions = ({ data, offcanvasSetShow, onView }) => {
  const companyId = data.company?._id || data.company;
  const canHaveChildren = CHILD_CAPABLE.includes(data.type);

  return (
    <span
      className="ms-auto d-inline-flex gap-1 flex-shrink-0"
      onClick={(event) => event.stopPropagation()}
    >
      {canHaveChildren && (
        <Button
          as={Link}
          to={`add?company=${companyId}&parent=${data._id}`}
          onClick={offcanvasSetShow}
          size="sm"
          variant="outline-secondary"
          title="Добавить дочернее расположение"
          aria-label="Добавить дочернее расположение"
        >
          <RiAddLine />
        </Button>
      )}
      <Button
        size="sm"
        variant="outline-secondary"
        title="Просмотр"
        aria-label="Просмотр"
        onClick={() => onView(data)}
      >
        <RiEyeLine />
      </Button>
    </span>
  );
};

// Один узел дерева. Отступ — одна фиксированная вложенность `.org-tree__children`
// с направляющей линией (линейный отступ на любой глубине), как в SubdivisionTree.
const TreeNode = ({
  node,
  isExpanded,
  onToggle,
  canManage,
  onEditNavigate,
  onView,
}) => {
  const { data, children } = node;
  const hasChildren = children.length > 0;
  const expanded = isExpanded(data._id);
  const Icon = TYPE_ICON[data.type] || RiDoorLine;
  const assignee = data.assignedUser;

  return (
    <div className="org-tree__item">
      <div
        className="org-tree__row"
        style={{ cursor: hasChildren ? "pointer" : "default" }}
        role={hasChildren ? "button" : undefined}
        tabIndex={hasChildren ? 0 : undefined}
        aria-expanded={hasChildren ? expanded : undefined}
        onClick={hasChildren ? () => onToggle(data._id) : undefined}
        onKeyDown={
          hasChildren
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggle(data._id);
                }
              }
            : undefined
        }
      >
        {hasChildren ? (
          <button
            type="button"
            className="org-tree__toggle"
            aria-label={expanded ? "Свернуть" : "Развернуть"}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(data._id);
            }}
          >
            {expanded ? <RiArrowDownSLine /> : <RiArrowRightSLine />}
          </button>
        ) : (
          <span className="org-tree__toggle org-tree__toggle--leaf" aria-hidden />
        )}

        <span className="org-tree__name">{data.name || "Без названия"}</span>

        <span className="org-tree__badge" title="Тип расположения">
          <Icon />
          <span className="org-tree__badge-text">
            {TYPE_LABEL[data.type] || data.type}
          </span>
        </span>

        {assignee && (
          <span className="org-tree__badge" title="Назначенный пользователь">
            <RiUser3Line />
            <span className="org-tree__badge-text">
              {assignee.firstName} {assignee.lastName}
            </span>
          </span>
        )}

        {data.isPublic && (
          <Badge
            bg="success"
            className="flex-shrink-0"
            title="Общедоступное расположение"
          >
            Общедоступно
          </Badge>
        )}

        {hasChildren && (
          <span
            className="org-tree__badge org-tree__badge--count"
            title="Вложенных расположений"
          >
            {children.length}
          </span>
        )}

        {canManage && (
          <LocationRowActions
            data={data}
            offcanvasSetShow={onEditNavigate}
            onView={onView}
          />
        )}
        {!canManage && (
          <Button
            size="sm"
            variant="outline-secondary"
            className="ms-auto flex-shrink-0"
            title="Просмотр"
            aria-label="Просмотр"
            onClick={(event) => {
              event.stopPropagation();
              onView(data);
            }}
          >
            <RiEyeLine />
          </Button>
        )}
      </div>

      {hasChildren && expanded && (
        <div className="org-tree__children">
          {children.map((child) => (
            <TreeNode
              key={child.data._id}
              node={child}
              isExpanded={isExpanded}
              onToggle={onToggle}
              canManage={canManage}
              onEditNavigate={onEditNavigate}
              onView={onView}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Древовидный обозреватель расположений (как структура компании): иерархия
// здание → этаж → помещение → рабочее место с разворачиванием. Просмотр узла —
// детальная панель справа с описанием и действиями.
const Tree = ({ items = [] }) => {
  const { roots, byId } = useMemo(() => buildForest(items), [items]);
  const offcanvas = useOffcanvasStore();
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageClientDevices;

  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [selectedId, setSelectedId] = useState(null);

  const allParentIds = useMemo(() => collectParentIds(roots), [roots]);

  // Если узлы исчезли (поиск/смена компании) — чистим свёрнутые id и выбор.
  useEffect(() => {
    setCollapsedIds((prev) => {
      const valid = new Set(allParentIds);
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [allParentIds]);

  useEffect(() => {
    if (selectedId && !byId.has(String(selectedId))) setSelectedId(null);
  }, [byId, selectedId]);

  const isExpanded = (id) => !collapsedIds.has(id);
  const onToggle = (id) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hasCollapsed = collapsedIds.size > 0;
  const expandAll = () => setCollapsedIds(new Set());
  const collapseAll = () => setCollapsedIds(new Set(allParentIds));

  const selected =
    selectedId && byId.has(String(selectedId))
      ? byId.get(String(selectedId))
      : null;

  // Предки (root → родитель) для хлебных крошек панели.
  const ancestors = useMemo(() => {
    if (!selected) return [];
    const out = [];
    let pid = selected.data.parent?._id || selected.data.parent;
    let guard = 0;
    while (pid && guard < 8) {
      const n = byId.get(String(pid));
      if (!n) break;
      out.unshift(n.data);
      pid = n.data.parent?._id || n.data.parent;
      guard += 1;
    }
    return out;
  }, [selected, byId]);

  const childNodes = selected ? selected.children.map((c) => c.data) : [];

  if (!items.length) {
    return (
      <Alert variant="light" className="mb-0">
        В выбранной компании нет расположений.
      </Alert>
    );
  }

  return (
    <div className="org-structure">
      {allParentIds.length > 0 && (
        <div className="d-flex justify-content-end mb-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={hasCollapsed ? expandAll : collapseAll}
          >
            {hasCollapsed ? (
              <>
                <RiExpandVerticalLine /> Развернуть всё
              </>
            ) : (
              <>
                <RiCollapseVerticalLine /> Свернуть всё
              </>
            )}
          </Button>
        </div>
      )}
      <div className="org-tree-wrap">
        <div className="org-tree">
          {roots.map((node) => (
            <TreeNode
              key={node.data._id}
              node={node}
              isExpanded={isExpanded}
              onToggle={onToggle}
              canManage={canManage}
              onEditNavigate={offcanvas.setShow}
              onView={(loc) => setSelectedId(loc._id)}
            />
          ))}
        </div>
      </div>

      <LocationOffcanvas
        show={Boolean(selected)}
        node={selected?.data || null}
        ancestors={ancestors}
        childNodes={childNodes}
        canManage={canManage}
        onHide={() => setSelectedId(null)}
        onNavigate={(loc) => setSelectedId(loc._id)}
        offcanvasSetShow={offcanvas.setShow}
      />
    </div>
  );
};

export default Tree;
