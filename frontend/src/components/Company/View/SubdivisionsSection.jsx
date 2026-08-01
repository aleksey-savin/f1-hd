import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiAddLine,
  RiCollapseVerticalLine,
  RiExpandVerticalLine,
  RiNodeTree,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Eyebrow, Panel } from "@/components/app/Panel";
import SearchBar from "@/components/app/SearchBar";
import ClientTime from "@/components/app/ClientTime";
import { cn } from "@/lib/utils";

import SubdivisionPreviewSheet from "./SubdivisionPreviewSheet";
import SubdivisionFormDialog from "./SubdivisionFormDialog";
import SubdivisionUsersDialog from "./SubdivisionUsersDialog";

// Структура компании: дерево подразделений в панели карточки. Клик по узлу —
// шторка-справка (как предпросмотр в «Расположениях»), правка/состав/удаление —
// диалоги поверх. Данные мутируют fetcher-интенты прежнего action
// (/companies/:id), loader ревалидируется сам — шторка живёт по live-дереву.
const byName = (a, b) =>
  (a.name || "")
    .toLowerCase()
    .localeCompare((b.name || "").toLowerCase(), "ru");

// Поиск узла по id с цепочкой предков (для крошек шторки). null — узла больше
// нет (удалили) — шторка закроется сама.
const findNodeWithPath = (nodes, id, path = []) => {
  for (const node of nodes || []) {
    if (node._id === id) return { node, ancestors: path };
    const found = findNodeWithPath(node.subdivisions, id, [...path, node]);
    if (found) return found;
  }
  return null;
};

const collectParentIds = (nodes, acc = []) => {
  (nodes || []).forEach((node) => {
    if (node.subdivisions?.length) {
      acc.push(node._id);
      collectParentIds(node.subdivisions, acc);
    }
  });
  return acc;
};

// Ветки, чьё имя совпало с запросом или содержащие совпадение: узел-совпадение
// сохраняет всё поддерево, иначе остаётся только путь к совпавшим потомкам.
const filterTree = (nodes, query) => {
  const out = [];
  (nodes || []).forEach((node) => {
    const selfMatch = (node.name || "").toLowerCase().includes(query);
    const matchedKids = filterTree(node.subdivisions, query);
    if (selfMatch || matchedKids.length) {
      out.push({
        ...node,
        subdivisions: selfMatch ? node.subdivisions || [] : matchedKids,
      });
    }
  });
  return out;
};

const flattenTree = (nodes, acc = []) => {
  (nodes || []).forEach((node) => {
    acc.push(node);
    flattenTree(node.subdivisions, acc);
  });
  return acc;
};

const descendantIds = (node, acc = new Set()) => {
  (node?.subdivisions || []).forEach((child) => {
    acc.add(child._id);
    descendantIds(child, acc);
  });
  return acc;
};

// Узел дерева: вложенность — контейнерами с направляющей линией (линейный
// отступ на любой глубине), а не множителем уровня.
const TreeNode = ({ node, isExpanded, onToggle, onOpen, forceExpand }) => {
  const children = [...(node.subdivisions || [])].sort(byName);
  const hasChildren = children.length > 0;
  const expanded = forceExpand || isExpanded(node._id);
  const employeeCount = node.users?.length || 0;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(node)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(node);
          }
        }}
        className="group flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-accent"
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? "Свернуть" : "Развернуть"}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node._id);
            }}
            className="grid size-6 flex-none cursor-pointer appearance-none place-items-center rounded-md border-0 bg-transparent p-0 text-faint hover:bg-border-soft hover:text-foreground"
          >
            {expanded ? (
              <RiArrowDownSLine size={16} />
            ) : (
              <RiArrowRightSLine size={16} />
            )}
          </button>
        ) : (
          <span className="size-6 flex-none" aria-hidden />
        )}
        <span
          className={cn(
            "min-w-0 truncate text-sm font-medium",
            !node.name?.trim() && "text-muted-foreground italic",
          )}
        >
          {node.name?.trim() || "Без названия"}
        </span>
        {employeeCount > 0 && (
          <span
            className="flex-none text-xs text-faint tabular-nums"
            title="Сотрудников в подразделении"
          >
            · {employeeCount}
          </span>
        )}
        {/* В дереве — только расхождение с нашим временем: полный пояс, в том
            числе унаследованный, показывает шторка */}
        <ClientTime
          clientTimezone={node.clientTimezone}
          className="flex-none text-xs"
        />
        <RiArrowRightSLine
          aria-hidden
          className="ml-auto flex-none text-faint opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>

      {hasChildren && expanded && (
        <div className="ml-4 border-l border-border-soft pl-2.5">
          {children.map((child) => (
            <TreeNode
              key={child._id}
              node={child}
              isExpanded={isExpanded}
              onToggle={onToggle}
              onOpen={onOpen}
              forceExpand={forceExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const SubdivisionsSection = ({ company, canManage, id }) => {
  const fetcher = useFetcher();

  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  // Форма (диалог): editNode=null — создание; parentPreset — предзаполненный
  // родитель («Вложенное» из шторки).
  const [formOpen, setFormOpen] = useState(false);
  const [editNode, setEditNode] = useState(null);
  const [parentPreset, setParentPreset] = useState(null);

  const [usersNode, setUsersNode] = useState(null);
  const [deleteNode, setDeleteNode] = useState(null);

  const subdivisions = company.subdivisions || [];
  const total = useMemo(() => flattenTree(subdivisions).length, [subdivisions]);

  const query = searchQuery.trim().toLowerCase();
  const displayTree = query ? filterTree(subdivisions, query) : subdivisions;
  const roots = [...displayTree].sort(byName);

  const isExpanded = (nodeId) => !collapsedIds.has(nodeId);
  const handleToggle = (nodeId) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  const hasCollapsed = collapsedIds.size > 0;
  const expandAll = () => setCollapsedIds(new Set());
  const collapseAll = () =>
    setCollapsedIds(new Set(collectParentIds(subdivisions)));

  // Открытый узел резолвим по live-дереву: правки видны сразу, удаление
  // закрывает шторку.
  const found = selectedId ? findNodeWithPath(subdivisions, selectedId) : null;
  const selectedNode = found?.node || null;
  const selectedAncestors = found?.ancestors || [];

  const openCreate = (parent = null) => {
    setEditNode(null);
    setParentPreset(parent);
    setFormOpen(true);
  };
  const openEdit = (node) => {
    const flat = flattenTree(subdivisions);
    setEditNode(node);
    setParentPreset(flat.find((sub) => sub._id === node.parent) || null);
    setFormOpen(true);
  };

  // Кандидаты в родители: без самого узла и его потомков — цикл невозможен.
  const parentOptions = useMemo(() => {
    const flat = flattenTree(subdivisions);
    if (!editNode) return flat;
    const excluded = descendantIds(editNode);
    excluded.add(editNode._id);
    return flat.filter((sub) => !excluded.has(sub._id));
  }, [subdivisions, editNode]);

  const confirmDelete = () => {
    fetcher.submit(
      {
        intent: "deleteSubdivision",
        subdivisionId: deleteNode._id,
        companyId: company._id,
      },
      { method: "DELETE", action: `/companies/${company._id}` },
    );
    setDeleteNode(null);
  };

  // Успешная мутация закрывает открытые диалоги (ошибки показывают они сами).
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      setFormOpen(false);
      setUsersNode(null);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <>
      <Eyebrow
        id={id}
        count={total}
        action={
          canManage && (
            <Button size="sm" variant="outline" onClick={() => openCreate()}>
              <RiAddLine /> Новое подразделение
            </Button>
          )
        }
      >
        Структура
      </Eyebrow>
      <Panel>
        {total === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-6 text-center">
            <RiNodeTree size={36} aria-hidden className="text-faint" />
            <div className="font-semibold">Подразделений пока нет</div>
            <p className="my-0 text-sm text-muted-foreground">
              Структура помогает раскладывать сотрудников по отделам и филиалам
              — от неё живут фильтры и шторка-справка.
            </p>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="mt-1"
                onClick={() => openCreate()}
              >
                <RiAddLine /> Новое подразделение
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SearchBar
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-64 max-md:w-full"
              />
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

            {roots.length > 0 ? (
              <div className="-mx-1.5">
                {roots.map((node) => (
                  <TreeNode
                    key={node._id}
                    node={node}
                    isExpanded={isExpanded}
                    onToggle={handleToggle}
                    onOpen={(opened) => setSelectedId(opened._id)}
                    forceExpand={Boolean(query)}
                  />
                ))}
              </div>
            ) : (
              <div className="py-2 text-sm text-muted-foreground">
                Ничего не нашлось. Измените запрос.
              </div>
            )}
          </>
        )}
      </Panel>

      <SubdivisionPreviewSheet
        node={selectedNode}
        ancestors={selectedAncestors}
        canManage={canManage}
        onClose={() => setSelectedId(null)}
        onNavigate={(node) => setSelectedId(node._id)}
        onEdit={openEdit}
        onAddChild={(node) => openCreate(node)}
        onManageUsers={(node) => setUsersNode(node)}
        onDelete={(node) => setDeleteNode(node)}
      />

      <SubdivisionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        company={company}
        node={editNode}
        parentPreset={parentPreset}
        parentOptions={parentOptions}
        fetcher={fetcher}
      />

      <SubdivisionUsersDialog
        open={Boolean(usersNode)}
        onOpenChange={(open) => {
          if (!open) setUsersNode(null);
        }}
        node={usersNode}
        company={company}
        fetcher={fetcher}
      />

      <AlertDialog
        open={Boolean(deleteNode)}
        onOpenChange={(open) => {
          if (!open) setDeleteNode(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteNode?.name?.trim() || "Без названия"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Вы уверены? Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel type="button">Отмена</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmDelete}>
              Удалить
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default SubdivisionsSection;
