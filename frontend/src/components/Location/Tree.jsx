import { useState, useMemo, useEffect } from "react";
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
import { TYPE_LABEL, TYPE_ICON, CHILD_CAPABLE } from "./type-meta";
import { plural } from "../../util/plural";
import { useCan } from "@/store/authed-user";

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
const TreeNode = ({
  node,
  depth,
  isExpanded,
  onToggle,
  onSelect,
  selectedId,
  canManage,
}) => {
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
          "group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition-colors",
          selected ? "bg-primary/10" : "hover:bg-accent",
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
            className="grid size-6 flex-none cursor-pointer appearance-none place-items-center rounded-md border-0 bg-transparent p-0 text-faint hover:bg-accent hover:text-foreground"
          >
            {expanded ? <RiArrowDownSLine /> : <RiArrowRightSLine />}
          </button>
        ) : (
          <span aria-hidden className="size-6 flex-none" />
        )}

        <Icon
          size={16}
          aria-hidden
          className="flex-none text-muted-foreground"
        />

        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "truncate text-[15px] font-medium",
              selected && "text-accent-text",
            )}
          >
            {data.name || "Без названия"}
          </div>
          {/* На узких экранах мета — второй строкой под названием */}
          {meta && (
            <div className="truncate text-sm text-muted-foreground tabular-nums sm:hidden">
              {data.isPublic && (
                <span className="font-medium text-accent-text">
                  общедоступное ·{" "}
                </span>
              )}
              {meta}
            </div>
          )}
        </div>

        <span className="flex-none text-sm text-muted-foreground tabular-nums max-sm:hidden">
          {data.isPublic && (
            <span className="font-medium text-accent-text">
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
            title="Новое вложенное расположение"
            aria-label="Новое вложенное расположение"
            className="flex-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
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
        <div className="ml-5 border-l border-border-soft pl-3">
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
  const can = useCan();
  const canManage = can({ device: ["manage"] });

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
        <div className="mb-2 flex justify-end">
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
      <div className="rounded-xl border border-border bg-card p-2">
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
