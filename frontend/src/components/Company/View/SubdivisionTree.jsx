import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiUser3Line,
  RiUserStarLine,
} from "react-icons/ri";

// Sort siblings alphabetically (Russian locale), tolerant of empty names.
const byName = (a, b) =>
  (a.name || "")
    .toLowerCase()
    .localeCompare((b.name || "").toLowerCase(), "ru");

// One node of the org tree.
//
// Indentation is intentionally NOT computed from a `level` multiplier. Each
// `.org-tree__children` wrapper adds a single fixed indent (+ a guide line) in
// CSS, so nesting in the DOM yields a *linear* indent at any depth. The old
// implementation set `marginLeft: level * 20` on wrappers nested inside one
// another, which compounded into a quadratic indent that pushed deep rows off
// to the right.
const SubdivisionTreeNode = ({
  node,
  selectedId,
  onSelect,
  isExpanded,
  onToggle,
  forceExpand,
}) => {
  const children = [...(node.subdivisions || [])].sort(byName);
  const hasChildren = children.length > 0;
  const expanded = forceExpand || isExpanded(node._id);
  const isSelected = node._id === selectedId;

  const hasName = Boolean(node.name && node.name.trim());
  const employeeCount = node.users?.length || 0;

  return (
    <div className="org-tree__item">
      <div
        className={`org-tree__row${isSelected ? " org-tree__row--selected" : ""}`}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        onClick={() => onSelect(node)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(node);
          }
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="org-tree__toggle"
            aria-label={expanded ? "Свернуть" : "Развернуть"}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node._id);
            }}
          >
            {expanded ? <RiArrowDownSLine /> : <RiArrowRightSLine />}
          </button>
        ) : (
          <span
            className="org-tree__toggle org-tree__toggle--leaf"
            aria-hidden
          />
        )}

        <span
          className={`org-tree__name${hasName ? "" : " org-tree__name--empty"}`}
        >
          {hasName ? node.name : "Без названия"}
        </span>

        {node.manager && (
          <span
            className="org-tree__badge org-tree__badge--manager"
            title="Руководитель"
          >
            <RiUserStarLine />
            <span className="org-tree__badge-text">
              {node.manager.firstName} {node.manager.lastName}
            </span>
          </span>
        )}

        {employeeCount > 0 && (
          <span
            className="org-tree__badge org-tree__badge--count"
            title="Сотрудников в подразделении"
          >
            <RiUser3Line />
            {employeeCount}
          </span>
        )}

        <RiArrowRightSLine className="org-tree__open-hint" aria-hidden />
      </div>

      {hasChildren && expanded && (
        <div className="org-tree__children">
          {children.map((child) => (
            <SubdivisionTreeNode
              key={child._id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              isExpanded={isExpanded}
              onToggle={onToggle}
              forceExpand={forceExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const SubdivisionTree = ({
  nodes,
  selectedId,
  onSelect,
  isExpanded,
  onToggle,
  forceExpand = false,
}) => {
  const roots = [...(nodes || [])].sort(byName);

  return (
    <div className="org-tree">
      {roots.map((node) => (
        <SubdivisionTreeNode
          key={node._id}
          node={node}
          selectedId={selectedId}
          onSelect={onSelect}
          isExpanded={isExpanded}
          onToggle={onToggle}
          forceExpand={forceExpand}
        />
      ))}
    </div>
  );
};

export default SubdivisionTree;
