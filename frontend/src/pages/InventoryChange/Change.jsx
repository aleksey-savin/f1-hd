import { setDocTitle } from "@/hooks/use-doc-title";
import { useEffect, useState } from "react";
import { useLoaderData, useLocation } from "react-router";

import { RiRobot2Line, RiTimeLine, RiUserLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import Crumbs from "@/components/app/Crumbs";
import { DeviceStatusText } from "@/components/app/device-status";
import Field from "@/components/app/Field";
import { Eyebrow, Panel } from "@/components/app/Panel";
import PropRow from "@/components/app/PropRow";
import useLiveRouteRevalidate from "@/hooks/use-live-route-revalidate";
import useRefreshRoute from "@/components/app/use-refresh-route";
import { decideChange, fetchChangeResponse } from "@/store/inventory-changes";
import useToastStore from "@/store/toast-store";
import { displayTimeZone } from "@/util/format-date";
import {
  confirmSummary,
  opsCount,
  partialNote,
  statusTone,
} from "@/util/inventory-changes";
import {
  STATUS_TEXT_TONE,
  atPhrase,
  atStamp,
  expiresPhrase,
} from "@/util/mikrotik-changes";

import ChangeCreated from "../../components/InventoryChange/ChangeCreated";
import ChangeDecision from "../../components/InventoryChange/ChangeDecision";
import ChangeOperations from "../../components/InventoryChange/ChangeOperations";
import ChangeNote from "../../components/Mikrotik/ChangeNote";
import ChangeTimeline from "../../components/Mikrotik/ChangeTimeline";

const COMMENT_MAX = 300;
const CRUMB_MAX = 30;

const APPLY_BODY =
  "Операции идут по порядку. Если одна не пройдёт, HD остановится, а уже сделанное останется.";

const STUCK_TITLE = "Применение прервано — результат неизвестен";
const STUCK_BODY =
  "HD не дождался конца применения. Отмечено то, что успело записаться; остальные операции могли пройти. Проверьте технику, прежде чем предлагать снова.";

// Крошка — начало названия по границе слова: полное название стоит в h1 ниже
const shortTitle = (title = "") => {
  if (title.length <= CRUMB_MAX) return title;
  const cut = title.slice(0, CRUMB_MAX + 1);
  const space = cut.lastIndexOf(" ");
  // Висящий предлог или союз («и», «в», «на») в конце крошки не оставляем
  const head =
    space > 0
      ? cut.slice(0, space).replace(/\s+\S{1,2}$/, "")
      : title.slice(0, CRUMB_MAX);
  return `${head.replace(/[\s,.:;—–-]+$/, "")}…`;
};

// Сводка диалога «Применить?» внутри <p> описания: только строчные элементы
const ApplyDescription = ({ items }) => (
  <>
    {items.length > 0 && (
      <span className="mb-2.5 block list-disc space-y-0.5 ps-4.5 text-foreground">
        {/* строки могут совпадать (две безымянные конфигурации одной модели) — ключ по месту */}
        {items.map((item, index) => (
          <span key={index} className="list-item">
            {item}
          </span>
        ))}
      </span>
    )}
    {APPLY_BODY}
  </>
);

/**
 * Страница предложения ИИ-агента по технике. Агент собирает пакет операций,
 * автор запроса утверждает его целиком здесь или в Telegram.
 *
 * Разметка — макет «Предложения ИИ-агента по технике» (20.10), язык страницы
 * запроса Mikrotik: hero с названием и статусом; слева плашка итога, «Что
 * изменится» и «Зачем», справа «Утверждение», «Создано», «Сведения»,
 * «Хроника». На телефоне одна колонка в том же порядке: решение — после
 * чтения. Права на раздел не требуется: автор открывает своё предложение и без
 * прав на технику, остальным (кроме сотрудников с правом менять технику или
 * справочники) сервер отвечает 404.
 */
const InventoryChangePage = () => {
  const change = useLoaderData();
  const location = useLocation();
  const refresh = useRefreshRoute();
  const showToast = useToastStore((state) => state.showToast);

  // Живое обновление: перечитывается тогда, когда на странице нет летящих fetcher'ов
  useLiveRouteRevalidate("inventoryChanges", { baseline: change.pulse });

  const [rejecting, setRejecting] = useState(false);
  // «Применить?»: текст диалога фиксируется в момент открытия, чтобы живое
  // обновление не подменило вопрос под рукой
  const [act, setAct] = useState(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const timeZone = displayTimeZone();
  const operations = change.operations || [];
  const canDecide = Boolean(change.my?.canDecide);
  // Ждёт автора по статусу: и после срока, до обхода sweep, герой пишет «срок
  // вышел» (expiresPhrase). Открытость для пометок и подписей — isOpenChange
  const awaiting = change.status === "awaiting_requester";
  const tone = STATUS_TEXT_TONE[statusTone(change.status, change.stuck)];
  const partial = change.status === "partial" ? partialNote(operations) : null;

  // Пришли со страницы-источника — первая крошка уже она, цепочка не нужна
  const chain = location.state?.from
    ? []
    : [{ label: shortTitle(change.title) }];

  // Решение ушло от человека, пока диалог открыт (решено в Telegram, срок вышел).
  // Пока летит своё решение, живое обновление тоже снимет canDecide — это не «устарело»
  const dialogStale = !busy && Boolean(act || rejecting) && !canDecide;
  useEffect(() => {
    if (!dialogStale) return;
    setAct(null);
    setRejecting(false);
    showToast(
      "warning",
      "Предложение уже изменилось — проверьте его состояние.",
    );
  }, [dialogStale]);

  // Страница, открытая из проскроленного списка, без сброса уезжает под бар
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const run = async (request, doneText) => {
    if (busy) return;
    setBusy(true);
    try {
      await request();
      setAct(null);
      setRejecting(false);
      setComment("");
      showToast("success", doneText);
      refresh();
    } catch (error) {
      // 403/409/410 сервер объясняет сам: не ваше, уже решено, срок вышел
      setAct(null);
      setRejecting(false);
      showToast("danger", error.message || "Не удалось выполнить действие");
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const heroTime = awaiting
    ? expiresPhrase(change.expiresAt, { timeZone })
    : change.closedAt
      ? atPhrase(change.closedAt, { timeZone })
      : "";

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Crumbs section="client-devices" chain={chain} />

      {/* ── Hero: вид записи → название → статус, объём, срок ── */}
      <div className="min-w-0">
        <div className="text-sm text-muted-foreground">
          Предложение ИИ-агента по технике
        </div>
        <h1 className="my-1 text-2xl leading-tight font-semibold tracking-tight wrap-anywhere">
          {change.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <DeviceStatusText tone={tone} className="text-sm font-semibold">
            {change.statusLabel}
          </DeviceStatusText>
          <span>{opsCount(operations.length)}</span>
          {heroTime && <span>{heroTime}</span>}
        </div>
      </div>

      <div className="grid gap-x-3.5 md:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          {partial && (
            <ChangeNote title={partial.title} className="mt-6">
              {partial.body}
            </ChangeNote>
          )}
          {change.stuck && (
            <ChangeNote title={STUCK_TITLE} className="mt-6">
              {STUCK_BODY}
            </ChangeNote>
          )}
          <ChangeOperations change={change} />
          {change.reason && (
            <>
              <Eyebrow>Зачем</Eyebrow>
              <Panel>
                <div className="flex flex-col gap-0.5 border-l-2 border-border pl-2.5">
                  <span className="text-sm wrap-anywhere whitespace-pre-line">
                    {change.reason}
                  </span>
                  {change.agentName && (
                    <span className="text-xs text-faint">
                      Со слов агента {change.agentName}
                    </span>
                  )}
                </div>
              </Panel>
            </>
          )}
        </div>

        <div className="min-w-0">
          <ChangeDecision
            change={change}
            onApprove={() =>
              setAct(confirmSummary(change.summary, operations.length))
            }
            onReject={() => setRejecting(true)}
          />
          <ChangeCreated created={change.created} />
          <Eyebrow>Сведения</Eyebrow>
          <Panel>
            {change.agentName && (
              <PropRow icon={<RiRobot2Line size={17} />} label="Агент">
                {change.agentName}
              </PropRow>
            )}
            {change.requestedBy?.name && (
              <PropRow icon={<RiUserLine size={17} />} label="Автор">
                {change.requestedBy.name}
              </PropRow>
            )}
            <PropRow icon={<RiTimeLine size={17} />} label="Создано">
              {atStamp(change.createdAt, { timeZone })}
            </PropRow>
          </Panel>
          <ChangeTimeline timeline={change.timeline} />
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(act)}
        onOpenChange={(value) => !value && setAct(null)}
        title={act?.title}
        description={<ApplyDescription items={act?.items || []} />}
        confirmLabel="Да, применить"
        cancelLabel="Назад"
        isLoading={busy}
        onConfirm={() =>
          run(
            () => decideChange(change._id, "approve"),
            "Предложение утверждено",
          )
        }
      />

      <Dialog
        open={rejecting}
        onOpenChange={(value) => {
          if (!value && !busy) {
            setRejecting(false);
            setComment("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Отклонить предложение?</DialogTitle>
            <DialogDescription>Изменения не будут применены.</DialogDescription>
          </DialogHeader>
          <Field
            label="Комментарий"
            htmlFor="inventory-change-reject-comment"
            hint="Необязательно."
            className="mb-0"
          >
            <Textarea
              id="inventory-change-reject-comment"
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
                setRejecting(false);
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
                  "Предложение отклонено",
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

export default InventoryChangePage;

export async function loader({ params }) {
  const response = await fetchChangeResponse(params.id);

  // 404 — предложения нет или оно скрыто от человека; Error.jsx рисует стандартную страницу
  if (!response.ok) throw response;

  const data = await response.json();
  setDocTitle("Предложение ИИ-агента по технике");
  return { ...data, pulse: response.headers.get("X-Pulse-Cursor") };
}
