import { useContext, useEffect, useState } from "react";
import { Link, Outlet, useFetcher, useNavigate } from "react-router";
import {
  RiAddLine,
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
import Crumbs from "@/components/app/Crumbs";
import FormSheet from "@/components/app/FormSheet";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { Eyebrow, Panel, SectionEditLink } from "@/components/app/Panel";
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
import { formatShortDate } from "@/util/format-date";

import MarkdownViewer from "../../UI/MarkdownViewer";
import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import { AuthedUserContext } from "../../store/authed-user-context";
import { useCan } from "@/store/authed-user";

const personName = (person) =>
  person && (person.firstName || person.lastName)
    ? `${person.lastName || ""} ${person.firstName || ""}`.trim()
    : null;

const ViewRoutineTask = ({ task }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const { showToast } = useToastStore();
  const { _id: userId } = useContext(AuthedUserContext);
  const can = useCan();
  const canManage = canManageEntity("routineTask", can, task, userId);
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
    if (
      runFetcher.state === "idle" &&
      runFetcher.data &&
      !runFetcher.data.error
    ) {
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

  const runs =
    isActive && isValidCron(cronSchedule) ? nextCronRuns(cronSchedule, 1) : [];
  const nextRun = runs[0];
  const authorName = personName(createdBy);

  const metaBits = [
    authorName ? `создал ${authorName}` : null,
    formatShortDate(createdAt),
    updatedAt ? `изменён ${formatShortDate(updatedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Crumbs />

      {/* Hero */}
      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className="grid size-14 flex-none place-items-center rounded-2xl bg-accent text-muted-foreground inset-ring inset-ring-border [&_svg]:size-6"
        >
          <RiCalendarScheduleLine />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="my-0 text-2xl leading-tight font-semibold tracking-tight">
            {title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-base">
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <span className="size-1.5 rounded-full bg-faint" />
              {category?.title ?? "Без категории"}
            </span>
            <span className="text-faint">·</span>
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              {company?.alias ?? "—"}
            </span>
            <span className="text-faint">·</span>
            <span
              className={cn(
                "inline-flex items-center gap-2",
                isActive ? "font-medium text-accent-text" : "text-faint",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isActive ? "bg-primary" : "bg-faint",
                )}
              />
              {isActive ? "Активно" : "На паузе"}
            </span>
            {sourceTemplate?._id && (
              <>
                <span className="text-faint">·</span>
                <Link
                  to={`/ticket-templates/${sourceTemplate._id}`}
                  className="inline-flex items-center gap-1.5 text-muted-foreground no-underline hover:text-foreground [&_svg]:size-4 [&_svg]:text-faint"
                >
                  <RiLinkM /> из шаблона «{sourceTemplate.title}»
                </Link>
              </>
            )}
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
        <div className="flex items-center gap-3 py-1">
          <span
            className={cn(
              "grid size-10 flex-none place-items-center rounded-xl [&_svg]:size-5",
              isActive
                ? "bg-primary/15 text-accent-text"
                : "bg-accent text-faint",
            )}
          >
            <RiTimeLine />
          </span>
          <div
            className={cn(
              "text-lg font-semibold tracking-tight",
              !isActive && "text-muted-foreground",
            )}
          >
            {describeCron(cronSchedule)}
          </div>
        </div>
        <div
          className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-2 pt-3"
          style={{ borderTop: "1px dashed var(--border)" }}
        >
          <span className="text-xs font-bold tracking-wider text-faint uppercase">
            cron
          </span>
          <code className="rounded-md border border-border bg-accent px-2.5 py-1 font-mono text-sm whitespace-nowrap text-muted-foreground">
            {cronSchedule || "—"}
          </code>
        </div>
        <div className="mt-3 flex items-center gap-2.5 border-t border-border-soft pt-3 text-base">
          <RiTimeLine className="size-4 text-faint" />
          {isActive && nextRun ? (
            <span className="text-muted-foreground">
              Ближайший запуск:{" "}
              <b className="font-medium text-foreground tabular-nums">
                {formatCronRun(nextRun)}
              </b>{" "}
              <span className="text-faint">· {relativeToNow(nextRun)}</span>
            </span>
          ) : (
            <span className="text-faint">
              На паузе — запуски приостановлены до включения.
            </span>
          )}
        </div>
        <div className="mt-2.5 flex items-start gap-2 border-t border-border-soft pt-3 text-sm text-faint [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:translate-y-0.5">
          <RiCornerDownRightLine />
          <span>
            Создаёт заявку в категории{" "}
            <b className="font-medium text-muted-foreground">
              {category?.title ?? "—"}
            </b>{" "}
            от{" "}
            <b className="font-medium text-muted-foreground">
              {applicant?.firstName ?? "—"}
            </b>{" "}
            для{" "}
            <b className="font-medium text-muted-foreground">
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
                Чек-листа пока нет — добавьте пункты, они попадут в создаваемые
                по расписанию заявки.
              </div>
            )}
          </Panel>
        </div>
      )}

      {metaBits && (
        <div className="mt-5 border-t border-border-soft pt-3.5 text-sm text-faint tabular-nums">
          {metaBits}
        </div>
      )}

      <DeleteDialog
        item={task}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />

      {/* Диалог «Создать заявку сейчас» */}
      <AlertDialog open={runOpen} onOpenChange={setRunOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Создать заявку сейчас?</AlertDialogTitle>
            <AlertDialogDescription>
              Заявка «{title}» будет создана немедленно из полей регламента —
              как при плановом срабатывании.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {isActive && nextRun && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-input p-3.5">
              <Checkbox
                checked={skipNext}
                onCheckedChange={(value) => setSkipNext(!!value)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-semibold">
                  Пропустить ближайшее плановое срабатывание
                </span>
                <span className="block text-xs text-muted-foreground">
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
