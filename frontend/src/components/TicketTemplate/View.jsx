import { useContext, useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router";
import {
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
import { Eyebrow, Panel } from "@/components/app/Panel";
import PillPanel from "@/components/app/PillPanel";
import CustomFieldsView from "@/components/app/CustomFieldsView";
import Checklist from "@/components/app/Checklist";
import { canManageEntity } from "@/components/app/entity-permissions";
import { cn } from "@/lib/utils";

import MarkdownViewer from "../../UI/MarkdownViewer";
import useOffcanvasStore from "../../store/offcanvas";
import { AuthedUserContext } from "../../store/authed-user-context";

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

const fmtDate = (value) =>
  value ? new Date(value).toLocaleDateString("ru-RU") : null;

const ViewTicketTemplate = ({ template }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const { _id: userId, permissions } = useContext(AuthedUserContext);
  const canManage = canManageEntity(
    "ticketTemplate",
    permissions,
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
    createdAt ? fmtDate(createdAt) : null,
    updatedAt ? `изменён ${fmtDate(updatedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="tw:mx-auto tw:w-full tw:max-w-4xl">
      {/* Крошки — возврат к списку */}
      <Link
        to="/ticket-templates"
        className="tw:mb-4 tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:font-medium tw:text-muted-foreground tw:no-underline tw:hover:text-foreground"
      >
        <RiArrowLeftSLine /> Шаблоны заявок
      </Link>

      {/* Hero */}
      <div className="tw:flex tw:flex-wrap tw:items-start tw:gap-4">
        <span
          aria-hidden
          className="tw:grid tw:size-14 tw:flex-none tw:place-items-center tw:rounded-2xl tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border tw:[&_svg]:size-6"
        >
          <RiFileList3Line />
        </span>
        <div className="tw:min-w-0 tw:flex-1">
          <h1 className="tw:my-0 tw:text-3xl tw:leading-tight tw:font-semibold tw:tracking-tight">
            {title}
          </h1>
          <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1.5 tw:text-base">
            <span className="tw:inline-flex tw:items-center tw:gap-2 tw:text-muted-foreground">
              <span className="tw:size-1.5 tw:rounded-full tw:bg-faint" />
              {categoryId?.title ?? "Без категории"}
            </span>
            <span className="tw:text-faint">·</span>
            <span
              className={cn(
                "tw:inline-flex tw:items-center tw:gap-2",
                accessAccent
                  ? "tw:font-medium tw:text-accent-text"
                  : "tw:text-faint",
              )}
            >
              <span
                className={cn(
                  "tw:size-1.5 tw:rounded-full",
                  accessAccent ? "tw:bg-primary" : "tw:bg-faint",
                )}
              />
              {accessLabel}
            </span>
          </div>
        </div>
        {canManage && (
          <div className="tw:flex tw:flex-none tw:flex-wrap tw:items-center tw:gap-2">
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
            <div className="tpl-doc">
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
        <div className="tw:mt-6">
          <div className="tw:mb-2.5 tw:flex tw:items-center tw:gap-2">
            <span className="tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
              Чек-лист
            </span>
            {checklist.length > 0 && (
              <span className="tw:text-xs tw:font-bold tw:text-faint tw:tabular-nums">
                · {checklist.length}
              </span>
            )}
            {canManage && (
              <Button asChild variant="outline" size="sm" className="tw:ml-auto">
                {/* Та же форма, что у «Изменить» в шапке, — открытая сразу на
                    секции чек-листа */}
                <Link to="update#checklist" onClick={offcanvas.setShow}>
                  <RiEdit2Line />
                  {checklist.length ? "Изменить" : "Добавить чек-лист"}
                </Link>
              </Button>
            )}
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
              <div className="tw:text-sm tw:text-muted-foreground">
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
            <div className="tw:inline-flex tw:items-center tw:gap-2 tw:text-base tw:font-medium tw:text-accent-text">
              <span className="tw:size-2 tw:rounded-full tw:bg-primary" />
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
            <div className="tw:text-sm tw:text-muted-foreground">
              Личный шаблон — виден только вам и тем, у кого есть право управления
              шаблонами.
            </div>
          </Panel>
        </>
      )}

      {metaBits && (
        <div className="tw:mt-5 tw:border-t tw:border-border-soft tw:pt-3.5 tw:text-sm tw:text-faint tw:tabular-nums">
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
