import { useState } from "react";
import {
  RiArrowDownSLine,
  RiArrowRightLine,
  RiUser3Line,
  RiUserStarLine,
  RiEdit2Line,
  RiDeleteBin6Line,
} from "react-icons/ri";
import Badge from "react-bootstrap/Badge";

const TreeNode = ({
  node,
  level = 0,
  onEdit,
  onDelete,
  onManageUsers,
  canManage,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  const hasChildren = node.subdivisions && node.subdivisions.length > 0;

  const sortedSubdivisions = [...(node.subdivisions || [])].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );

  return (
    <div style={{ marginLeft: `${level * 20}px` }}>
      <div
        className={`d-flex align-items-center py-2 px-2 rounded ${isHovered ? "bg-light" : ""}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          transition: "all 0.2s ease",
          border: "1px solid transparent",
          borderColor: isHovered ? "#dee2e6" : "transparent",
        }}
      >
        {hasChildren && (
          <button
            className="btn btn-link btn-sm p-0 me-1"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <RiArrowDownSLine size={18} />
            ) : (
              <RiArrowRightLine size={18} />
            )}
          </button>
        )}
        {!hasChildren && <span className="ms-3"></span>}
        <div
          className="flex-grow-1"
          onClick={() => hasChildren && setIsExpanded(!isExpanded)}
          style={{
            cursor: hasChildren ? "pointer" : "default",
            fontSize: "1.1rem", // Increased font size
            fontWeight: hasChildren ? "500" : "normal",
          }}
        >
          {node.name}

          {node.manager && (
            <Badge
              bg="primary"
              className="ms-2 p-2"
              style={{ fontSize: "0.9rem" }}
            >
              <RiUserStarLine size={16} className="me-1" />
              {node.manager.firstName} {node.manager.lastName}
            </Badge>
          )}
          {node.users?.length > 0 && (
            <Badge
              bg="secondary"
              className="ms-2 p-2"
              style={{ fontSize: "0.9rem" }}
            >
              <RiUser3Line size={16} className="me-1" /> {node.users.length}
            </Badge>
          )}
        </div>
        {canManage && (
          <div
            className={`action-buttons ${isHovered ? "visible" : "invisible"}`}
          >
            <button
              className="btn btn-link btn-sm text-primary"
              onClick={() => onManageUsers(node)}
              title="Manage Users"
            >
              <RiUser3Line size={20} />
            </button>
            <button
              className="btn btn-link btn-sm text-primary"
              onClick={() => onEdit(node)}
              title="Edit"
            >
              <RiEdit2Line size={20} />
            </button>
            <button
              className="btn btn-link btn-sm text-danger"
              onClick={() => onDelete(node._id)}
              title="Delete"
            >
              <RiDeleteBin6Line size={20} />
            </button>
          </div>
        )}
      </div>
      {hasChildren && isExpanded && (
        <div>
          {sortedSubdivisions.map((child) => (
            <TreeNode
              key={child._id}
              node={child}
              level={level + 1}
              onEdit={onEdit}
              onDelete={onDelete}
              onManageUsers={onManageUsers}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TreeNode;
