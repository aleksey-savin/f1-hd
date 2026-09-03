import { useContext, useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router";
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiCalendarScheduleLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiFileList3Line,
  RiMoreLine,
  RiTicketLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FormSheet from "@/components/app/FormSheet";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { Eyebrow, Panel, SectionEditLink } from "@/components/app/Panel";
import PillPanel from "@/components/app/PillPanel";
import CustomFieldsView from "@/components/app/CustomFieldsView";
import Checklist from "@/components/app/Checklist";
import { canManageEntity } from "@/components/app/entity-permissions";
import { formatShortDate } from "@/util/format-date";
import { cn } from "@/lib/utils";

import MarkdownViewer from "../../UI/MarkdownViewer";
import useOffcanvasStore from "../../store/offcanvas";
import { AuthedUserContext } from "../../store/authed-user-context";
import { useCan } from "@/store/authed-user";

const pluralFields = (n) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "поле";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "поля";
  return "полей";
};

const personName = (person) =>
  person && (person.firstName || person.lastName)
    ? `${person.lastName || ""} ${person.firstName || ""}`.trim()
    : null;

const ViewTicketTemplate = ({ template }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const { _id: userId } = useContext(AuthedUserContext);
  const can = useCan();
  const canManage = canManageEntity("ticketTemplate", can,
    template,
    userId,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Карточку всегда открываем от начала (иначе hero прячется под баром при
  // переходе из проскроленного списка) — см. ServicePlan/View.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const {
    title,
    categoryId,
    description,
    customFields = [],
    checklist = [],
    allowAllStaff,
    sharedCompanies = [],
    sharedUsers = [],
    createdBy,
    createdAt,
    updatedAt,
  } = template;

  const fieldsCount = customFields.length;
  const hasClientShares = sharedCompanies.length + sharedUsers.length > 0;
  const accessAccent = allowAllStaff || hasClientShares;
  const accessLabel = allowAllStaff
    ? "Всем сотрудникам"
    : hasClientShares
      ? "Общий доступ"
      : "Личный";
  const authorName = personName(createdBy);

  const metaBits = [
    fieldsCount ? `${fieldsCount} ${pluralFields(fieldsCount)}` : null,
    authorName ? `создал ${authorName}` : null,
    formatShortDate(createdAt),
    updatedAt ? `изменён ${formatShortDate(updatedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* Крошки — возврат к списку */}
      <Link
        to="/ticket-templates"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground"
      >
        <RiArrowLeftSLine /> Шаблоны заявок
      </Link>

      {/* Hero */}
      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className="grid size-14 flex-none place-items-center rounded-2xl bg-accent text-muted-foreground inset-ring inset-ring-border [&_svg]:size-6"
        >
          <RiFileList3Line />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="my-0 text-2xl leading-tight font-semibold tracking-tight">
            {title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-base">
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <span className="size-1.5 rounded-full bg-faint" />
              {categoryId?.title ?? "Без категории"}
            </span>
            <span className="text-faint">·</span>
            <span
              className={cn(
                "inline-flex items-center gap-2",
                accessAccent ? "font-medium text-accent-text" : "text-faint",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  accessAccent ? "bg-primary" : "bg-faint",
                )}
              />
              {accessLabel}
            </span>
          </div>
        </div>
        {canManage && (
          <div className="flex flex-none flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Действия"
                  title="Действия"
                >
                  <RiMoreLine />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={`/routine-tasks/add?fromTemplate=${template._id}`}>
                    <RiCalendarScheduleLine /> Создать регламент
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  <RiDeleteBinLine /> Удалить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" asChild>
              <Link to={`/tickets/add?template=${template._id}`}>
                <RiTicketLine /> Создать заявку
              </Link>
            </Button>
            <Button asChild>
              <Link to="update" onClick={offcanvas.setShow}>
                <RiEdit2Line /> Изменить
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Описание */}
      {description && (
        <>
          <Eyebrow>Описание</Eyebrow>
          <Panel>
            <div className="md-doc">
              <MarkdownViewer value={description} />
            </div>
          </Panel>
        </>
      )}

      {/* Поля формы (общий компонент с заявкой) */}
      <CustomFieldsView fields={customFields} emptyText="Полей нет" />

      {/* Чек-лист — общий компонент, только показ: правится в общей форме
          шаблона (ярлык ведёт на её секцию). read без прогресса — это
          определение, а не выполнение. */}
      {(checklist.length > 0 || canManage) && (
        // group — карандаш правки проявляется при наведении на всю секцию
        <div className="group mt-6">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="text-xs font-bold tracking-wider text-faint uppercase">
              Чек-лист
            </span>
            {checklist.length > 0 && (
              <span className="text-xs font-bold text-faint tabular-nums">
                · {checklist.length}
              </span>
            )}
            {canManage &&
              /* Та же форма, что у «Изменить» в шапке, — открытая сразу на
                 секции чек-листа. Пустая секция называет, что создаёт;
                 заполненная — карандаш: это второй вход в ту же форму. */
              (checklist.length ? (
                <span className="ml-auto">
                  <SectionEditLink
                    to="update#checklist"
                    label="Чек-лист"
                    onClick={offcanvas.setShow}
                  />
                </span>
              ) : (
                <Button asChild variant="outline" size="sm" className="ml-auto">
                  <Link to="update#checklist" onClick={offcanvas.setShow}>
                    <RiAddLine /> Добавить чек-лист
                  </Link>
                </Button>
              ))}
          </div>
          <Panel>
            {checklist.length > 0 ? (
              <Checklist
                mode="read"
                framed={false}
                showHeader={false}
                showProgress={false}
                items={checklist}
              />
            ) : (
              <div className="text-sm text-muted-foreground">
                Чек-листа пока нет — добавьте пункты, они попадут в заявки,
                созданные по шаблону.
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* Доступ */}
      {allowAllStaff && (
        <>
          <Eyebrow>Доступ</Eyebrow>
          <Panel>
            <div className="inline-flex items-center gap-2 text-base font-medium text-accent-text">
              <span className="size-2 rounded-full bg-primary" />
              Доступен всем сотрудникам
            </div>
          </Panel>
        </>
      )}
      {sharedCompanies.length > 0 && (
        <PillPanel
          label="Доступен компаниям"
          items={sharedCompanies}
          getLabel={(company) => company.alias}
        />
      )}
      {sharedUsers.length > 0 && (
        <PillPanel
          label="Доступен пользователям"
          items={sharedUsers}
          getLabel={(user) =>
            `${user.lastName ?? ""} ${user.firstName ?? ""}`.trim() ||
            "Без имени"
          }
        />
      )}
      {!allowAllStaff && !hasClientShares && (
        <>
          <Eyebrow>Доступ</Eyebrow>
          <Panel>
            <div className="text-sm text-muted-foreground">
              Личный шаблон — виден только вам и тем, у кого есть право
              управления шаблонами.
            </div>
          </Panel>
        </>
      )}

      {metaBits && (
        <div className="mt-5 border-t border-border-soft pt-3.5 text-sm text-faint tabular-nums">
          {metaBits}
        </div>
      )}

      <DeleteDialog
        item={template}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />

      <FormSheet
        open={offcanvas.isActive}
        size="lg"
        onOpenChange={(open) => {
          if (!open) {
            navigate(-1);
            offcanvas.setClose();
          }
        }}
      >
        <Outlet />
      </FormSheet>
    </div>
  );
};

export default ViewTicketTemplate;
