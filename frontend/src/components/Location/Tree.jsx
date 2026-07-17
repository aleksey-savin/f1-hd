import { useState, useMemo, useEffect, useContext } from "react";
import { Link } from "react-router";

import {
  RiAddFill,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCollapseVerticalLine,
  RiDoorLine,
  RiExpandVerticalLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import useOffcanvasStore from "../../store/offcanvas";
import { AuthedUserContext } from "../../store/authed-user-context";
import { TYPE_LABEL, TYPE_ICON, CHILD_CAPABLE } from "./type-meta";
import { plural } from "../../util/plural";

const TYPE_ORDER = { building: 0, floor: 1, room: 2, workplace: 3, storage: 4 };

// Лес из плоского списка по parent-рёбрам. Узел, чей родитель отсутствует в
// наборе (отфильтрован / поиск / скрытые РМ), становится корнем — дерево не
// ломается.
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
  return roots;
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

// Мета строки: [общедоступное ·] Тип [· N вложенных] [· M устройств].
// Вложенные — реальные (children документа), а не видимые: скрытые фильтром
// рабочие места из счёта не выпадают.
const rowMeta = (data) => {
  const bits = [];
  const childCount = data.children?.length || 0;
  bits.push(TYPE_LABEL[data.type] || data.type);
  if (childCount > 0) {
    bits.push(
      `${childCount} ${plural(childCount, "вложенное", "вложенных", "вложенных")}`,
    );
  }
  if (data.deviceCount > 0) {
    bits.push(
      `${data.deviceCount} ${plural(data.deviceCount, "устройство", "устройства", "устройств")}`,
    );
  }
  return bits.join(" · ");
};

// Один узел дерева: клик по строке — предпросмотр (шторка справа), шеврон —
// развернуть/свернуть, «+» у контейнеров — добавить вложенное.
const TreeNode = ({ node, depth, isExpanded, onToggle, onSelect, selectedId, canManage }) => {
  const offcanvas = useOffcanvasStore();
  const { data, children } = node;
  const hasChildren = children.length > 0;
  const expanded = isExpanded(data._id);
  const Icon = TYPE_ICON[data.type] || RiDoorLine;
  const selected = String(selectedId || "") === String(data._id);
  const companyId = data.company?._id || data.company;
  const canHaveChildren = CHILD_CAPABLE.includes(data.type);
  const meta = rowMeta(data);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(data)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(data);
          }
        }}
        className={cn(
          "tw:group tw:flex tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-lg tw:px-2.5 tw:py-2 tw:transition-colors",
          selected ? "tw:bg-primary/10" : "tw:hover:bg-accent",
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? "Свернуть" : "Развернуть"}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(data._id);
            }}
            className="tw:grid tw:size-6 tw:flex-none tw:cursor-pointer tw:appearance-none tw:place-items-center tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:text-faint tw:hover:bg-accent tw:hover:text-foreground"
          >
            {expanded ? <RiArrowDownSLine /> : <RiArrowRightSLine />}
          </button>
        ) : (
          <span aria-hidden className="tw:size-6 tw:flex-none" />
        )}

        <Icon size={16} aria-hidden className="tw:flex-none tw:text-muted-foreground" />

        <div className="tw:min-w-0 tw:flex-1">
          <div
            className={cn(
              "tw:truncate tw:text-[15px] tw:font-medium",
              selected && "tw:text-accent-text",
            )}
          >
            {data.name || "Без названия"}
          </div>
          {/* На узких экранах мета — второй строкой под названием */}
          {meta && (
            <div className="tw:truncate tw:text-sm tw:text-muted-foreground tw:tabular-nums tw:sm:hidden">
              {data.isPublic && (
                <span className="tw:font-medium tw:text-accent-text">
                  общедоступное ·{" "}
                </span>
              )}
              {meta}
            </div>
          )}
        </div>

        <span className="tw:flex-none tw:text-sm tw:text-muted-foreground tw:tabular-nums tw:max-sm:hidden">
          {data.isPublic && (
            <span className="tw:font-medium tw:text-accent-text">
              общедоступное ·{" "}
            </span>
          )}
          {meta}
        </span>

        {canManage && canHaveChildren && (
          <Button
            asChild
            variant="outline"
            size="icon-sm"
            title="Добавить вложенное расположение"
            aria-label="Добавить вложенное расположение"
            className="tw:flex-none tw:opacity-0 tw:group-hover:opacity-100 tw:focus-visible:opacity-100 tw:pointer-coarse:opacity-100"
            onClick={(event) => event.stopPropagation()}
          >
            <Link
              to={`add?company=${companyId}&parent=${data._id}`}
              onClick={offcanvas.setShow}
            >
              <RiAddFill />
            </Link>
          </Button>
        )}
      </div>

      {hasChildren && expanded && (
        <div className="tw:ml-5 tw:border-l tw:border-border-soft tw:pl-3">
          {children.map((child) => (
            <TreeNode
              key={child.data._id}
              node={child}
              depth={depth + 1}
              isExpanded={isExpanded}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedId={selectedId}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Древовидный обозреватель расположений: иерархия здание → этаж → помещение →
// рабочее место. Клик по строке — предпросмотр в шторке справа (onSelect),
// разворачивание — только шевроном.
const Tree = ({ items = [], selectedId = null, onSelect }) => {
  const roots = useMemo(() => buildForest(items), [items]);
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageClientDevices;

  const [collapsedIds, setCollapsedIds] = useState(() => new Set());

  const allParentIds = useMemo(() => collectParentIds(roots), [roots]);

  // Если узлы исчезли (поиск/смена компании) — чистим свёрнутые id.
  useEffect(() => {
    setCollapsedIds((prev) => {
      const valid = new Set(allParentIds);
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [allParentIds]);

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

  return (
    <>
      {allParentIds.length > 0 && (
        <div className="tw:mb-2 tw:flex tw:justify-end">
          <Button
            variant="ghost"
            size="sm"
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
      <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-2">
        {roots.map((node) => (
          <TreeNode
            key={node.data._id}
            node={node}
            depth={0}
            isExpanded={isExpanded}
            onToggle={onToggle}
            onSelect={onSelect}
            selectedId={selectedId}
            canManage={canManage}
          />
        ))}
      </div>
    </>
  );
};

export default Tree;
