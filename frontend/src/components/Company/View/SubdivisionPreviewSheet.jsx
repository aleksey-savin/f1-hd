import {
  RiAddFill,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiGroupLine,
  RiNodeTree,
} from "react-icons/ri";

import UserLink from "@/components/app/UserLink";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import ClientTime from "@/components/app/ClientTime";
import { plural } from "../../../util/plural";

const dash = <span className="text-faint">—</span>;

// Микро-подпись + значение (тот же идиом, что в превью расположений).
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

const userLinkClass =
  "font-medium text-inherit no-underline hover:text-foreground hover:underline";

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
                  <RiNodeTree size={20} />
                </span>
                <SheetTitle className="my-0 text-lg leading-snug font-semibold tracking-tight break-words">
                  {node.name?.trim() || "Без названия"}
                </SheetTitle>
              </div>
              <div className="mt-2 text-sm text-muted-foreground tabular-nums">
                <b className="font-semibold text-foreground">
                  {employees.length}
                </b>{" "}
                {plural(
                  employees.length,
                  "сотрудник",
                  "сотрудника",
                  "сотрудников",
                )}{" "}
                <span className="text-faint">·</span>{" "}
                <b className="font-semibold text-foreground">
                  {children.length}
                </b>{" "}
                {plural(children.length, "вложенное", "вложенных", "вложенных")}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pt-3.5 pb-4">
              <div className="grid gap-3">
                <Info label="Руководитель">
                  {node.manager ? (
                    <>
                      <UserLink
                        id={node.manager._id}
                        onClick={onClose}
                        className={userLinkClass}
                      >
                        {node.manager.lastName} {node.manager.firstName}
                      </UserLink>
                      {node.manager.position && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {node.manager.position}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Не назначен</span>
                  )}
                </Info>
                <Info label="Email">
                  {node.email ? (
                    <a
                      href={`mailto:${node.email}`}
                      className="text-accent-text no-underline hover:underline"
                    >
                      {node.email}
                    </a>
                  ) : null}
                </Info>
                <Info label="Телефон">
                  {node.phone ? (
                    <a
                      href={`tel:${node.phone}`}
                      className="text-accent-text no-underline tabular-nums hover:underline"
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
                        <span className="text-muted-foreground">
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
                        className="text-accent-text no-underline hover:underline"
                      >
                        {node.address}
                      </a>
                    ) : (
                      node.address
                    )
                  ) : null}
                </Info>
              </div>

              <div className="mt-4 mb-1 flex items-center gap-1.5 text-xs font-bold tracking-wider text-faint uppercase">
                <RiGroupLine aria-hidden /> Сотрудники · {employees.length}
              </div>
              {employees.length > 0 ? (
                <div className="grid gap-1">
                  {employees.map((user) => (
                    <div key={user._id} className="text-sm">
                      <UserLink
                        id={user._id}
                        onClick={onClose}
                        className={userLinkClass}
                      >
                        {user.lastName} {user.firstName}
                      </UserLink>
                      {user.position && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {user.position}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Нет сотрудников
                </div>
              )}

              <div className="mt-4 mb-1 flex items-center gap-1.5 text-xs font-bold tracking-wider text-faint uppercase">
                <RiNodeTree aria-hidden /> Вложенные · {children.length}
              </div>
              {children.length > 0 ? (
                <div className="-mx-2.5">
                  {children.map((child) => (
                    <button
                      key={child._id}
                      type="button"
                      onClick={() => onNavigate(child)}
                      className="flex w-full cursor-pointer appearance-none items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-sm font-medium text-inherit hover:bg-accent"
                    >
                      <RiNodeTree
                        size={15}
                        aria-hidden
                        className="flex-none text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {child.name?.trim() || "Без названия"}
                      </span>
                      {child.users?.length > 0 && (
                        <span className="flex-none text-xs font-normal text-muted-foreground tabular-nums">
                          {child.users.length}{" "}
                          {plural(child.users.length, "чел.", "чел.", "чел.")}
                        </span>
                      )}
                      <RiArrowRightSLine
                        aria-hidden
                        className="flex-none text-faint"
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Нет вложенных подразделений
                </div>
              )}
            </div>

            {canManage && (
              <div className="grid gap-2 border-t border-border-soft px-5 py-3.5">
                <Button variant="outline" onClick={() => onManageUsers(node)}>
                  <RiGroupLine /> Изменить состав
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => onAddChild(node)}
                  >
                    <RiAddFill /> Вложенное
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => onEdit(node)}
                  >
                    <RiEdit2Line /> Изменить
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
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
