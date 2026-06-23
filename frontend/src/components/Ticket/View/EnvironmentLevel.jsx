import {
  RiBuilding2Line,
  RiStackLine,
  RiDoorLine,
  RiComputerLine,
  RiArchiveLine,
} from "react-icons/ri";

import EnvironmentDeviceCard from "./EnvironmentDeviceCard";

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

// Один уровень иерархии: шапка (тип/имя/подразделение), вложенные пространства
// (кликабельны все — переход внутрь; ветка заявителя подсвечена «здесь») и
// техника, закреплённая непосредственно за этим уровнем (в т.ч. общая — напр.
// МФУ помещения, которым пользуется весь отдел).
const EnvironmentLevel = ({ node, chainIds, onSelectChild, onSelectDevice }) => {
  const Icon = TYPE_ICON[node.type] || RiDoorLine;
  const children = node.children || [];
  const devices = node.devices || [];

  return (
    <div className="env-frame">
      <div className="env-frame__header">
        <span className="env-frame__icon">
          <Icon />
        </span>
        <div className="min-w-0">
          <div className="env-frame__eyebrow">
            {TYPE_LABEL[node.type] || node.type}
          </div>
          <div className="env-frame__name">{node.name}</div>
          {node.subdivisionName && (
            <div className="env-frame__sub">{node.subdivisionName}</div>
          )}
        </div>
      </div>

      {children.length > 0 && (
        <div className="env-section">
          <div className="env-section__label">Внутри · {children.length}</div>
          <div className="env-children">
            {children.map((child) => {
              const isCurrent = chainIds?.has(String(child._id));
              return (
                <button
                  key={child._id}
                  type="button"
                  className={`env-cell${isCurrent ? " is-current" : ""}`}
                  onClick={() => onSelectChild(child)}
                  title={`Открыть: ${child.name}`}
                >
                  {isCurrent && <span className="env-cell__here">здесь</span>}
                  <span className="env-cell__name">{child.name}</span>
                  <span className="env-cell__meta">
                    {TYPE_LABEL[child.type] || child.type} · {child.deviceCount}{" "}
                    техн.
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="env-section">
        <div className="env-section__label">
          Техника на этом уровне{devices.length ? ` · ${devices.length}` : ""}
        </div>
        {devices.length > 0 ? (
          <div className="env-devices">
            {devices.map((device) => (
              <EnvironmentDeviceCard
                key={device._id}
                device={device}
                onSelect={onSelectDevice}
              />
            ))}
          </div>
        ) : (
          <div className="env-empty">Здесь нет закреплённой техники.</div>
        )}
      </div>
    </div>
  );
};

export default EnvironmentLevel;
