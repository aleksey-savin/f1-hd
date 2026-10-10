import { useEffect, useState } from "react";
import { useLoaderData, useLocation } from "react-router";

import {
  RiArchive2Line,
  RiMoreLine,
  RiRobot2Line,
  RiTerminalBoxLine,
  RiTimeLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import Crumbs from "@/components/app/Crumbs";
import EntityLink from "@/components/app/EntityLink";
import { DeviceStatusText } from "@/components/app/device-status";
import Field from "@/components/app/Field";
import { Eyebrow, Panel } from "@/components/app/Panel";
import PropRow from "@/components/app/PropRow";
import useLiveRouteRevalidate from "@/hooks/use-live-route-revalidate";
import useRefreshRoute from "@/components/app/use-refresh-route";
import {
  cancelChange,
  decideChange,
  fetchChangeResponse,
} from "@/store/mikrotik-changes";
import useToastStore from "@/store/toast-store";
import { useCan } from "@/store/authed-user";
import { displayTimeZone, formatDate } from "@/util/format-date";
import {
  STATUS_TEXT_TONE,
  applyDialog,
  atPhrase,
  expiresPhrase,
  firstRisky,
  stampLabel,
  statusTone,
} from "@/util/mikrotik-changes";

import ChangeCommands from "../../components/Mikrotik/ChangeCommands";
import ChangeNote from "../../components/Mikrotik/ChangeNote";
import ChangeSteps from "../../components/Mikrotik/ChangeSteps";
import ChangeTimeline from "../../components/Mikrotik/ChangeTimeline";
import ChangeWireguard from "../../components/Mikrotik/ChangeWireguard";

const COMMENT_MAX = 300;
const OPEN = ["awaiting_requester", "awaiting_responsible"];
const EXECUTOR = { "safe-mode": "SSH, safe mode", api: "API RouterOS" };

const DONE_TOAST = {
  confirm: "Запрос подтверждён",
  approve: "Запрос утверждён, применение началось",
};

/**
 * Страница запроса ИИ-агента на изменение Mikrotik. Агент предлагает команды,
 * люди их подтверждают и утверждают, HD снимает копию и применяет.
 *
 * Разметка — макет «Запросы агентов Mikrotik» (10.10): hero с номером, темой и
 * статусом; слева команды и «Зачем» (блок конфигурации для сотрудника — первым,
 * когда есть что скачать), справа «Утверждение», «Сведения», «Хроника». На
 * телефоне одна колонка в том же порядке: решение принимается после чтения.
 * Право на раздел не требуется: заявитель и ответственный открывают свой запрос
 * без `mikrotik.read`, а чужой сервер не отдаёт (404).
 */
const MikrotikChangePage = () => {
  const change = useLoaderData();
  const location = useLocation();
  const can = useCan();
  const refresh = useRefreshRoute();
  const showToast = useToastStore((state) => state.showToast);

  // Живое обновление: перечитывается тогда, когда на странице нет летящих fetcher'ов
  useLiveRouteRevalidate("mikrotikChanges", { baseline: change.pulse });

  // "reject" или "cancel"
  const [dialog, setDialog] = useState(null);
  // Подтвердить/утвердить: текст диалога фиксируется в момент открытия, чтобы
  // живое обновление не подменило вопрос под рукой
  const [act, setAct] = useState(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const timeZone = displayTimeZone();
  const canRead = can({ mikrotik: ["read"] });
  const canManageConfigs = can({ mikrotik: ["manageConfigs"] });

  const full = Array.isArray(change.commands);
  const my = change.my || {};
  const steps = change.steps || [];
  const device = change.device;
  const deviceTo = device ? `/devices/mikrotik/records/${device._id}` : null;
  const open = OPEN.includes(change.status);
  const tone = STATUS_TEXT_TONE[statusTone(change.status)];

  // Пришли со страницы устройства — первая крошка уже она, цепочка не нужна
  const chain =
    device?.name && !location.state?.from
      ? [{ label: device.name, to: canRead ? deviceTo : undefined }]
      : [];

  const nextApprover = steps.find((step) => step.role === "responsible")?.user
    ?.name;
  const apply = applyDialog({
    count: change.commands?.length || 0,
    device: device?.name || "устройстве",
    company: device?.company,
    risky: change.risk === "high" ? firstRisky(change.commands) : null,
    rollback: change.rollback,
  });
  const openAct = () =>
    setAct(
      my.action === "confirm"
        ? {
            action: "confirm",
            title: "Подтвердить запрос?",
            description: `После вашего подтверждения запрос уйдёт на утверждение${nextApprover ? `: ${nextApprover}` : ""}.`,
            confirmLabel: "Подтвердить",
          }
        : {
            action: "approve",
            title: apply.title,
            description: apply.body,
            confirmLabel: "Да, применить",
          },
    );

  // Очередь ушла от человека, пока диалог открыт (решил другой, срок вышел)
  const dialogStale =
    (act && !my.action) ||
    (dialog === "reject" && !my.action) ||
    (dialog === "cancel" && !my.canCancel);
  useEffect(() => {
    if (!dialogStale) return;
    setAct(null);
    setDialog(null);
    showToast("warning", "Запрос уже изменился — проверьте его состояние.");
  }, [dialogStale]);

  // Страница, открытая из проскроленного списка, без сброса уезжает под бар
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const backupAt = change.backup?.createdAt
    ? `Экспорт от ${stampLabel(change.backup.createdAt, { timeZone })}`
    : "Экспорт";
  const backupLink =
    change.backup && canManageConfigs && deviceTo ? (
      <EntityLink
        to={`${deviceTo}#configs`}
        from="Запрос на изменение"
        className="font-medium text-accent-text no-underline hover:underline"
      >
        {backupAt}
      </EntityLink>
    ) : (
      backupAt
    );

  const run = async (request, doneText) => {
    if (busy) return;
    setBusy(true);
    try {
      await request();
      setAct(null);
      setDialog(null);
      setComment("");
      showToast("success", doneText);
      refresh();
    } catch (error) {
      // 403/409/410 сервер объясняет сам: не ваш шаг, уже решён, срок вышел
      setAct(null);
      setDialog(null);
      showToast("danger", error.message || "Не удалось выполнить действие");
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const heroTime = open
    ? expiresPhrase(change.expiresAt, { timeZone })
    : change.closedAt
      ? atPhrase(change.closedAt, { timeZone })
      : "";

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Crumbs chain={chain} />

      {/* ── Hero: вид записи → тема → статус и что к нему прилагается ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">
            Запрос на изменение конфигурации
          </div>
          <h1 className="my-1 text-2xl leading-tight font-semibold tracking-tight wrap-anywhere">
            {change.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <DeviceStatusText tone={tone} className="text-sm font-semibold">
              {change.statusLabel}
            </DeviceStatusText>
            {(device?.name || device?.company) && (
              <span className="wrap-anywhere">
                {[device.name, device.company].filter(Boolean).join(", ")}
              </span>
            )}
            {full && heroTime && <span>{heroTime}</span>}
          </div>
        </div>
        {my.canCancel && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Ещё действия">
                <RiMoreLine />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDialog("cancel")}
              >
                Отозвать запрос
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {!full ? (
        <>
          <Eyebrow>Подробности</Eyebrow>
          <Panel>
            <div className="text-sm text-faint">
              Команды и ход утверждения видят заявитель, ответственный и те, у
              кого есть право утверждать запросы или управлять конфигурациями.
            </div>
          </Panel>
        </>
      ) : (
        <div className="grid gap-x-3.5 md:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0">
            {change.status === "needs_attention" && (
              <ChangeNote
                title={change.failure || "Результат применения неизвестен"}
                className="mt-6"
              >
                HD не может поручиться, что осталось на устройстве. Проверьте
                устройство и резервную копию.
                {change.backup && <> {backupLink}</>}
              </ChangeNote>
            )}
            {change.status === "rolled_back" && (
              <ChangeNote
                tone="danger"
                title="Роутер откатил все изменения этого запроса"
                className="mt-6"
              >
                {change.failure}
              </ChangeNote>
            )}
            {my.canDownload && <ChangeWireguard change={change} />}
            <ChangeCommands
              commands={change.commands}
              status={change.status}
              risk={change.risk}
              rollback={change.rollback}
            />
            {change.reason && (
              <>
                <Eyebrow>Зачем</Eyebrow>
                <Panel>
                  <div className="flex flex-col gap-0.5 border-l-2 border-border pl-2.5">
                    <span className="text-sm wrap-anywhere whitespace-pre-line">
                      {change.reason}
                    </span>
                    {change.requestedVia?.keyName && (
                      <span className="text-xs text-faint">
                        Со слов агента {change.requestedVia.keyName}
                      </span>
                    )}
                  </div>
                </Panel>
              </>
            )}
          </div>

          <div className="min-w-0">
            <ChangeSteps
              change={change}
              onAct={openAct}
              onReject={() => setDialog("reject")}
            />
            <Eyebrow>Сведения</Eyebrow>
            <Panel>
              {change.requestedVia?.keyName && (
                <PropRow icon={<RiRobot2Line size={17} />} label="Агент">
                  {change.requestedVia.keyName}
                </PropRow>
              )}
              <PropRow icon={<RiTimeLine size={17} />} label="Создан">
                {formatDate(change.createdAt)}
              </PropRow>
              {change.backup && (
                <PropRow
                  icon={<RiArchive2Line size={17} />}
                  label="Резервная копия"
                >
                  {backupLink}
                </PropRow>
              )}
              {change.backup && EXECUTOR[change.executor] && (
                <PropRow icon={<RiTerminalBoxLine size={17} />} label="Способ">
                  {EXECUTOR[change.executor]}
                </PropRow>
              )}
            </Panel>
            <ChangeTimeline timeline={change.timeline} />
          </div>
        </div>
      )}

      {/* Подтвердить / утвердить: первый шаг при втором согласующем — без
          применения, поэтому и текст другой */}
      <ConfirmDialog
        open={Boolean(act)}
        onOpenChange={(value) => !value && setAct(null)}
        title={act?.title}
        description={act?.description}
        confirmLabel={act?.confirmLabel}
        cancelLabel="Назад"
        isLoading={busy}
        onConfirm={() =>
          run(
            () => decideChange(change._id, "approve"),
            DONE_TOAST[act?.action],
          )
        }
      />

      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(value) => !value && setDialog(null)}
        title="Отозвать запрос?"
        description="Запрос закроется, команды на устройстве выполнены не будут."
        confirmLabel="Отозвать"
        confirmVariant="destructive"
        cancelLabel="Назад"
        isLoading={busy}
        onConfirm={() => run(() => cancelChange(change._id), "Запрос отозван")}
      />

      <Dialog
        open={dialog === "reject"}
        onOpenChange={(value) => {
          if (!value && !busy) {
            setDialog(null);
            setComment("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Отклонить запрос?</DialogTitle>
            <DialogDescription>
              Команды на устройстве выполнены не будут.
            </DialogDescription>
          </DialogHeader>
          <Field
            label="Комментарий"
            htmlFor="change-reject-comment"
            hint="Необязательно."
            className="mb-0"
          >
            <Textarea
              id="change-reject-comment"
              maxLength={COMMENT_MAX}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </Field>
          <DialogFooter className="mt-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDialog(null);
                setComment("");
              }}
            >
              Назад
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    decideChange(
                      change._id,
                      "reject",
                      comment.trim() || undefined,
                    ),
                  "Запрос отклонён",
                )
              }
            >
              Отклонить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MikrotikChangePage;

export async function loader({ params }) {
  const response = await fetchChangeResponse(params.id);

  // 404 — запроса нет или он чужой; Error.jsx рисует стандартную страницу
  if (!response.ok) throw response;

  const data = await response.json();
  document.title = "Запрос на изменение конфигурации";
  return { ...data, pulse: response.headers.get("X-Pulse-Cursor") };
}
