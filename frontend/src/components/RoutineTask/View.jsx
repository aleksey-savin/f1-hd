import { useContext, useEffect, useState } from "react";
import { Link, Outlet, useFetcher, useNavigate } from "react-router";
import {
  RiArrowLeftSLine,
  RiCalendarScheduleLine,
  RiCornerDownRightLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiLinkM,
  RiMoreLine,
  RiTicketLine,
  RiTimeLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import FormSheet from "@/components/app/FormSheet";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { Eyebrow, Panel } from "@/components/app/Panel";
import PillPanel from "@/components/app/PillPanel";
import Checklist from "@/components/app/Checklist";
import { canManageEntity } from "@/components/app/entity-permissions";
import { cn } from "@/lib/utils";
import {
  describeCron,
  formatCronRun,
  isValidCron,
  nextCronRuns,
  relativeToNow,
} from "@/util/cron";

import MarkdownViewer from "../../UI/MarkdownViewer";
import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import { AuthedUserContext } from "../../store/authed-user-context";

const personName = (person) =>
  person && (person.firstName || person.lastName)
    ? `${person.lastName || ""} ${person.firstName || ""}`.trim()
    : null;

const fmtDate = (value) =>
  value ? new Date(value).toLocaleDateString("ru-RU") : null;

const ViewRoutineTask = ({ task }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const { showToast } = useToastStore();
  const { _id: userId, permissions } = useContext(AuthedUserContext);
  const canManage = canManageEntity("routineTask", permissions, task, userId);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Ручной запуск «создать заявку сейчас».
  const runFetcher = useFetcher();
  const [runOpen, setRunOpen] = useState(false);
  const [skipNext, setSkipNext] = useState(true);

  const doRun = () => {
    runFetcher.submit(
      { intent: "run", skipNext: skipNext ? "true" : "false" },
      { method: "post" },
    );
  };

  useEffect(() => {
    if (runFetcher.state === "idle" && runFetcher.data && !runFetcher.data.error) {
      setRunOpen(false);
      const num = runFetcher.data.ticketNum;
      showToast("success", num ? `Заявка №${num} создана` : "Заявка создана");
    }
  }, [runFetcher.state, runFetcher.data]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const {
    title,
    description,
    cronSchedule,
    isActive,
    category,
    company,
    applicant,
    responsibles = [],
    sourceTemplate,
    checklist = [],
    createdBy,
    createdAt,
    updatedAt,
  } = task;

  const runs = isActive && isValidCron(cronSchedule) ? nextCronRuns(cronSchedule, 1) : [];
  const nextRun = runs[0];
  const authorName = personName(createdBy);

  const metaBits = [
    authorName ? `создал ${authorName}` : null,
    createdAt ? fmtDate(createdAt) : null,
    updatedAt ? `изменён ${fmtDate(updatedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="tw:mx-auto tw:w-full tw:max-w-4xl">
      <Link
        to="/routine-tasks"
        className="tw:mb-4 tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:font-medium tw:text-muted-foreground tw:no-underline tw:hover:text-foreground"
      >
        <RiArrowLeftSLine /> Регламенты
      </Link>

      {/* Hero */}
      <div className="tw:flex tw:flex-wrap tw:items-start tw:gap-4">
        <span
          aria-hidden
          className="tw:grid tw:size-14 tw:flex-none tw:place-items-center tw:rounded-2xl tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border tw:[&_svg]:size-6"
        >
          <RiCalendarScheduleLine />
        </span>
        <div className="tw:min-w-0 tw:flex-1">
          <h1 className="tw:my-0 tw:text-3xl tw:leading-tight tw:font-semibold tw:tracking-tight">
            {title}
          </h1>
          <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1.5 tw:text-base">
            <span className="tw:inline-flex tw:items-center tw:gap-2 tw:text-muted-foreground">
              <span className="tw:size-1.5 tw:rounded-full tw:bg-faint" />
              {category?.title ?? "Без категории"}
            </span>
            <span className="tw:text-faint">·</span>
            <span className="tw:inline-flex tw:items-center tw:gap-2 tw:text-muted-foreground">
              {company?.alias ?? "—"}
            </span>
            <span className="tw:text-faint">·</span>
            <span
              className={cn(
                "tw:inline-flex tw:items-center tw:gap-2",
                isActive
                  ? "tw:font-medium tw:text-accent-text"
                  : "tw:text-faint",
              )}
            >
              <span
                className={cn(
                  "tw:size-1.5 tw:rounded-full",
                  isActive ? "tw:bg-primary" : "tw:bg-faint",
                )}
              />
              {isActive ? "Активно" : "На паузе"}
            </span>
            {sourceTemplate?._id && (
              <>
                <span className="tw:text-faint">·</span>
                <Link
                  to={`/ticket-templates/${sourceTemplate._id}`}
                  className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-muted-foreground tw:no-underline tw:hover:text-foreground tw:[&_svg]:size-4 tw:[&_svg]:text-faint"
                >
                  <RiLinkM /> из шаблона «{sourceTemplate.title}»
                </Link>
              </>
            )}
          </div>
        </div>
        {canManage && (
          <div className="tw:flex tw:flex-none tw:flex-wrap tw:items-center tw:gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Действия" title="Действия">
                  <RiMoreLine />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  <RiDeleteBinLine /> Удалить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => setRunOpen(true)}>
              <RiTicketLine /> Создать заявку сейчас
            </Button>
            <Button asChild>
              <Link to="update" onClick={offcanvas.setShow}>
                <RiEdit2Line /> Изменить
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Расписание */}
      <Eyebrow>Расписание</Eyebrow>
      <Panel>
        <div className="tw:flex tw:items-center tw:gap-3 tw:py-1">
          <span
            className={cn(
              "tw:grid tw:size-10 tw:flex-none tw:place-items-center tw:rounded-xl tw:[&_svg]:size-5",
              isActive
                ? "tw:bg-primary/15 tw:text-accent-text"
                : "tw:bg-accent tw:text-faint",
            )}
          >
            <RiTimeLine />
          </span>
          <div
            className={cn(
              "tw:text-lg tw:font-semibold tw:tracking-tight",
              !isActive && "tw:text-muted-foreground",
            )}
          >
            {describeCron(cronSchedule)}
          </div>
        </div>
        <div
          className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2.5 tw:gap-y-2 tw:pt-3"
          style={{ borderTop: "1px dashed var(--border)" }}
        >
          <span className="tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
            cron
          </span>
          <code className="tw:rounded-md tw:border tw:border-border tw:bg-accent tw:px-2.5 tw:py-1 tw:font-mono tw:text-sm tw:whitespace-nowrap tw:text-muted-foreground">
            {cronSchedule || "—"}
          </code>
        </div>
        <div className="tw:mt-3 tw:flex tw:items-center tw:gap-2.5 tw:border-t tw:border-border-soft tw:pt-3 tw:text-base">
          <RiTimeLine className="tw:size-4 tw:text-faint" />
          {isActive && nextRun ? (
            <span className="tw:text-muted-foreground">
              Ближайший запуск:{" "}
              <b className="tw:font-medium tw:text-foreground tw:tabular-nums">
                {formatCronRun(nextRun)}
              </b>{" "}
              <span className="tw:text-faint">· {relativeToNow(nextRun)}</span>
            </span>
          ) : (
            <span className="tw:text-faint">
              На паузе — запуски приостановлены до включения.
            </span>
          )}
        </div>
        <div className="tw:mt-2.5 tw:flex tw:items-start tw:gap-2 tw:border-t tw:border-border-soft tw:pt-3 tw:text-sm tw:text-faint tw:[&_svg]:size-4 tw:[&_svg]:shrink-0 tw:[&_svg]:translate-y-0.5">
          <RiCornerDownRightLine />
          <span>
            Создаёт заявку в категории{" "}
            <b className="tw:font-medium tw:text-muted-foreground">
              {category?.title ?? "—"}
            </b>{" "}
            от{" "}
            <b className="tw:font-medium tw:text-muted-foreground">
              {applicant?.firstName ?? "—"}
            </b>{" "}
            для{" "}
            <b className="tw:font-medium tw:text-muted-foreground">
              {company?.alias ?? "—"}
            </b>
          </span>
        </div>
      </Panel>

      {/* Ответственные */}
      {responsibles.length > 0 && (
        <PillPanel
          label="Ответственные по умолчанию"
          items={responsibles}
          getLabel={(user) =>
            `${user.lastName || ""} ${user.firstName || ""}`.trim() ||
            "Без имени"
          }
        />
      )}

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

      {/* Чек-лист — только показ: правится в общей форме регламента */}
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
                Чек-листа пока нет — добавьте пункты, они попадут в создаваемые
                по расписанию заявки.
              </div>
            )}
          </Panel>
        </div>
      )}

      {metaBits && (
        <div className="tw:mt-5 tw:border-t tw:border-border-soft tw:pt-3.5 tw:text-sm tw:text-faint tw:tabular-nums">
          {metaBits}
        </div>
      )}

      <DeleteDialog item={task} open={deleteOpen} onOpenChange={setDeleteOpen} />

      {/* Диалог «Создать заявку сейчас» */}
      <AlertDialog open={runOpen} onOpenChange={setRunOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Создать заявку сейчас?</AlertDialogTitle>
            <AlertDialogDescription>
              Заявка «{title}» будет создана немедленно из полей регламента — как
              при плановом срабатывании.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {isActive && nextRun && (
            <label className="tw:flex tw:cursor-pointer tw:items-start tw:gap-3 tw:rounded-xl tw:border tw:border-input tw:p-3.5">
              <Checkbox
                checked={skipNext}
                onCheckedChange={(value) => setSkipNext(!!value)}
                className="tw:mt-0.5"
              />
              <span>
                <span className="tw:block tw:text-sm tw:font-semibold">
                  Пропустить ближайшее плановое срабатывание
                </span>
                <span className="tw:block tw:text-xs tw:text-muted-foreground">
                  {formatCronRun(nextRun)} — иначе создастся ещё одна заявка
                </span>
              </span>
            </label>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={runFetcher.state !== "idle"}>
              Отмена
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={doRun}
              disabled={runFetcher.state !== "idle"}
            >
              <RiTicketLine /> Создать заявку
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

export default ViewRoutineTask;
