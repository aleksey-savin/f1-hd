import { Link } from "react-router";
import {
  RiAddFill,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiGroupLine,
  RiNodeTree,
} from "react-icons/ri";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import ClientTime from "@/components/app/ClientTime";
import { plural } from "../../../util/plural";

const dash = <span className="tw:text-faint">—</span>;

// Микро-подпись + значение (тот же идиом, что в превью расположений).
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

const userLinkClass =
  "tw:font-medium tw:text-inherit tw:no-underline tw:hover:text-foreground tw:hover:underline";

// Шторка-справка подразделения (справа): крошки предков, контакты, состав и
// вложенные — навигация не выходя с карточки компании; правка и состав —
// диалогами поверх шторки.
const SubdivisionPreviewSheet = ({
  node,
  ancestors = [],
  canManage,
  onClose,
  onNavigate,
  onEdit,
  onAddChild,
  onManageUsers,
  onDelete,
}) => {
  const employees = [...(node?.users || [])].sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(
      `${b.lastName} ${b.firstName}`,
      "ru",
    ),
  );
  const children = [...(node?.subdivisions || [])].sort((a, b) =>
    (a.name || "")
      .toLowerCase()
      .localeCompare((b.name || "").toLowerCase(), "ru"),
  );

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
                  <RiNodeTree size={20} />
                </span>
                <SheetTitle className="tw:my-0 tw:text-lg tw:leading-snug tw:font-semibold tw:tracking-tight tw:break-words">
                  {node.name?.trim() || "Без названия"}
                </SheetTitle>
              </div>
              <div className="tw:mt-2 tw:text-[13px] tw:text-muted-foreground tw:tabular-nums">
                <b className="tw:font-semibold tw:text-foreground">
                  {employees.length}
                </b>{" "}
                {plural(employees.length, "сотрудник", "сотрудника", "сотрудников")}{" "}
                <span className="tw:text-faint">·</span>{" "}
                <b className="tw:font-semibold tw:text-foreground">
                  {children.length}
                </b>{" "}
                {plural(children.length, "вложенное", "вложенных", "вложенных")}
              </div>
            </div>

            <div className="tw:flex-1 tw:overflow-y-auto tw:px-5 tw:pt-3.5 tw:pb-4">
              <div className="tw:grid tw:gap-3">
                <Info label="Руководитель">
                  {node.manager ? (
                    <>
                      <Link
                        to={`/users/${node.manager._id}`}
                        onClick={onClose}
                        className={userLinkClass}
                      >
                        {node.manager.lastName} {node.manager.firstName}
                      </Link>
                      {node.manager.position && (
                        <span className="tw:text-muted-foreground">
                          {" "}
                          · {node.manager.position}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="tw:text-muted-foreground">Не назначен</span>
                  )}
                </Info>
                <Info label="Email">
                  {node.email ? (
                    <a
                      href={`mailto:${node.email}`}
                      className="tw:text-accent-text tw:no-underline tw:hover:underline"
                    >
                      {node.email}
                    </a>
                  ) : null}
                </Info>
                <Info label="Телефон">
                  {node.phone ? (
                    <a
                      href={`tel:${node.phone}`}
                      className="tw:text-accent-text tw:no-underline tw:tabular-nums tw:hover:underline"
                    >
                      {node.phone}
                    </a>
                  ) : null}
                </Info>
                <Info label="Часовой пояс">
                  {node.clientTimezone ? (
                    <>
                      <ClientTime clientTimezone={node.clientTimezone} always />
                      {!node.timezone && (
                        <span className="tw:text-muted-foreground">
                          {" · "}
                          {node.clientTimezone.source === "subdivision"
                            ? `наследует от «${node.clientTimezone.sourceName}»`
                            : node.clientTimezone.source === "company"
                              ? "как у компании"
                              : "как в организации"}
                        </span>
                      )}
                    </>
                  ) : null}
                </Info>
                <Info label="Адрес">
                  {node.address ? (
                    node.linkToMap ? (
                      <a
                        href={node.linkToMap}
                        target="_blank"
                        rel="noreferrer"
                        className="tw:text-accent-text tw:no-underline tw:hover:underline"
                      >
                        {node.address}
                      </a>
                    ) : (
                      node.address
                    )
                  ) : null}
                </Info>
              </div>

              <div className="tw:mt-4 tw:mb-1 tw:flex tw:items-center tw:gap-1.5 tw:text-[11px] tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
                <RiGroupLine aria-hidden /> Сотрудники · {employees.length}
              </div>
              {employees.length > 0 ? (
                <div className="tw:grid tw:gap-1">
                  {employees.map((user) => (
                    <div key={user._id} className="tw:text-sm">
                      <Link
                        to={`/users/${user._id}`}
                        onClick={onClose}
                        className={userLinkClass}
                      >
                        {user.lastName} {user.firstName}
                      </Link>
                      {user.position && (
                        <span className="tw:text-muted-foreground">
                          {" "}
                          · {user.position}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="tw:text-sm tw:text-muted-foreground">
                  Нет сотрудников
                </div>
              )}

              <div className="tw:mt-4 tw:mb-1 tw:flex tw:items-center tw:gap-1.5 tw:text-[11px] tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
                <RiNodeTree aria-hidden /> Вложенные · {children.length}
              </div>
              {children.length > 0 ? (
                <div className="tw:-mx-2.5">
                  {children.map((child) => (
                    <button
                      key={child._id}
                      type="button"
                      onClick={() => onNavigate(child)}
                      className="tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2.5 tw:rounded-lg tw:border-0 tw:bg-transparent tw:px-2.5 tw:py-2 tw:text-left tw:text-sm tw:font-medium tw:text-inherit tw:hover:bg-accent"
                    >
                      <RiNodeTree
                        size={15}
                        aria-hidden
                        className="tw:flex-none tw:text-muted-foreground"
                      />
                      <span className="tw:min-w-0 tw:flex-1 tw:truncate">
                        {child.name?.trim() || "Без названия"}
                      </span>
                      {child.users?.length > 0 && (
                        <span className="tw:flex-none tw:text-[12.5px] tw:font-normal tw:text-muted-foreground tw:tabular-nums">
                          {child.users.length}{" "}
                          {plural(child.users.length, "чел.", "чел.", "чел.")}
                        </span>
                      )}
                      <RiArrowRightSLine
                        aria-hidden
                        className="tw:flex-none tw:text-faint"
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="tw:text-sm tw:text-muted-foreground">
                  Нет вложенных подразделений
                </div>
              )}
            </div>

            {canManage && (
              <div className="tw:grid tw:gap-2 tw:border-t tw:border-border-soft tw:px-5 tw:py-3.5">
                <Button variant="outline" onClick={() => onManageUsers(node)}>
                  <RiGroupLine /> Изменить состав
                </Button>
                <div className="tw:flex tw:gap-2">
                  <Button
                    variant="outline"
                    className="tw:flex-1"
                    onClick={() => onAddChild(node)}
                  >
                    <RiAddFill /> Вложенное
                  </Button>
                  <Button
                    variant="outline"
                    className="tw:flex-1"
                    onClick={() => onEdit(node)}
                  >
                    <RiEdit2Line /> Изменить
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  className="tw:text-destructive tw:hover:text-destructive"
                  onClick={() => onDelete(node)}
                >
                  <RiDeleteBinLine /> Удалить подразделение
                </Button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default SubdivisionPreviewSheet;
