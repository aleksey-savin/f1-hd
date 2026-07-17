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

import useOffcanvasStore from "../../store/offcanvas";
import { TYPE_LABEL, TYPE_ICON, CHILD_CAPABLE } from "./type-meta";
import { plural } from "../../util/plural";

const dash = <span className="tw:text-faint">—</span>;

// Микро-подпись + значение (компактный вариант Detail карточки).
const Info = ({ label, children }) => (
  <div className="tw:min-w-0">
    <div className="tw:mb-0.5 tw:text-[11px] tw:font-semibold tw:tracking-wide tw:text-faint tw:uppercase">
      {label}
    </div>
    <div className="tw:text-sm tw:leading-relaxed tw:break-words">
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
  const offcanvas = useOffcanvasStore();

  const TypeIcon = node ? TYPE_ICON[node.type] || RiDoorLine : RiDoorLine;
  const companyId = node?.company?._id || node?.company;
  const canHaveChildren = CHILD_CAPABLE.includes(node?.type);
  const assignee = node?.assignedUser;
  const subdivisions = node?.subdivisions || [];
  const childCount = node?.children?.length || 0;
  const deviceCount = node?.deviceCount || 0;
  const isActive = node?.isActive !== false;

  // Формы открываются в нижней шторке списка — предпросмотр закрываем,
  // чтобы оверлеи не накладывались.
  const openFormAndClose = () => {
    offcanvas.setShow();
    onClose();
  };

  return (
    <Sheet
      open={Boolean(node)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="tw:w-11/12 tw:max-w-md">
        {node && (
          <>
            <div className="tw:px-5 tw:pt-4">
              {ancestors.length > 0 && (
                <nav className="tw:mb-2.5 tw:flex tw:flex-wrap tw:items-center tw:gap-x-1 tw:gap-y-0.5 tw:pr-8 tw:text-[13px] tw:font-medium tw:text-muted-foreground">
                  {ancestors.map((crumb, index) => (
                    <span
                      key={crumb._id}
                      className="tw:inline-flex tw:items-center tw:gap-1"
                    >
                      {index > 0 && (
                        <span aria-hidden className="tw:mx-0.5 tw:text-faint">
                          ›
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onNavigate(crumb)}
                        className="tw:cursor-pointer tw:appearance-none tw:border-0 tw:bg-transparent tw:p-0 tw:font-medium tw:text-inherit tw:hover:text-foreground"
                      >
                        {crumb.name?.trim() || "Без названия"}
                      </button>
                    </span>
                  ))}
                </nav>
              )}
              <div className="tw:flex tw:items-center tw:gap-3 tw:pr-8">
                <span
                  aria-hidden
                  className="tw:grid tw:size-10 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border"
                >
                  <TypeIcon size={20} />
                </span>
                <SheetTitle className="tw:my-0 tw:text-lg tw:leading-snug tw:font-semibold tw:tracking-tight tw:break-words">
                  {node.name || "Без названия"}
                </SheetTitle>
              </div>
              <div className="tw:mt-2.5 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2.5 tw:gap-y-1 tw:text-[13px]">
                <span
                  className={cn(
                    "tw:inline-flex tw:items-center tw:gap-1.5 tw:font-semibold",
                    isActive
                      ? "tw:text-accent-text"
                      : "tw:text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "tw:size-1.5 tw:rounded-full",
                      isActive
                        ? "tw:bg-primary tw:ring-3 tw:ring-primary/20"
                        : "tw:bg-faint",
                    )}
                  />
                  {isActive ? "Активно" : "Отключено"}
                </span>
                <span className="tw:text-muted-foreground tw:tabular-nums">
                  <span className="tw:text-faint">·</span>{" "}
                  {TYPE_LABEL[node.type] || node.type}
                  {node.isPublic && (
                    <>
                      {" "}
                      <span className="tw:text-faint">·</span>{" "}
                      <span className="tw:font-medium tw:text-accent-text">
                        общедоступное
                      </span>
                    </>
                  )}{" "}
                  <span className="tw:text-faint">·</span>{" "}
                  <b className="tw:font-semibold tw:text-foreground">
                    {childCount}
                  </b>{" "}
                  {plural(childCount, "вложенное", "вложенных", "вложенных")}{" "}
                  <span className="tw:text-faint">·</span>{" "}
                  <b className="tw:font-semibold tw:text-foreground">
                    {deviceCount}
                  </b>{" "}
                  {plural(deviceCount, "устройство", "устройства", "устройств")}
                </span>
              </div>
            </div>

            <div className="tw:flex-1 tw:overflow-y-auto tw:px-5 tw:pt-3.5 tw:pb-4">
              <div className="tw:grid tw:gap-3">
                <Info label="Компания">
                  {node.company?.alias || node.company?.fullTitle}
                </Info>
                <Info label="Подразделения">
                  {subdivisions.length > 0 ? (
                    <span className="tw:flex tw:flex-wrap tw:gap-1.5">
                      {subdivisions.map((subdivision) => (
                        <span
                          key={subdivision._id}
                          className="tw:inline-flex tw:items-center tw:rounded-full tw:border tw:border-border-soft tw:bg-accent tw:px-2 tw:py-0.5 tw:text-[13px] tw:font-medium"
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
                    <span className="tw:whitespace-pre-wrap">
                      {node.description}
                    </span>
                  </Info>
                )}
              </div>

              <div className="tw:mt-4 tw:mb-1 tw:text-[11px] tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
                Вложенные · {childNodes.length}
              </div>
              {childNodes.length > 0 ? (
                <div className="tw:-mx-2.5">
                  {childNodes.map((child) => {
                    const ChildIcon = TYPE_ICON[child.type] || RiDoorLine;
                    return (
                      <button
                        key={child._id}
                        type="button"
                        onClick={() => onNavigate(child)}
                        className="tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2.5 tw:rounded-lg tw:border-0 tw:bg-transparent tw:px-2.5 tw:py-2 tw:text-left tw:text-sm tw:font-medium tw:text-inherit tw:hover:bg-accent"
                      >
                        <ChildIcon
                          size={15}
                          aria-hidden
                          className="tw:flex-none tw:text-muted-foreground"
                        />
                        <span className="tw:min-w-0 tw:flex-1 tw:truncate">
                          {child.name?.trim() || "Без названия"}
                        </span>
                        {child.deviceCount > 0 && (
                          <span className="tw:flex-none tw:text-[12.5px] tw:font-normal tw:text-muted-foreground tw:tabular-nums">
                            {child.deviceCount} устр.
                          </span>
                        )}
                        <RiArrowRightSLine
                          aria-hidden
                          className="tw:flex-none tw:text-faint"
                        />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="tw:text-sm tw:text-muted-foreground">
                  Нет вложенных расположений
                </div>
              )}
            </div>

            <div className="tw:grid tw:gap-2 tw:border-t tw:border-border-soft tw:px-5 tw:py-3.5">
              <Button asChild>
                <Link to={`/inventory/locations/${node._id}`} onClick={onClose}>
                  Открыть карточку <RiArrowRightSLine />
                </Link>
              </Button>
              {canManage && (
                <>
                  <div className="tw:flex tw:gap-2">
                    {canHaveChildren && (
                      <Button asChild variant="outline" className="tw:flex-1">
                        <Link
                          to={`add?company=${companyId}&parent=${node._id}`}
                          onClick={openFormAndClose}
                        >
                          <RiAddFill /> Вложенное
                        </Link>
                      </Button>
                    )}
                    <Button asChild variant="outline" className="tw:flex-1">
                      <Link
                        to={`update/${node._id}`}
                        onClick={openFormAndClose}
                      >
                        <RiEdit2Line /> Изменить
                      </Link>
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    className="tw:text-destructive tw:hover:text-destructive"
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
