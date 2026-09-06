import { Link } from "react-router";

import {
  RiAddFill,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiDoorLine,
  RiEdit2Line,
} from "react-icons/ri";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { TYPE_LABEL, TYPE_ICON, CHILD_CAPABLE } from "./type-meta";
import { plural } from "../../util/plural";

const dash = <span className="text-faint">—</span>;

// Микро-подпись + значение (компактный вариант Detail карточки).
const Info = ({ label, children }) => (
  <div className="min-w-0">
    <div className="mb-0.5 text-xs font-semibold tracking-wide text-faint uppercase">
      {label}
    </div>
    <div className="text-sm leading-relaxed break-words">
      {children || dash}
    </div>
  </div>
);

// Шторка предпросмотра расположения (справа): крошки предков и вложенные —
// навигация не выходя из списка; главное действие — «Открыть карточку».
const PreviewSheet = ({
  node,
  ancestors = [],
  childNodes = [],
  canManage,
  onClose,
  onNavigate,
  onDelete,
}) => {
  const TypeIcon = node ? TYPE_ICON[node.type] || RiDoorLine : RiDoorLine;
  const companyId = node?.company?._id || node?.company;
  const canHaveChildren = CHILD_CAPABLE.includes(node?.type);
  const assignee = node?.assignedUser;
  const subdivisions = node?.subdivisions || [];
  const childCount = node?.children?.length || 0;
  const deviceCount = node?.deviceCount || 0;
  const isActive = node?.isActive !== false;

  return (
    <Sheet
      open={Boolean(node)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-11/12 max-w-md">
        {node && (
          <>
            <div className="px-5 pt-4">
              {ancestors.length > 0 && (
                <nav className="mb-2.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 pr-8 text-sm font-medium text-muted-foreground">
                  {ancestors.map((crumb, index) => (
                    <span
                      key={crumb._id}
                      className="inline-flex items-center gap-1"
                    >
                      {index > 0 && (
                        <span aria-hidden className="mx-0.5 text-faint">
                          ›
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onNavigate(crumb)}
                        className="cursor-pointer appearance-none border-0 bg-transparent p-0 font-medium text-inherit hover:text-foreground"
                      >
                        {crumb.name?.trim() || "Без названия"}
                      </button>
                    </span>
                  ))}
                </nav>
              )}
              <div className="flex items-center gap-3 pr-8">
                <span
                  aria-hidden
                  className="grid size-10 flex-none place-items-center rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border"
                >
                  <TypeIcon size={20} />
                </span>
                <SheetTitle className="my-0 text-lg leading-snug font-semibold tracking-tight break-words">
                  {node.name || "Без названия"}
                </SheetTitle>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 font-semibold",
                    isActive ? "text-accent-text" : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      isActive
                        ? "bg-primary ring-3 ring-primary/20"
                        : "bg-faint",
                    )}
                  />
                  {isActive ? "Активно" : "Отключено"}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  <span className="text-faint">·</span>{" "}
                  {TYPE_LABEL[node.type] || node.type}
                  {node.isPublic && (
                    <>
                      {" "}
                      <span className="text-faint">·</span>{" "}
                      <span className="font-medium text-accent-text">
                        общедоступное
                      </span>
                    </>
                  )}{" "}
                  <span className="text-faint">·</span>{" "}
                  <b className="font-semibold text-foreground">{childCount}</b>{" "}
                  {plural(childCount, "вложенное", "вложенных", "вложенных")}{" "}
                  <span className="text-faint">·</span>{" "}
                  <b className="font-semibold text-foreground">{deviceCount}</b>{" "}
                  {plural(deviceCount, "устройство", "устройства", "устройств")}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pt-3.5 pb-4">
              <div className="grid gap-3">
                <Info label="Компания">
                  {node.company?.alias || node.company?.fullTitle}
                </Info>
                <Info label="Подразделения">
                  {subdivisions.length > 0 ? (
                    <span className="flex flex-wrap gap-1.5">
                      {subdivisions.map((subdivision) => (
                        <span
                          key={subdivision._id}
                          className="inline-flex items-center rounded-full border border-border-soft bg-accent px-2 py-0.5 text-sm font-medium"
                        >
                          {subdivision.name}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </Info>
                {node.type === "workplace" && (
                  <Info label="Сотрудник">
                    {assignee
                      ? [assignee.firstName, assignee.lastName]
                          .filter(Boolean)
                          .join(" ")
                      : null}
                  </Info>
                )}
                <Info label="Адрес">{node.address}</Info>
                {node.description && (
                  <Info label="Описание">
                    <span className="whitespace-pre-wrap">
                      {node.description}
                    </span>
                  </Info>
                )}
              </div>

              <div className="mt-4 mb-1 text-xs font-bold tracking-wider text-faint uppercase">
                Вложенные · {childNodes.length}
              </div>
              {childNodes.length > 0 ? (
                <div className="-mx-2.5">
                  {childNodes.map((child) => {
                    const ChildIcon = TYPE_ICON[child.type] || RiDoorLine;
                    return (
                      <button
                        key={child._id}
                        type="button"
                        onClick={() => onNavigate(child)}
                        className="flex w-full cursor-pointer appearance-none items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-sm font-medium text-inherit hover:bg-accent"
                      >
                        <ChildIcon
                          size={15}
                          aria-hidden
                          className="flex-none text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {child.name?.trim() || "Без названия"}
                        </span>
                        {child.deviceCount > 0 && (
                          <span className="flex-none text-xs font-normal text-muted-foreground tabular-nums">
                            {child.deviceCount} устр.
                          </span>
                        )}
                        <RiArrowRightSLine
                          aria-hidden
                          className="flex-none text-faint"
                        />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Нет вложенных расположений
                </div>
              )}
            </div>

            <div className="grid gap-2 border-t border-border-soft px-5 py-3.5">
              <Button asChild>
                <Link to={`/inventory/locations/${node._id}`} onClick={onClose}>
                  Открыть карточку <RiArrowRightSLine />
                </Link>
              </Button>
              {canManage && (
                <>
                  {/* Формы открываются в нижней шторке списка — предпросмотр
                      закрываем (onClose), чтобы оверлеи не накладывались */}
                  <div className="flex gap-2">
                    {canHaveChildren && (
                      <Button asChild variant="outline" className="flex-1">
                        <Link
                          to={`add?company=${companyId}&parent=${node._id}`}
                          onClick={onClose}
                        >
                          <RiAddFill /> Вложенное
                        </Link>
                      </Button>
                    )}
                    <Button asChild variant="outline" className="flex-1">
                      <Link to={`update/${node._id}`} onClick={onClose}>
                        <RiEdit2Line /> Изменить
                      </Link>
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(node)}
                  >
                    <RiDeleteBinLine /> Удалить расположение
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default PreviewSheet;
